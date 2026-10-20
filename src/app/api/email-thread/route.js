import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock, maxOutputTokens } from "@/lib/models";
import { buildSourceBundle, formatSourceBundleForPrompt } from "@/lib/sourceBundle";
import { activityWritingRules, classificationGuidance, taxonomyForReportPrompt } from "@/lib/sfdcTaxonomy";

const SYSTEM_PROMPT = `You turn customer-success threads — Outlook email threads and Microsoft Teams chat threads — into concise Obsidian notes for an NI Customer Success Manager.

Use only the provided email-thread and CSM context sources. Do not invent decisions, owners, dates, commitments, links, prices, or attendees. Keep internal strategy and customer-visible facts clearly separated. Keep the note tight and factual: state each fact once, consolidate related points, and do not add sentiment analysis, mood commentary, or speculation about how anyone felt — record stated positions as what was said. Always respond with only Markdown.`;

export function buildEmailThreadPrompt({
  emailThread,
  threadTitle = "Email Thread",
  threadDate,
  context = "",
  sourceBundle,
  ownerNames = [],
  threadKind = "email",
  threadParticipants = "",
}) {
  const isTeams = threadKind === "teams";
  const kindNoun = isTeams ? "Teams chat thread" : "email thread";
  const title = threadTitle || (isTeams ? "Teams Thread" : "Email Thread");
  const sources = sourceBundle || buildSourceBundle({ emailThread, rawNotes: context });
  const sourceBlock = formatSourceBundleForPrompt(sources) || `[E1] ${isTeams ? "Teams chat thread" : "Email thread"}\n${emailThread}`;

  // Per-kind reading guidance. The email form explains Outlook headers; the
  // Teams form explains the chat paste format and the interface noise that
  // rides along with a copy.
  const formatRule = isTeams
    ? `- The thread is a pasted Microsoft Teams chat. Messages appear as a name-and-timestamp line followed by the message; treat each message's author like a sender, and a standalone date-divider line as the date of the messages after it. Ignore chat noise: reaction counts and emoji reactions, "Edited" markers, system messages (someone joined, was added, or renamed the chat; meeting started/ended cards), and leftover interface text from copying (such as "Reply", "has context menu", or avatar initials).
- Messages may also appear as "[time] Sender: message" lines. A sender named "You" is the CSM (the note owner): attribute that person's commitments to the CSM's name, never to "You" or "me". A sender of "[sender not visible]" means attribution is unknown: record the point in Notes, and for a to-do from that message write **Owner:** unclear rather than guessing.`
    : `- Skip signatures, legal disclaimers, repeated quoted history, and email-client boilerplate.`;

  const csmNames = (ownerNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  const csmIdentityBlock = csmNames.length
    ? `
THE CSM (NOTE OWNER): The CSM saving this note is known as: ${csmNames.join(", ")}. In ${isTeams ? "To-Dos" : "Action Items"}, attribute commitments this person makes in the thread to "${csmNames[0]}" as the owner — never "me" or "I" — and write "**Owner:** CS/CSM team" for NI Customer Success team items.
`
    : "";

  const isUpdate = (sources.existingNoteSources || []).length > 0;
  const updateBlock = isUpdate
    ? `
EXISTING NOTE UPDATE
This thread already has an Obsidian note from an earlier version of the thread. Source blocks labeled [O#] contain that note. New responses have arrived since it was written.
- Regenerate the full note in the required structure, covering the ENTIRE thread — the earlier messages and the new responses — as one consolidated note. Lead each section with what is newest.
- Preserve manual details, CSM context, decisions, and callouts from [O#] that the ${isTeams ? "messages" : "emails"} do not contradict${isTeams ? "" : ", citing [O#]"}.
- The ${kindNoun} is authoritative for what was written. When [O#] conflicts with [E#], use [E#] and drop the stale claim.
- Never state a fact twice because it appears in both the old note and the thread — state it once${isTeams ? "" : " with both citations"}.
- Carry forward ${isTeams ? "to-dos" : "action items"} from [O#] that are still open. If a newer response completes one, mark it done (- [x]) instead of dropping it; if a newer response supersedes one, replace it.
- Directly under the # title line, maintain an italic thread-history line showing each update's date: take the dates from [O#]'s existing "*Thread history:*" line when present (otherwise start with the old note's date) and append this update's date${threadDate ? ` (${threadDate})` : ""}. Format: *Thread history: 2026-08-20 → 2026-08-26*
`
    : "";

  const participantNames = String(threadParticipants || "").trim();
  const participantsBlock = participantNames
    ? `
PARTICIPANTS (from the CSM): ${participantNames}. These are the people in the chat. Use these names, normalized to "First Last", in the Participants line and when attributing to-dos. Chat pastes often truncate names or show only initials — match those against this list instead of inventing new people.
`
    : "";

  // A Teams chat is usually straightforward, so its note is deliberately
  // minimal: who was in it, the concrete details, and the to-dos. No
  // citations, no callout sections, no SFDC entry.
  if (isTeams) {
    return `${isUpdate ? "Update the existing Obsidian note for this Teams chat thread with the newest messages." : "Create a SHORT Obsidian note from this Teams chat thread."}

A Teams chat is usually straightforward — the note should be too. Capture the concrete details and the to-dos, nothing else: no analysis, no relationship commentary, no CRM entry.

Thread Title: ${title}
Thread Date: ${threadDate || "Not specified"}
${csmIdentityBlock}${participantsBlock}
SOURCE BLOCKS:
${sourceBlock}
${updateBlock}
Rules:
- Teams writes names as "Last, First" (last name first, separated by a comma). That is ONE person. Write every name as "First Last" and never split one such name into two people. Treat the "Last, First" form, the "First Last" form, and a bare first name as the same person.
${formatRule}
- Keep it brief: one bullet per point, keep the specifics (names, numbers, dates, versions, products, links), cut everything else. No source citations in this note.
- Do not include personal updates, unrelated chatter, sentiment commentary, or YAML frontmatter.

Generate exactly this structure:

# ${threadDate ? `${threadDate} - ` : ""}${title}

*Participants: <everyone in the chat as First Last, comma-separated — the CSM's list plus anyone else who wrote>*

<tag line: list extracted tags inline as #teams-thread plus any explicit product/account/topic tags>

---

## Notes

Concise bullets covering what was shared, asked, answered, or decided — just the details someone would need later. A short thread may only need 2-3 bullets.

End this section with exactly one line assessing whether the CSM owes a reply:
**Response needed:** Yes — <the specific question, request, or open ball in the CSM's court> | or: **Response needed:** No
Base it on the NEWEST messages: a thread where the CSM answered last, or that is purely informational with no ask, is "No".

---

## To-Dos

Every task, follow-up, or commitment from the chat as Markdown checkboxes:
- [ ] [Task description] — **Owner:** [Name or Team] | **Due:** [Date or "TBD"]

Write "No to-dos in this thread." when there are none.`;
  }

  return `${isUpdate ? `Update the existing Obsidian note for this email thread with the newest responses.` : `Create an Obsidian note from this email thread.`}

Thread Title: ${title}
Thread Date: ${threadDate || "Not specified"}
${csmIdentityBlock}
SOURCE BLOCKS:
${sourceBlock}
${updateBlock}
Rules:
- Outlook and Teams often write names as "Last, First" (last name first, separated by a comma). That is ONE person. Normalize every name to "First Last" everywhere in the note — attribution, action-item owners, callouts, and the SFDC entry — and never output the "Last, First" form. When splitting To/Cc recipient lists, treat each "Last, First" pair as a single recipient (Outlook separates recipients with semicolons); never turn one person into two. Recognize that the "Last, First" form, the "First Last" form, and a bare first name in the message body are the same person.
- Skip signatures, legal disclaimers, repeated quoted history, and email-client boilerplate.
- Use only source block IDs above as citations.
- Cite every factual bullet or factual paragraph with [E#] or [N#]${isUpdate ? ", or [O#] for details preserved from the existing note" : ""}.
- Do not include citation markers in the raw Source Email Content section.
- Capture what the thread contains, what changed, what was decided, and what follow-up is needed.
- If no decision was made, write "No explicit decisions in this thread."
- If an item is a proposal, request, or opinion rather than a decision, label it that way.
- Do not include personal updates or unrelated chatter.
- Do not include YAML frontmatter.

Generate exactly this structure:

# ${threadDate ? `${threadDate} - ` : ""}${title}

<tag line: list extracted tags inline as #email-thread plus any explicit product/account/topic tags>

---

## Thread Summary

Write 2-4 concise bullets describing the business-relevant content of the thread.

End this section with exactly one line assessing whether the CSM owes a reply:
**Response needed:** Yes — <the specific question, request, or open ball in the CSM's court> | or: **Response needed:** No
Base it on the NEWEST messages: a thread where the CSM answered last, or that is purely informational with no ask, is "No". A customer question, request, unresolved ask, or anything awaiting the CSM is "Yes".

---

## Decisions

List explicit decisions as bullets. Include who decided or agreed if stated.

---

## Open Questions

List unresolved questions, asks, blockers, or missing information.

---

## Action Items

List action items as Markdown task checkboxes. Format:
- [ ] [Action item description] — **Owner:** [Name or Team] | **Due:** [Date or "TBD"]

---

## Attendee Callouts

Track everyone on the thread — senders and To/Cc recipients from the email headers, as well as people mentioned in the messages. For each: name, email/company when shown, role if stated, plus responsibilities, preferences, concerns, commitments, and relationship context. When updating an existing note, carry forward participants from [O#] even if they didn't write in the newest messages, and add anyone new. Write "Nothing noted." when the thread contains none.

---

## Site-Level Callouts

Capture specific customer sites, labs, campuses, buildings, cities, or named locations and the people, work, risks, or plans tied to each. Write "Nothing noted." when the thread contains none.

---

## Customer Success Callouts

Capture account-planning implications, risks, adoption signals, renewal/expansion relevance, stakeholder signals, and sensitive context the CSM should remember. Write "Nothing noted." when the thread contains none.

---

## Source Email Content

Summarize the thread chronologically, newest-to-oldest if the source makes that clear. Preserve the substance of important asks, replies, decisions, and commitments, but do not copy long disclaimers or signatures.

---

## SFDC Activity Entry

Create a Salesforce-ready activity entry for this email thread. Output exactly this shape inside this section:

**Recommended Title:** <a short Salesforce-ready engagement title in the style of the examples — account, what it was and why, month or product when useful; never the subject line, no "RE:"/"FW:", no dates, at most 200 characters>

**Type:** <one approved type below>
**Subtype:** <a subtype listed under that type>
**EA/EP Number(s):** <a number explicitly present in the sources, or "None on file">
**Reportable:** <Yes when this is an EA engagement worth logging; "No — reason" for internal chatter or threads with no outcome>

**Summary/Notes:**
Summary: <who was on the thread with roles, what drove it, what it covered, and what the CSM did about it>
Outcomes: <what was confirmed, or "None stated">
Next steps: <the CSM's own 1-3 actions, or "None">

Approved Type → Subtype pairs (copy the exact text; the examples show the title style and comment voice that gets posted):
${taxonomyForReportPrompt()}

${classificationGuidance()}

${activityWritingRules()}

The Summary/Notes block is copied into Salesforce as written: all three labels (Summary, Outcomes, Next steps); 120 words or fewer and 800 characters or fewer; past tense; no "I"/"we"/"our"; no citations, Markdown, or placeholders; refer to the CSM as "CSM", never by name; name customer contacts with their role when the thread states it; never write that the CSM observed or attended; no corporate filler (synergy, leverage, circle back, bandwidth, actionable, value-add); and do not invent outcomes, owners, numbers, or next steps.`;
}

// The fixed instruction text of every prompt shape this route can build. The
// privacy boundary skips lines that exactly match it, so example names in our
// own instructions are never mistaken for the user's data.
export function promptTemplateText() {
  const existing = buildSourceBundle({ emailThread: "a", rawNotes: "n", existingNote: "o" });
  return [
    SYSTEM_PROMPT,
    buildEmailThreadPrompt({ emailThread: "", threadKind: "email" }),
    buildEmailThreadPrompt({ emailThread: "", threadKind: "teams" }),
    buildEmailThreadPrompt({ emailThread: "a", threadKind: "email", sourceBundle: existing }),
    buildEmailThreadPrompt({ emailThread: "a", threadKind: "teams", sourceBundle: existing }),
  ].join("\n");
}

export async function createEmailThreadMessage(client, request) {
  const stream = client.messages.stream(request);
  return stream.finalMessage();
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      emailThread,
      threadTitle,
      threadDate,
      context = "",
      apiKey,
      openaiApiKey,
      model,
      sourceBundle,
      ownerNames = [],
      threadKind = "email",
      threadParticipants = "",
      privacyTerms = [],
    } = body;

    if (!emailThread?.trim()) {
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
    const msg = await createEmailThreadMessage(client, {
      model: selectedModel,
      max_tokens: maxOutputTokens(selectedModel),
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildEmailThreadPrompt({
          emailThread,
          threadTitle,
          threadDate,
          context,
          sourceBundle,
          ownerNames,
          threadKind,
          threadParticipants,
        }),
      }],
    });

    const note = firstTextBlock(msg).trim();

    return NextResponse.json({ note, usage: msg.usage, model: selectedModel });
  } catch (error) {
    console.error("Email thread note error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create email thread note" },
      { status: error?.status || 500 }
    );
  }
}
