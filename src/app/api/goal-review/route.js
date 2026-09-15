import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { createModelClient } from "@/lib/modelClient";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { firstTextBlock, maxOutputTokens } from "@/lib/models";
import { collectNoteFiles, noteDate } from "@/lib/vaultScan";
import { harvestGoalContributions } from "@/lib/goalHarvest";

// Two modes:
//   "scan"      — read every note in the range across the whole vault and
//                 group the goal contributions they already record. No model
//                 call: the CSM reviewed each contribution when the note was
//                 saved, so this is a read, not an inference.
//   "summarize" — turn those grouped contributions into review prose. The
//                 groups are supplied by the caller (possibly edited), and
//                 the model may only use what is in them.

const MAX_RANGE_DAYS = 400;

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const body = await request.json();
    const {
      mode = "scan",
      vaultPath,
      goals = [],
      startDate,
      endDate,
      groups = [],
      instructions = "",
      apiKey,
      openaiApiKey,
      model,
      replacements = [],
      corrections = [],
    } = body;

    if (mode === "scan") {
      if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
      const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");

      const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
      const end = endDate ? new Date(`${endDate}T23:59:59`) : null;
      if (start && end && (end - start) / 86_400_000 > MAX_RANGE_DAYS) {
        return NextResponse.json({ error: `Date range is limited to ${MAX_RANGE_DAYS} days.` }, { status: 400 });
      }

      const notes = [];
      for (const file of collectNoteFiles(resolvedVault, "")) {
        // Saved review documents are output, not evidence.
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
        notes.push({
          date: date.toISOString().slice(0, 10),
          title: path.basename(file.filename, ".md"),
          folder: file.folder,
          content,
        });
      }

      const { groups: harvested, stats } = harvestGoalContributions(notes, goals);
      return NextResponse.json({ groups: harvested, stats });
    }

    if (!Array.isArray(groups) || !groups.length) {
      return NextResponse.json({ error: "Nothing to summarize yet — scan for contributions first." }, { status: 400 });
    }

    const clean = (text) => applyReplacements(applyCorrections(String(text || ""), corrections), replacements);
    const evidence = groups.map((group) => ({
      goal: clean(group.goal?.name),
      target: clean(group.goal?.target),
      contributions: (group.contributions || []).slice(0, 60).map((item) => ({
        date: item.date,
        contribution: clean(item.contribution),
        metric: clean(item.metric),
        source: clean(item.noteTitle),
      })),
    }));

    const client = createModelClient({ model, apiKey, openaiApiKey, signal: request.signal });
    const system = `You write a Customer Success Manager's self-assessment for a performance review, using only the evidence supplied.

Rules:
- Use ONLY the contributions given. Never invent work, numbers, outcomes, or dates.
- Never claim a target was met unless the evidence states a figure that shows it. When evidence is thin, say so plainly — an honest "limited evidence recorded this period" is more useful than inflated prose.
- Group by goal, in the order given. For each: a short paragraph of what was actually accomplished, then the strongest two or three specific examples as bullets, each naming its source note.
- Plain, factual, first-person-free language. No corporate filler ("synergy", "leverage", "circle back"), no inflated impact claims.
- A goal with no contributions gets one honest line saying nothing was recorded for it this period.
- Respond with Markdown only, starting at "## <goal name>" for the first goal. No preamble.`;

    const msg = await client.messages.stream({
      model: client.resolvedModel,
      max_tokens: maxOutputTokens(client.resolvedModel),
      system,
      messages: [{
        role: "user",
        content: `${clean(instructions) || "Write the review section for each goal below."}\n\nEVIDENCE (JSON):\n${JSON.stringify(evidence, null, 1)}`,
      }],
    }).finalMessage();

    const summary = reverseReplacements(firstTextBlock(msg), replacements);
    return NextResponse.json({ summary, usage: msg.usage, model: client.resolvedModel });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Goal review failed" }, { status: error?.status || 500 });
  }
}
