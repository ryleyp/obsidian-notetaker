import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { extractItems } from "@/lib/todoItems";
import { normalizeTaskContent, todoistLabelForNote, todoistTaskFromItemLine } from "@/lib/todoist";
import { createTodoistTaskWithDueFallback, listProjectTaskContents } from "@/lib/todoistApi";
import { collectNoteFiles, noteDate } from "@/lib/vaultScan";

// One-shot backfill: scan every account folder in the vault for notes from
// the last month, extract the CSM's own unchecked action items, and push
// them to Todoist. Existing project tasks with the same content are skipped,
// so re-running is safe.

const MAX_TASKS_PER_RUN = 100;

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { vaultPath, apiToken, projectId, ownerNames = [], accounts = [], days = 31 } = body;

    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    if (!apiToken?.trim()) {
      return NextResponse.json({ error: "Todoist API token is required. Add it in Settings." }, { status: 400 });
    }
    if (!projectId?.trim()) {
      return NextResponse.json({ error: "Todoist project is required. Add it in Settings." }, { status: 400 });
    }

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.min(Math.max(Number(days) || 31, 1), 92));

    // Root-level notes have no account folder; label comes from the folder,
    // so start from the vault's subfolders plus the root itself.
    const noteFiles = collectNoteFiles(resolvedVault, "");

    const tasks = [];
    let scannedNotes = 0;
    let notesWithItems = 0;
    const seenInBatch = new Set();

    for (const file of noteFiles) {
      let content;
      try {
        content = fs.readFileSync(file.filePath, "utf-8");
      } catch {
        continue;
      }
      const date = noteDate(file.filePath, file.filename, content);
      if (!date || date < cutoff) continue;
      scannedNotes += 1;

      const { actionItems } = extractItems(content, ownerNames);
      const label = todoistLabelForNote(file.folder, accounts);
      const noteTitle = path.basename(file.filename, ".md");
      const noteIso = date.toISOString().slice(0, 10);
      const noteTasks = actionItems
        .map((line) => todoistTaskFromItemLine(line, { noteTitle, label, noteDate: noteIso }))
        .filter(Boolean)
        .filter((task) => {
          const key = normalizeTaskContent(task.content);
          if (!key || seenInBatch.has(key)) return false;
          seenInBatch.add(key);
          return true;
        });

      if (noteTasks.length) notesWithItems += 1;
      tasks.push(...noteTasks);
    }

    if (!tasks.length) {
      return NextResponse.json({ scannedNotes, notesWithItems, created: 0, duplicates: 0, failed: [] });
    }

    // Skip anything already in the project so re-runs don't pile up copies.
    const existing = new Set(
      (await listProjectTaskContents(apiToken.trim(), projectId.trim())).map(normalizeTaskContent)
    );
    const newTasks = tasks.filter((task) => !existing.has(normalizeTaskContent(task.content)));
    const duplicates = tasks.length - newTasks.length;
    const capped = newTasks.length > MAX_TASKS_PER_RUN;
    const toCreate = newTasks.slice(0, MAX_TASKS_PER_RUN);

    let created = 0;
    let droppedDues = 0;
    const failed = [];
    for (const task of toCreate) {
      const payload = {
        content: task.content,
        project_id: projectId.trim(),
        ...(task.dueString ? { due_string: task.dueString } : {}),
        ...(task.labels?.length ? { labels: task.labels } : {}),
        ...(task.description ? { description: task.description } : {}),
      };
      try {
        const { droppedDue } = await createTodoistTaskWithDueFallback(apiToken.trim(), payload, task.fallbackDueString);
        created += 1;
        if (droppedDue) droppedDues += 1;
      } catch (err) {
        failed.push({ content: task.content, error: err?.message || "Request failed" });
        if (err?.status === 401 || err?.status === 403 || err?.status === 404) break;
      }
    }

    return NextResponse.json({ scannedNotes, notesWithItems, created, duplicates, droppedDues, failed, capped });
  } catch (error) {
    console.error("Todoist backfill error:", error);
    return NextResponse.json(
      { error: error?.message || "Todoist backfill failed" },
      { status: error?.status || 500 }
    );
  }
}
