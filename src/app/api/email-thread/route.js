import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { DEFAULT_MODEL, firstTextBlock, maxOutputTokens } from "@/lib/models";
import { buildSourceBundle, formatSourceBundleForPrompt } from "@/lib/sourceBundle";

const SYSTEM_PROMPT = `You turn customer-success email threads into concise Obsidian notes for an NI Customer Success Manager.

Use only the provided email-thread and CSM context sources. Do not invent decisions, owners, dates, commitments, links, prices, or attendees. Keep internal strategy and customer-visible facts clearly separated. Keep the note tight and factual: state each fact once, consolidate related points, and do not add sentiment analysis, mood commentary, or speculation about how anyone felt — record stated positions as what was said. Always respond with only Markdown.`;

export function buildEmailThreadPrompt({
  emailThread,
  threadTitle = "Email Thread",
  threadDate,
  context = "",
  sourceBundle,
  ownerNames = [],
}) {
  const title = threadTitle || "Email Thread";
  const sources = sourceBundle || buildSourceBundle({ emailThread, rawNotes: context });
  const sourceBlock = formatSourceBundleForPrompt(sources) || `[E1] Email thread\n${emailThread}`;

  const csmNames = (ownerNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  const csmIdentityBlock = csmNames.length
    ? `
THE CSM (NOTE OWNER): The CSM saving this note is known as: ${csmNames.join(", ")}. In Action Items, attribute commitments this person makes in the thread to "${csmNames[0]}" as the owner — never "me" or "I" — and write "**Owner:** CS/CSM team" for NI Customer Success team items.
`
    : "";

  const isUpdate = (sources.existingNoteSources || []).length > 0;
  const updateBlock = isUpdate
    ? `
EXISTING NOTE UPDATE
This thread already has an Obsidian note from an earlier version of the thread. Source blocks labeled [O#] contain that note. New responses have arrived since it was written.
- Regenerate the full note in the required structure, covering the ENTIRE thread — the earlier messages and the new responses — as one consolidated note. Lead each section with what is newest.
- Preserve manual details, CSM context, decisions, and callouts from [O#] that the emails do not contradict, citing [O#].
- The email thread is authoritative for what was written. When [O#] conflicts with [E#], use [E#] and drop the stale claim.
- Never state a fact twice because it appears in both the old note and the thread — state it once with both citations.
- Carry forward action items from [O#] that are still open. If a newer response completes one, mark it done (- [x]) instead of dropping it; if a newer response supersedes one, replace it.
`
    : "";

  return `${isUpdate ? "Update the existing Obsidian note for this email thread with the newest responses." : "Create an Obsidian note from this email thread."}

Thread Title: ${title}
Thread Date: ${threadDate || "Not specified"}
${csmIdentityBlock}
SOURCE BLOCKS:
${sourceBlock}
${updateBlock}
Rules:
- Use only source block IDs above as citations.
- Cite every factual bullet or factual paragraph with [E#] or [N#]${isUpdate ? ", or [O#] for details preserved from the existing note" : ""}.
- Do not include citation markers in the raw Source Email section.
- Capture what the thread contains, what changed, what was decided, and what follow-up is needed.
- If no decision was made, write "No explicit decisions in this thread."
- If an item is a proposal, request, or opinion rather than a decision, label it that way.
- Skip signatures, legal disclaimers, repeated quoted history, and email-client boilerplate.
- Do not include personal updates or unrelated chatter.
- Do not include YAML frontmatter.

Generate exactly this structure:

# ${threadDate ? `${threadDate} - ` : ""}${title}

<tag line: list extracted tags inline as #email-thread plus any explicit product/account/topic tags>

---

## Thread Summary

Write 2-4 concise bullets describing the business-relevant content of the thread.

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

Capture named people, roles, stated responsibilities, preferences, concerns, commitments, and relationship context. Write "Nothing noted." when the thread contains none.

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

**Type:** <one approved type below>
**Subtype:** <a subtype listed under that type>
**EA/EP Number(s):** <a number explicitly present in the sources, or "None on file">

**Summary/Notes:**
Summary: <what the email thread covered and what happened>
Outcomes: <explicit outcomes, or "None stated">
Next steps: <the CSM's own 1-3 actions, or "None">

Approved Type → Subtype pairs:
- Training or Support Webinar → Other
- Internal Alignment and Collaboration → Account Planning; Account Team Kickoff; Product Feedback
- Onboarding & Kick-off → EA Admin Onboarding; EA End-User Kick-off; Other
- Strategic Relationship Management → EA Admin Sync; Escalation / Risk Management; QBR / EBR; Product Roadmap Review; SystemLink Enterprise Governance; Other
- User Groups → Demo Day; User Group; Other
- Value Realization and Success Stories → Case Study; Customer Testimonial; Outcome Review; SystemLink ROI Review; Other
- Other → Other

Choose the primary purpose of the thread and the most specific valid pair. The Summary/Notes block must be 120 words or fewer and 800 characters or fewer. Use past tense, no first person, no citations, and do not invent outcomes, owners, numbers, or next steps.`;
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
      model,
      sourceBundle,
      ownerNames = [],
    } = body;

    if (!emailThread?.trim()) {
      return NextResponse.json({ error: "Email thread is required" }, { status: 400 });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Anthropic API key is required. Add it in Settings or set ANTHROPIC_API_KEY in .env.local" },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey: key });
    const selectedModel = model || DEFAULT_MODEL;
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
