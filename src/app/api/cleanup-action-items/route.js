import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { resolveInsideDirectory } from "@/lib/fileSafety";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { FAST_MODEL, firstTextBlock } from "@/lib/models";
import { isRelevantItem } from "@/lib/todoItems";
import { normalizeTaskContent } from "@/lib/todoist";
import { listCompletedTaskContents } from "@/lib/todoistApi";
import { collectNoteFiles, noteDate } from "@/lib/vaultScan";
import { cleanupActionItems, completeActionItemEdit, openActionItemLines } from "@/lib/actionItemCleanup";

// Action-item cleanup over recent notes, in two calls:
//   mode "preview" — compute proposed edits (mechanical normalization, Todoist
//     completions, AI completion detection) and return them without writing.
//   mode "apply" — apply the exact edit list the preview returned, backing up
//     each file first. Edits whose original text is gone are skipped, so a
//     stale preview can't corrupt a note.

const WINDOW_DAYS = 62; // "past 2 months"
const MAX_AI_ITEMS = 120;

function backUpNote(resolvedVault, filePath) {
  const relativeDir = path.dirname(path.relative(resolvedVault, filePath));
  const backupDir = resolveInsideDirectory(resolvedVault, path.join(".notetaker", "backups", relativeDir), "Backup folder");
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(filePath, path.extname(filePath));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${base}.backup-${stamp}.md`);
  fs.copyFileSync(filePath, backupPath);
  return path.relative(resolvedVault, backupPath);
}

function applyEdit(content, edit) {
  if (!content.includes(edit.from)) return null;
  return content.replace(edit.from, edit.to);
}

function noteExcerpt(content) {
  const sections = [];
  for (const heading of ["Executive Summary", "Meeting Notes", "Action Items", "Next Steps"]) {
    const match = content.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |\\n---\\n|$)`));
    if (match) sections.push(`## ${heading}\n${match[1].trim().slice(0, heading === "Meeting Notes" ? 1200 : 800)}`);
  }
  return sections.join("\n\n");
}

async function detectCompletedWithAI({ apiKey, model, folderNotes, openItems }) {
  const client = new Anthropic({ apiKey });
  const itemsJson = openItems.map((item, index) => ({
    id: index,
    note: item.filename,
    noteDate: item.date,
    line: item.line,
  }));
  const evidence = folderNotes
    .map((n) => `### ${n.filename} (${n.date})\n${n.excerpt}`)
    .join("\n\n---\n\n");

  const msg = await client.messages.create({
    model: model || FAST_MODEL,
    max_tokens: 4000,
    system: "You audit a CSM's meeting-note action items and decide which open items later notes show were completed or explicitly cancelled/superseded. Be conservative: only report items where the evidence is clear. Respond with ONLY a JSON array, no prose.",
    messages: [{
      role: "user",
      content: `Open action items (JSON):\n${JSON.stringify(itemsJson, null, 1)}\n\nDated note excerpts from the same account folder, oldest first:\n\n${evidence}\n\nReturn a JSON array of {"id": <number>, "evidence": "<date or note> — <short reason>"} for items that LATER evidence clearly shows were completed, cancelled, or superseded. Only use evidence dated after the item's noteDate. Return [] if none are clear.`,
    }],
  });

  let verdicts;
  try {
    const text = firstTextBlock(msg).trim().replace(/^```(json)?\n?|\n?```$/g, "");
    verdicts = JSON.parse(text);
  } catch {
    return { completions: [], usage: msg.usage, parseFailed: true };
  }
  if (!Array.isArray(verdicts)) return { completions: [], usage: msg.usage, parseFailed: true };

  const completions = verdicts
    .filter((v) => Number.isInteger(v?.id) && openItems[v.id])
    .map((v) => ({ ...openItems[v.id], evidence: String(v.evidence || "").slice(0, 200) }));
  return { completions, usage: msg.usage };
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      vaultPath,
      mode = "preview",
      ownerNames = [],
      apiKey,
      model,
      todoistToken,
      todoistProjectId,
      files: applyFiles = [],
    } = body;

    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");

    if (mode === "apply") {
      let editsApplied = 0;
      let editsSkipped = 0;
      const updatedFiles = [];
      for (const file of applyFiles) {
        const filePath = resolveInsideDirectory(resolvedVault, file.relativePath, "Note");
        if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== ".md") {
          editsSkipped += (file.edits || []).length;
          continue;
        }
        let content = fs.readFileSync(filePath, "utf-8");
        let changed = false;
        for (const edit of file.edits || []) {
          if (typeof edit?.from !== "string" || typeof edit?.to !== "string") continue;
          const next = applyEdit(content, edit);
          if (next === null) {
            editsSkipped += 1;
            continue;
          }
          content = next;
          changed = true;
          editsApplied += 1;
        }
        if (changed) {
          const backupPath = backUpNote(resolvedVault, filePath);
          fs.writeFileSync(filePath, content, "utf-8");
          updatedFiles.push({ relativePath: file.relativePath, backupPath });
        }
      }
      return NextResponse.json({ editsApplied, editsSkipped, updatedFiles });
    }

    // ---- preview ----
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - WINDOW_DAYS);

    const noteFiles = collectNoteFiles(resolvedVault, "");
    const notes = [];
    for (const file of noteFiles) {
      let content;
      try {
        content = fs.readFileSync(file.filePath, "utf-8");
      } catch {
        continue;
      }
      const date = noteDate(file.filePath, file.filename, content);
      if (!date || date < cutoff) continue;
      notes.push({
        ...file,
        relativePath: path.relative(resolvedVault, file.filePath),
        date: date.toISOString().slice(0, 10),
        content,
      });
    }
    notes.sort((a, b) => a.date.localeCompare(b.date));

    const fileEdits = new Map(); // relativePath -> [{from,to,reason}]
    const addEdit = (relativePath, folder, edit) => {
      if (!fileEdits.has(relativePath)) fileEdits.set(relativePath, { relativePath, folder, edits: [] });
      fileEdits.get(relativePath).edits.push(edit);
    };
    const counts = { mechanical: 0, todoistCompleted: 0, aiCompleted: 0 };
    const warnings = [];

    // 1. Mechanical normalization + in-note dedupe.
    for (const note of notes) {
      for (const edit of cleanupActionItems(note.content, { ownerNames })) {
        addEdit(note.relativePath, note.folder, edit);
        counts.mechanical += 1;
      }
    }

    // 2. Todoist sync-back: items completed in the project → checked off here.
    if (todoistToken?.trim() && todoistProjectId?.trim()) {
      try {
        const completedContents = await listCompletedTaskContents(todoistToken.trim(), todoistProjectId.trim(), cutoff);
        const completedSet = new Set(completedContents.map(normalizeTaskContent));
        for (const note of notes) {
          for (const line of openActionItemLines(note.content)) {
            const itemText = line.replace(/^\s*- \[ \] /, "").replace(/\s*[—–-]\s*\*\*Owner:\*\*.*$/, "");
            if (!completedSet.has(normalizeTaskContent(itemText))) continue;
            const edit = completeActionItemEdit(note.content, line);
            if (edit) {
              addEdit(note.relativePath, note.folder, { ...edit, reason: "completed in Todoist" });
              counts.todoistCompleted += 1;
            }
          }
        }
      } catch (err) {
        warnings.push(`Todoist sync-back skipped: ${err.message}`);
      }
    } else {
      warnings.push("Todoist sync-back skipped: token or project not configured.");
    }

    // 3. AI completion detection, per account folder, over the CSM's items.
    if (apiKey?.trim() || process.env.ANTHROPIC_API_KEY) {
      const folders = [...new Set(notes.map((n) => n.folder))];
      const alreadyCompleted = new Set(
        [...fileEdits.values()].flatMap((f) => f.edits.filter((e) => e.reason.startsWith("completed")).map((e) => e.from))
      );
      for (const folder of folders) {
        const folderNotes = notes.filter((n) => n.folder === folder);
        const openItems = folderNotes.flatMap((note) =>
          openActionItemLines(note.content)
            .filter((line) => isRelevantItem(line, ownerNames) && !alreadyCompleted.has(line))
            .map((line) => ({ relativePath: note.relativePath, folder: note.folder, filename: note.filename, date: note.date, line }))
        ).slice(0, MAX_AI_ITEMS);
        if (!openItems.length || folderNotes.length < 2) continue;

        try {
          const { completions, parseFailed } = await detectCompletedWithAI({
            apiKey: apiKey?.trim() || process.env.ANTHROPIC_API_KEY,
            model,
            folderNotes: folderNotes.map((n) => ({ filename: n.filename, date: n.date, excerpt: noteExcerpt(n.content) })),
            openItems,
          });
          if (parseFailed) warnings.push(`AI check for "${folder || "vault root"}" returned an unreadable answer; skipped.`);
          for (const completion of completions) {
            const note = notes.find((n) => n.relativePath === completion.relativePath);
            const edit = note && completeActionItemEdit(note.content, completion.line);
            if (edit) {
              addEdit(completion.relativePath, completion.folder, { ...edit, reason: `completed per later notes (${completion.evidence})` });
              counts.aiCompleted += 1;
            }
          }
        } catch (err) {
          warnings.push(`AI check for "${folder || "vault root"}" failed: ${err.message}`);
        }
      }
    } else {
      warnings.push("AI completion detection skipped: no Anthropic API key.");
    }

    return NextResponse.json({
      scannedNotes: notes.length,
      files: [...fileEdits.values()],
      counts,
      warnings,
    });
  } catch (error) {
    console.error("Action item cleanup error:", error);
    return NextResponse.json(
      { error: error?.message || "Action item cleanup failed" },
      { status: error?.status || 500 }
    );
  }
}
