import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { scrubWithExceptions } from "@/lib/scrub";
import { firstTextBlock, maxOutputTokens } from "@/lib/models";
import {
  buildStatusUpdatePrompt,
  checkStatusUpdate,
  parseStatusUpdate,
  recentStatusNotes,
} from "@/lib/statusUpdate";

// The short shareable status update. Deliberately a small model call over a
// small window: the point is a paragraph someone can read in ten seconds,
// drawn from what has happened on the account lately.

const MAX_NOTES = 40;

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const {
      notes = [],
      account = "",
      accountName = "",
      allAccounts = [],
      productFocus = "",
      divisionsOrSites = "",
      priorUpdate = "",
      today = new Date().toISOString().slice(0, 10),
      includeRisk = true,
      includeNextStep = true,
      knownNames = [],
      replacements = [],
      corrections = [],
      restoredIds = [],
      apiKey,
      openaiApiKey,
      model,
    } = await request.json();

    const accountLabel = account || accountName;
    if (!accountLabel) return NextResponse.json({ error: "An account is required" }, { status: 400 });

    // Only the reporting window, newest first.
    const { notes: windowed, older } = recentStatusNotes(notes, { today: new Date(`${today}T12:00:00`) });
    if (!windowed.length) {
      return NextResponse.json({
        error: `No notes in the last 30 days for ${accountLabel}. A status update reports on recent activity, so there is nothing to draw from.`,
      }, { status: 422 });
    }

    // Same privacy pipeline the reports use: other accounts scrubbed out in
    // original-name space, then pseudonymized, then restored on the way back.
    const clean = (text) => applyReplacements(applyCorrections(String(text || ""), corrections), replacements);
    const scrubbed = scrubWithExceptions(
      windowed.slice(0, MAX_NOTES).map((note) => ({ ...note, content: applyCorrections(String(note.content || ""), corrections) })),
      accountName || accountLabel,
      allAccounts,
      restoredIds
    ).map((note) => ({ date: note.date, title: clean(note.title), content: clean(note.content) }));

    const client = createModelClient({ model, apiKey, openaiApiKey, signal: request.signal, task: "fast" });
    const prompt = buildStatusUpdatePrompt({
      account: clean(accountLabel),
      productFocus: clean(productFocus),
      divisionsOrSites: clean(divisionsOrSites),
      today,
      priorUpdate: clean(priorUpdate),
      notes: scrubbed,
      includeRisk,
      includeNextStep,
    });

    const msg = await client.messages.create({
      model: client.resolvedModel,
      max_tokens: Math.min(maxOutputTokens(client.resolvedModel), 2000),
      system: "You write short, plain, shareable account status updates. Follow the requested shape exactly and output nothing else.",
      messages: [{ role: "user", content: prompt }],
    });

    const restore = (text) => reverseReplacements(text, replacements);
    const parsed = parseStatusUpdate(restore(firstTextBlock(msg)));
    const { fixed, flags } = checkStatusUpdate(parsed, {
      account: accountLabel,
      today,
      // Real names are the thing this update must never carry, so the
      // glossary and the CSM's own names are checked by name, not by shape.
      knownNames: [...knownNames, ...replacements.map((r) => r?.original).filter(Boolean)],
      accountTerms: [accountLabel, productFocus, divisionsOrSites].filter(Boolean),
      notesOutsideWindow: older,
    });

    return NextResponse.json({
      update: fixed,
      flags,
      sourceNotes: scrubbed.map((note) => ({ date: note.date, title: restore(note.title) })),
      notesOutsideWindow: older,
      usage: msg.usage,
      model: client.resolvedModel,
    });
  } catch (error) {
    console.error("Status update error:", error);
    return NextResponse.json({ error: error?.message || "Status update failed" }, { status: error?.status || 500 });
  }
}
