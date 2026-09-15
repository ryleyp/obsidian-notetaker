import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { resolveInsideDirectory } from "@/lib/fileSafety";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { createModelClient } from "@/lib/modelClient";
import { FAST_MODEL, firstTextBlock } from "@/lib/models";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { collectNoteFiles, noteDate } from "@/lib/vaultScan";
import {
  chunk,
  goalEvidenceExcerpt,
  hasGoalSection,
  insertGoalSection,
  parseBackfillVerdicts,
} from "@/lib/goalBackfill";

// Backfills the "## Goal Contributions" section into notes written before
// goals were configured, in two calls:
//   mode "preview" — read candidate notes and propose contributions. Writes
//     nothing; the CSM ticks what is right in the Goals tab.
//   mode "apply" — write the approved sections, backing each note up first.
//     A note that gained a section since the preview is skipped, so a stale
//     preview cannot overwrite reviewed work.

const MAX_RANGE_DAYS = 400;
const MAX_NOTES = 120;
const BATCH_SIZE = 6;

const SYSTEM = `You read a Customer Success Manager's past meeting notes and identify which of their performance goals each note provides evidence for.

Be strict. A contribution is work the CSM did or drove that measurably advances a listed goal. These are NOT contributions:
- attending a meeting, taking notes, or a topic merely coming up
- the customer mentioning interest, or a plan with no action taken
- routine check-ins, scheduling, and status updates
Most notes contribute to nothing. Returning an empty array is the expected answer for a typical note.

Rules:
- Use a goal name exactly as listed. Never invent a goal.
- At most one entry per note per goal, and usually zero or one entry per note.
- Only include a metric the note actually states. Never estimate or infer progress.
- The contribution must be verifiable from the note's own text.
- Respond with ONLY a JSON array, no prose.`;

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

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const body = await request.json();
    const {
      mode = "preview",
      vaultPath,
      goals = [],
      startDate,
      endDate,
      apiKey,
      openaiApiKey,
      model,
      replacements = [],
      corrections = [],
      files: applyFiles = [],
    } = body;

    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");

    if (mode === "apply") {
      let notesUpdated = 0;
      let notesSkipped = 0;
      const updatedFiles = [];
      for (const file of applyFiles) {
        const filePath = resolveInsideDirectory(resolvedVault, file?.relativePath || "", "Note");
        if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== ".md") {
          notesSkipped += 1;
          continue;
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const updated = insertGoalSection(content, file.contributions || []);
        if (updated === null) {
          // Someone (or an earlier run) added the section since the preview.
          notesSkipped += 1;
          continue;
        }
        const backupPath = backUpNote(resolvedVault, filePath);
        fs.writeFileSync(filePath, updated, "utf-8");
        notesUpdated += 1;
        updatedFiles.push({ relativePath: file.relativePath, backupPath });
      }
      return NextResponse.json({ notesUpdated, notesSkipped, updatedFiles });
    }

    // ---- preview ----
    if (!goals.length) {
      return NextResponse.json({ error: "Add your performance goals in Settings first." }, { status: 400 });
    }

    const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const end = endDate ? new Date(`${endDate}T23:59:59`) : null;
    if (start && end && (end - start) / 86_400_000 > MAX_RANGE_DAYS) {
      return NextResponse.json({ error: `Date range is limited to ${MAX_RANGE_DAYS} days.` }, { status: 400 });
    }

    const candidates = [];
    let alreadyRecorded = 0;
    for (const file of collectNoteFiles(resolvedVault, "")) {
      if (/^(Performance Review|EA Activity Report)\b/i.test(file.filename)) continue;
      let content;
      try {
        content = fs.readFileSync(file.filePath, "utf-8");
      } catch {
        continue;
      }
      const date = noteDate(file.filePath, file.filename, content);
      if (!date) continue;
      if (start && date < start) continue;
      if (end && date > end) continue;
      if (hasGoalSection(content)) {
        alreadyRecorded += 1;
        continue;
      }
      candidates.push({
        relativePath: path.relative(resolvedVault, file.filePath),
        title: path.basename(file.filename, ".md"),
        folder: file.folder,
        date: date.toISOString().slice(0, 10),
        excerpt: goalEvidenceExcerpt(content),
      });
    }
    candidates.sort((a, b) => b.date.localeCompare(a.date));

    const truncated = candidates.length > MAX_NOTES;
    const scoped = candidates.slice(0, MAX_NOTES);

    const warnings = [];
    if (truncated) {
      warnings.push(`${candidates.length} notes are missing the section; the newest ${MAX_NOTES} were read. Narrow the date range and run again for the rest.`);
    }
    if (!scoped.length) {
      return NextResponse.json({
        notes: [],
        stats: { candidates: 0, alreadyRecorded, withContributions: 0, contributions: 0, dropped: 0 },
        warnings,
      });
    }

    const clean = (text) => applyReplacements(applyCorrections(String(text || ""), corrections), replacements);
    const client = createModelClient({ model: model || FAST_MODEL, apiKey, openaiApiKey, task: "fast", signal: request.signal });
    const goalList = goals
      .map((goal) => `- ${goal.name}${goal.target ? ` (target: ${goal.target})` : ""}`)
      .join("\n");

    const proposals = new Map(); // relativePath -> contributions[]
    let dropped = 0;
    const usage = { input_tokens: 0, output_tokens: 0 };

    for (const batch of chunk(scoped, BATCH_SIZE)) {
      const payload = batch.map((note, index) => ({
        id: index,
        date: note.date,
        account: note.folder || "vault root",
        note: clean(note.title),
        text: clean(note.excerpt),
      }));
      try {
        const msg = await client.messages.create({
          model: client.resolvedModel,
          max_tokens: 2000,
          system: SYSTEM,
          messages: [{
            role: "user",
            content: `GOALS:\n${clean(goalList)}\n\nNOTES (JSON):\n${JSON.stringify(payload, null, 1)}\n\nReturn a JSON array of {"id": <note id>, "goal": "<exact goal name>", "contribution": "<what this note shows was accomplished, one short sentence>", "metric": "<figure the note states, or omit>"}. Return [] when no note clearly advances a goal.`,
          }],
        });
        usage.input_tokens += msg.usage?.input_tokens || 0;
        usage.output_tokens += msg.usage?.output_tokens || 0;

        const result = parseBackfillVerdicts(firstTextBlock(msg), batch, goals);
        if (result.parseFailed) {
          warnings.push(`One batch of ${batch.length} notes returned an unreadable answer and was skipped.`);
          continue;
        }
        dropped += result.dropped;
        for (const [relativePath, items] of result.byNote) {
          proposals.set(relativePath, items.map((item) => ({
            goal: item.goal,
            contribution: reverseReplacements(item.contribution, replacements),
            metric: reverseReplacements(item.metric, replacements),
          })));
        }
      } catch (err) {
        warnings.push(`A batch of ${batch.length} notes failed: ${err.message}`);
      }
    }

    const notes = scoped.map(({ excerpt, ...note }) => ({
      ...note,
      contributions: proposals.get(note.relativePath) || [],
    }));
    const contributions = notes.reduce((sum, note) => sum + note.contributions.length, 0);

    return NextResponse.json({
      notes,
      stats: {
        candidates: scoped.length,
        alreadyRecorded,
        withContributions: notes.filter((note) => note.contributions.length).length,
        contributions,
        dropped,
      },
      warnings,
      usage,
      model: client.resolvedModel,
    });
  } catch (error) {
    console.error("Goal backfill error:", error);
    return NextResponse.json({ error: error?.message || "Goal backfill failed" }, { status: error?.status || 500 });
  }
}
