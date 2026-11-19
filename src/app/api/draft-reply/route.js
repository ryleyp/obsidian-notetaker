import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import { pseudonymizeEmails, restoreEmails } from "@/lib/privacyBoundary";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";
import { CSM_REPLY_PRACTICES } from "@/lib/replyGuidance";
import { REPLY_CHECKS_HEADING } from "@/lib/replyDraft";

const SYSTEM_PROMPT = `You draft replies for an NI Customer Success Manager to send on an email thread or a Microsoft Teams chat.

Write in the CSM's own first-person voice: warm, plain, and professional. Use only the provided thread, note, and account context. Do not invent facts, commitments, dates, links, prices, or people. Respond with only Markdown.`;

const AUDIENCES = {
  customer: "Customer contacts. Everything in the reply must be safe for the customer to read.",
  internal: "NI colleagues only. Internal context is fine; stay direct and brief.",
  mixed: "Customer contacts with NI colleagues copied. Treat it as customer-facing.",
};

const TONES = {
  "warm-professional": "Warm and professional",
  "concise-direct": "Concise and direct",
  technical: "Technical and precise",
  executive: "Executive: brief, outcome first",
};

export function buildReplyPrompt({
  thread,
  note = "",
  context = "",
  accountContext = "",
  threadTitle = "",
  threadKind = "email",
  ownerNames = [],
  reason = "",
  audience = "customer",
  tone = "warm-professional",
  instructions = "",
  previousDraft = "",
}) {
  const isTeams = threadKind === "teams";
  const csmNames = (ownerNames || []).map((name) => String(name || "").trim()).filter(Boolean);
  const csmLine = csmNames.length
    ? `The CSM sending this reply is known as: ${csmNames.join(", ")}. Messages from this person (or from "You") are the CSM's own; never reply to them as if someone else wrote them.`
    : `Messages from "You" are the CSM's own.`;

  const shape = isTeams
    ? `Write a Teams chat message: no subject line, no formal greeting block, and no signature. Keep it to a few sentences, or a short list when there are several points.`
    : `Write an email reply. Start with a line "**Subject:** RE: <the thread subject>", then a greeting by first name, the body, and a simple sign-off with the CSM's first name when it is known. Keep it as short as the newest message allows.`;

  const blocks = [
    `${isTeams ? "TEAMS CHAT THREAD" : "EMAIL THREAD"} (the newest messages are what the reply answers):\n${thread}`,
    note?.trim() ? `NOTE ALREADY WRITTEN FROM THIS THREAD (internal; a guide to what matters, not text to copy):\n${note.trim()}` : "",
    context?.trim() ? `CONTEXT FROM THE CSM:\n${context.trim()}` : "",
    accountContext?.trim() ? `RECENT ACCOUNT HISTORY FROM THE CSM'S NOTES (internal; newest first):\n${accountContext.trim()}` : "",
    previousDraft?.trim() ? `PREVIOUS DRAFT (revise this one according to the CSM's instruction):\n${previousDraft.trim()}` : "",
  ].filter(Boolean).join("\n\n=====\n\n");

  return `Draft the reply the CSM should send on this ${isTeams ? "Teams chat" : "email thread"}.

Thread Title: ${threadTitle || "Not specified"}
${csmLine}
Audience: ${AUDIENCES[audience] || AUDIENCES.customer}
Tone: ${TONES[tone] || TONES["warm-professional"]}
${reason?.trim() ? `Why a reply is owed: ${reason.trim()}\n` : ""}${instructions?.trim() ? `Instruction from the CSM (this takes priority over the defaults below):\n${instructions.trim()}\n` : ""}
Rules:
- Answer the newest messages addressed to the CSM. Cover every open question or request in them, and do not recap the rest of the thread.
- Use the account history to get the details right: what was already agreed, what is still open, and who owns it. Mention an earlier commitment only when it bears on this reply.
- The note and the account history are internal. In a customer-facing reply, carry over only facts the customer already knows or that are plainly safe to share.
- Where a needed fact is missing from the sources, write a bracketed placeholder such as [CSM to confirm: renewal date] instead of guessing.
- Do not include source citation markers.
- ${shape}

${CSM_REPLY_PRACTICES}

After the reply, add this exact separator and heading, then one to four short bullets naming what the CSM should verify or fill in before sending (each placeholder, any assumption, anyone who should be copied). Write "- Nothing to confirm." when there is nothing.

---

${REPLY_CHECKS_HEADING}

SOURCES:

${blocks}`;
}

// The fixed instruction text of every prompt shape this route can build, so
// the privacy boundary does not mistake our own wording for the user's data.
export function promptTemplateText() {
  const shapes = [];
  for (const threadKind of ["email", "teams"]) {
    for (const audience of Object.keys(AUDIENCES)) {
      for (const tone of Object.keys(TONES)) {
        shapes.push(buildReplyPrompt({ thread: "", threadKind, audience, tone }));
      }
    }
  }
  return [SYSTEM_PROMPT, ...shapes].join("\n");
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { thread, apiKey, openaiApiKey, model, privacyTerms = [], ...fields } = body;

    if (!thread?.trim()) {
      return NextResponse.json({ error: "Thread content is required" }, { status: 400 });
    }

    const client = createModelClient({
      model,
      apiKey,
      openaiApiKey,
      signal: request.signal,
      privacy: { sensitiveTerms: privacyTerms, templateText: promptTemplateText() },
    });
    const selectedModel = client.resolvedModel;
    // A leftover email address is swapped for a placeholder and restored in the
    // draft, so it never leaves.
    const { params: outbound, restorations } = pseudonymizeEmails({
      model: selectedModel,
      max_tokens: 8_000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildReplyPrompt({ thread, ...fields }) }],
    });
    const msg = await client.messages.create(outbound);
    const draft = restoreEmails(firstTextBlock(msg).trim(), restorations);

    return NextResponse.json({ draft, usage: msg.usage, model: selectedModel });
  } catch (error) {
    console.error("Reply draft error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to draft reply" },
      { status: error?.status || 500 }
    );
  }
}
