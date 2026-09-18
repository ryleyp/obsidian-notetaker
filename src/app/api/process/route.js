import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import { looksSpeakerLabeled } from "@/lib/speakers";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { maxOutputTokens } from "@/lib/models";
import { buildSourceBundle, formatSourceBundleForPrompt } from "@/lib/sourceBundle";
import { activityWritingRules, classificationGuidance, taxonomyForReportPrompt } from "@/lib/sfdcTaxonomy";
import { GOAL_SECTION_HEADING, NO_CONTRIBUTIONS, formatGoalsForPrompt } from "@/lib/goals";
import { detectHealthSession, healthSessionPrompt } from "@/lib/healthSession";

const SYSTEM_PROMPT = `You are an expert meeting notes specialist working for a Customer Success Manager (CSM) at NI (National Instruments). The person who recorded this meeting is that CSM — their job is driving adoption, expansion, and renewal of NI products at large customer accounts.

Domain context — interpret the transcript through this lens:
- NI Software: LabVIEW, TestStand, SystemLink (Server/Enterprise/SLE/SLS), FlexLogger, VeriStand, DIAdem, InstrumentStudio, DAQmx, driver stacks, Enterprise Agreements (EA), training credits, license/entitlement management.
- NI Hardware: PXI, CompactDAQ/cDAQ, CompactRIO/cRIO, VST, SMU, oscilloscopes, RF instrumentation, and how hardware attach relates to software adoption.
- Test & measurement engineering: automated test systems, HIL, validation/production test, instrument control, measurement data management. Terms like "DAQ", "rigs", "test stands", "sequences", and "drivers" mean their T&M sense, not general IT.
- Ambiguous transcription of product names should resolve to the closest NI product (e.g. "test stand" in a software context is likely TestStand).

Your notes must be complete AND tight — capture every important fact, decision, and discussion from the transcript, but state each one exactly once, in the fewest words that preserve the specifics. Consolidate related points instead of scattering them; never pad, restate, or editorialize. Frame relevance from the CSM's perspective: customer adoption signals, license/EA questions, support issues, expansion or renewal implications, and commitments the CSM made. Honor section-specific word limits even when the rest of the note should stay detailed.

Do NOT include personal updates, personal check-ins, or personal anecdotes (e.g. weekend plans, health updates, family news, personal status). Focus only on business-relevant content.

Keep the notes factual, not emotional. Do not include sentiment analysis, vibe reads, mood commentary, or speculation about how people felt. Stated positions are facts and belong in the notes — record an objection, concern, or agreement as what the person said ("Dana pushed back on the migration timeline"), without emotional interpretation ("Dana seemed frustrated").

Always respond with ONLY the Markdown content, no preamble or explanation.`;

// Account names are customer data, so they are injected from the caller's
// configured account list rather than hardcoded into the prompt. Each
// account's keywords double as its division/business-unit tags.
function buildAccountTagLines(accounts = []) {
  const named = accounts.filter((a) => a?.name && a.name !== "Internal");
  if (!named.length) {
    return "- Accounts / customers: any company or customer name that is clearly a customer or account being discussed\n";
  }

  const aliasList = named
    .flatMap((a) => [a.name, ...(a.aliases || [])])
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  let out = `- Accounts / customers: ${[...new Set(aliasList)].join(", ")} — and any other company or customer name that is clearly a customer or account being discussed\n`;

  for (const a of named) {
    const divisions = (a.keywords || []).filter(Boolean);
    if (divisions.length) {
      out += `- ${a.name} divisions or business units (only if explicitly called out): ${divisions.join(", ")}\n`;
    }
  }
  return out;
}

function buildTagCategories(accounts) {
  const accountLines = buildAccountTagLines(accounts);
  return `
Extract tags ONLY if explicitly mentioned in the transcript. Use lowercase, no spaces (use hyphens for multi-word).

Categories to check:
- Cities: austin, dallas, houston, denver, seattle, chicago, boston, san-francisco, new-york, nashville, atlanta, phoenix, minneapolis, raleigh, detroit, los-angeles, portland, columbus, indianapolis, etc.
- US States: texas, colorado, washington, california, illinois, massachusetts, ohio, georgia, michigan, tennessee, north-carolina, florida, arizona, minnesota, oregon, etc.
- NI Software: systemlink, labview, teststand, diadem, flexlogger, veristand, ni-daqmx, labwindows-cvi, measurement-studio, ni-visa, opentestbed, etc.
- Software / Dev languages & tools: python, c, c-plus-plus, matlab, java, javascript, typescript, dotnet, rust, sql, r, julia, simulink, etc.
- Other tools or platforms mentioned prominently (e.g. github, azure, aws, jira, confluence, salesforce)
${accountLines}- CS program terms: proficiencyplan, flexcredits, snowsupport, enterpriseagreement — tag if these programs or concepts are explicitly discussed
- Training: tag as proficiencyplans if training, onboarding, skill-building, or learning resources for NI tools are discussed

Only include a tag if that city/state/technology is actually discussed — not just briefly mentioned in passing.`;
}

const SFDC_ACTIVITY_RULES = `
Rules for the SFDC Activity Entry section:

APPROVED TYPE AND SUBTYPE OPTIONS — copy the exact text; Subtype must come from the chosen Type's list. Read the descriptions and the real filed examples: they show the title style and comment voice that gets posted.
${taxonomyForReportPrompt()}

${classificationGuidance()}
- Subtype must come from the chosen type's list; if none fit, use "Other" within that type. Top-level "Other" type always outputs "Subtype: Other".
- Prefer "Account Planning" or "Other" for NI-internal work, with an outcome-focused description.
- If the meeting spans onboarding and training, classify by account stage — new/ramping accounts default to Onboarding & Kick-Off.

RECOMMENDED TITLE
- The Salesforce-ready title that will actually be filed: a short engagement title naming the engagement AND its purpose, in the style of the examples above: "Beacon Systems RF User Group - March 2026", "CSM / FAE Cardinal Account Interlock", "Acme Aerospace Proficiency Plan - LabVIEW Core Training Scheduling", "Acme Space User Group Debrief and DC Power Session Selection".
- Purpose is what makes a title useful: "Engineering sponsor sync on adoption blockers and Q3 rollout timing" beats "User group sponsor sync". Name the initiative, customer team, site, or product when it helps someone find this record later.
- Not the file name, not an email subject line: no dates at the front, no "RE:"/"FW:", no "Email -". At most 200 characters; never blank.

REPORTABLE
- "Yes" when this is an EA engagement the account team would log in Salesforce: customer-facing work, or NI-internal work that produced a concrete decision or outcome.
- "No" — with a short reason after a dash — for manager 1:1s, team or staff meetings, career or scorecard conversations, training the CSM took, routine internal syncs with no decision, and anything not about this account's EA. Still fill in every other line; the entry stays in the note either way.

SUMMARY/NOTES RULES

${activityWritingRules()}

- Exactly three labeled lines, in this order: Summary, Outcomes, Next steps. No other headings or sections inside this block.
- HARD LIMIT: the entire Summary/Notes block — Summary + Outcomes + Next steps combined, including the labels — must be at most 120 words and 800 characters or fewer. This is a Salesforce field limit, not a target. Draft, count the words, then trim until it is 120 or fewer: cut the weakest detail, not the outcomes or next steps. Never exceed it.
- This block is pasted into a plain-text SFDC Comment field, so keep each section as a labeled run of plain sentences ("Summary: ...", "Outcomes: ...", "Next steps: ...") — no bullets, no bold, no sub-lists inside it.
- Past tense, no first person ("I"/"we"). Refer to the CSM as "CSM" — never by name — since this text is read by people who don't know who wrote it.
- Persona: write like a CSM in their late twenties/around 27, a couple years into the role, with an engineering degree — reads like notes typed up right after the call, not an AI-cleaned recap. Plain, conversational-professional language, not heavy business jargon (avoid "synergy," "leverage," "circle back," "bandwidth," "actionable," "value-add," etc.). Grounded and direct, no stiff transitions or corporate filler.
- Lead with outcome and business value, not meeting logistics. Every entry answers: what happened, who was involved, and why it matters to adoption, expansion, renewal, or risk.
- Name customer contacts by name with their role or company when the sources state it ("Dana Whitfield, IT Admin Lead"; "Jordan (GTS, Acme Aerospace)"). Name NI colleagues by role (FAE, AM) and name only when it matters.
- The CSM's participation: state it only when the CSM led, ran, or presented ("CSM led the EA admin sync..."). Never write that the CSM observed, listened, attended silently, or "was present" — when they didn't lead, describe the meeting itself and leave the CSM's participation unmentioned.
- Say what the CSM actually did when the sources show it — drove, defined, coordinated, decided, submitted — not just that a meeting happened. Never manufacture CSM leadership the sources don't support.
- User Groups (Demo Days / User Group): the Summary line carries "Region: [X], Attendees: [# or TBD]" and the Outcomes line states the impact (adoption, expansion, risk reduction, customer momentum), matching the format in the taxonomy.
- Outcomes: if the transcript has no clear outcome, write "Outcomes: None stated" — never invent one.
- Next steps: only the CSM's own owned actions (skip customer/other-team to-dos unless they gate a CSM action), top 1-3, phrased as concrete actions. If none, write "Next steps: None".
- Budget the 800 characters across the three labels. When it is tight, cut background from Summary first — what the CSM did and what came of it are the parts a reviewer is actually looking for.
- Do not invent attendees, regions, outcomes, or next steps that aren't supported by the transcript or the CSM's own context/notes.
- Exclude raw internal complaints/blame, speculative pricing or forecast figures, and anything the account team wouldn't want visible in CRM.

POSTABILITY CHECK — the entry is copied into Salesforce exactly as written, so before output confirm every line below. An entry that fails any of them is rewritten, not shipped:
- 120 words / 800 characters or fewer for the whole Summary/Notes block
- No "I", "we", "our", "my" — past tense, "CSM" as the subject when one is needed
- The CSM's name appears nowhere; customer contacts are named with role when known
- No source markers like [T1] or [N1], no Markdown, no bullets, no placeholders like [Name] or [#] (an honest "TBD" for an attendee count is fine)
- No "CSM attended / observed / listened"
- No corporate filler: synergy, leverage, circle back, bandwidth, actionable, value-add, touch base
- Type and Subtype copied character-for-character from the list
- All three labels present: Summary, Outcomes, Next steps
- The Summary says what the CSM actually did, not only that a meeting happened
- No revenue causation the sources do not state`;

export function buildPrompt(
  transcript,
  meetingTitle,
  suggestedAgreements = [],
  meetingContext = "",
  { sourceBundle, accounts = [], followUp, ownerNames = [], ownerPronouns = "", goals = [] } = {}
) {
  const title = meetingTitle || "Meeting Notes";
  const sources = sourceBundle || buildSourceBundle({ transcript, rawNotes: meetingContext });
  const sourceBlock = formatSourceBundleForPrompt(sources) || `[T1] Transcript\n${transcript}`;
  const transcriptLabels = new Set((sources.transcriptSources || []).map((source) => source.label));
  const hasMultipleTranscripts = transcriptLabels.size > 1;
  const transcriptEvidence = (sources.transcriptSources || [])
    .map((source) => source.content)
    .join("\n\n") || transcript;

  const multiTranscriptGuidance = hasMultipleTranscripts
    ? `
MULTIPLE TRANSCRIPTS OF THE SAME MEETING:
- The Primary transcript and Extended transcript describe the same meeting and may overlap substantially.
- Merge their evidence into one chronological account. Include unique details from either recording, but do not repeat a point, decision, or action item just because it appears in both.
- When both sources support the same claim, cite the relevant blocks from both. If wording differs, use the version with more context; do not treat ordinary transcription variation as a factual conflict.
- If the sources directly contradict each other on a material fact and context cannot resolve it, call out the discrepancy as unresolved instead of silently choosing one.
`
    : "";

  // A scorecard session carries an extra layer of sections; an ordinary
  // meeting gets an empty string here and the standard note.
  const healthSession = detectHealthSession({ title, transcript: transcriptEvidence, context: meetingContext });
  const healthSessionBlock = healthSessionPrompt(healthSession);

  const isMigration = (sources.existingNoteSources || []).length > 0;

  const migrationBlock = isMigration
    ? `
EXISTING NOTE MIGRATION
This run updates an existing Obsidian note for the same meeting. Source blocks labeled [O#] contain the old note.
- Rebuild the document in the required format below; do not preserve the old layout just because it appears in [O#].
- Preserve useful manual details, attendee roles, customer/site facts, decisions, and callouts from [O#] when the transcript does not contradict them.
- The transcript is authoritative for what was said. When [O#] conflicts with [T#], use [T#] and do not repeat the stale claim.
- Do not duplicate a fact merely because it appears in both the transcript and old note.
- Treat summaries, inferred sentiment, action-item wording, and other generated prose in [O#] as secondary; independently regenerate them from the underlying evidence.
- Older notes may contain a "Sentiment & Vibe" section or other sentiment commentary. Drop it entirely — the current format contains no sentiment analysis. Preserve any factual detail inside it (a stated objection, a named blocker) by moving that fact into the appropriate section, stripped of emotional interpretation.
`
    : "";

  // Extra background and/or the CSM's own handwritten notes, typed in by the
  // CSM alongside the transcript. Treated as a trusted second source.
  const contextBlock = meetingContext.trim()
    ? `
CONTEXT & NOTES FROM THE CSM (trusted supplemental source — the CSM wrote this themselves):
${meetingContext.trim()}

WHO LED / THE CSM'S ROLE: when these notes say who ran or led the meeting, who presented, or what the CSM's role was (led it, co-presented, observed silently), that statement is AUTHORITATIVE — it overrides any guess from the transcript. Use it for attributing first-person commitments (if the CSM says they led the meeting, the leading speaker's "I'll send that over" is the CSM's action item; if they say they only observed, no first-person commitment in the dialogue is theirs) and for choosing the SFDC type (e.g. an NI-led demo vs. a customer-run user group). In the SFDC Activity Entry: if the CSM led, ran, or presented, say so ("CSM led..."); if the CSM only observed or attended, do NOT mention that — just describe what happened in the meeting without commenting on the CSM's level of participation.

Use this to interpret the transcript (attendees, roles, account background, meeting purpose) AND as source material in its own right: observations, decisions, or action items that appear only in the CSM's notes belong in the meeting notes and SFDC entry just like transcript content. If the CSM's notes and the transcript conflict, prefer the transcript for what was literally said, but keep the CSM's framing of why it matters. Do not quote the CSM's notes as if someone said them aloud in the meeting.

CONFLICT FLAGGING: If the CSM's notes DIRECTLY conflict with the transcript on a fact — a different number, date, owner, decision, product, or outcome — you MUST surface it. Insert a section titled "## ⚠️ Conflicts With Your Notes" immediately after the Executive Summary (this is an allowed addition to the required structure below). List each conflict as its own bullet: "Your notes say [X], but the transcript says [Y]" — quote or closely paraphrase both sides so the CSM can resolve it. In the body of the notes, use the transcript's version. Do NOT silently pick one side, and do NOT include this section at all when there are no direct conflicts. Differences in emphasis or detail level are not conflicts — only contradictions are.
`
    : "";

  // EA/EP numbers matched to this meeting by keyword (matching done client-side
  // against the raw transcript). Listed in the SFDC entry so they can be copied
  // into Salesforce; Claude only echoes them, it does not invent numbers.
  // Performance-review goals the CSM is measured on. The section is omitted
  // entirely when no goals are configured, so nothing invents one; when they
  // are, only evidence actually present in the sources may be recorded.
  const goalList = formatGoalsForPrompt(goals);
  const goalSection = goalList
    ? `---

## ${GOAL_SECTION_HEADING}

The CSM is measured on the goals below this year. Record ONLY what this meeting genuinely contributed to one of them — work the CSM did or drove, a measurable result, or a concrete step toward the target. One line per contribution, in this exact format:
- **Goal:** [goal name, copied exactly from the list] | **Contribution:** [what happened that advances it] | **Metric:** [number or measure if the sources state one; omit this part entirely when they do not]

GOALS:
${goalList}

Rules for this section:
- Use a goal name exactly as written above. Never invent a goal that is not listed.
- A meeting usually contributes to zero or one goal. Do not stretch: attending a meeting, discussing a topic, or a customer mentioning something is not a contribution.
- Only record a metric the sources actually state. Never estimate, extrapolate, or infer progress toward a target.
- Write "${NO_CONTRIBUTIONS}" when nothing in this meeting clearly advances a listed goal — that is the normal case for most meetings.

`
    : "";

  const agreementBlock = suggestedAgreements.length
    ? `\nEA/EP NUMBERS ON FILE FOR THIS ACCOUNT (matched to this meeting by keyword): ${suggestedAgreements.map((g) => `${g.type} ${g.number}`).join(", ")}. In the SFDC Activity Entry, output an "**EA/EP Number(s):**" line listing the one(s) relevant to what this meeting was actually about, copied verbatim. If more than one clearly applies, list all. Do not invent or alter numbers, and do not list a number if nothing in the meeting relates to it.`
    : `\nNo EA/EP numbers are on file for this account. In the SFDC Activity Entry, output "**EA/EP Number(s):** None on file".`;

  // Who the recording CSM is, so their first-person commitments get a real,
  // filterable owner instead of "me" or a speaker label.
  const csmNames = (ownerNames || []).map((n) => String(n || "").trim()).filter(Boolean);
  const pronounRule = String(ownerPronouns || "").trim()
    ? ` The CSM's pronouns are ${String(ownerPronouns).trim()}: use those, or no pronoun at all, whenever the note refers to them.`
    : "";
  const csmIdentityBlock = csmNames.length
    ? `
THE CSM (NOTE OWNER): The CSM saving this note is known as: ${csmNames.join(", ")}.${pronounRule} The CSM is NOT necessarily a speaker — in many meetings they attend silently and only record. Never assume a first-person statement ("I'll send that over", "let me check") came from the CSM.
- Attribute a commitment to "${csmNames[0]}" ONLY when the evidence shows the CSM said it: the CSM's context/notes state who led the meeting or what their role was (authoritative — see the CONTEXT section), the speaker label is the CSM's name (or one of the names above), the CSM is addressed by name right before replying, or the dialogue otherwise makes the speaker unambiguous. In that case write "${csmNames[0]}" as the owner — never "me", "we", or "I".
- When a first-person commitment comes from an unidentified or generically labeled speaker, keep that speaker's label as the owner (e.g. "Speaker 2") — do not reassign it to the CSM.
- For items owned by NI Customer Success as a team rather than the CSM personally, write "**Owner:** CS/CSM team".
- Do not miss implicit commitments: "I'll send that over", "let me check on that", "I can set that up" are action items even when nobody calls them action items — owned by whoever actually said them.
- If the CSM never speaks in the transcript, they own no action items from the dialogue; the Next Steps and SFDC "Next steps" reflect only what the CSM's own context/notes say they will do (or "None").
`
    : "";

  const speakerGuidance = looksSpeakerLabeled(transcriptEvidence)
    ? `
This transcript has been segmented by speaker — each turn is preceded by a label like **Name:** or **Speaker 1:**. Use these labels to attribute statements, decisions, questions, and commitments to the correct person throughout your notes (e.g. "David raised concerns about..." or "Speaker 2 confirmed..."). Do not blend or merge different speakers' statements together. When listing action item owners, use the specific speaker who committed to the item rather than a generic "team," unless it is genuinely a group commitment. The labels are a best-effort inference from conversational patterns, not verified — if a label is a generic "Speaker N" (no real name was available), it's fine to refer to that person by that label in your notes.
`
    : "";

  const followUpOutput = followUp?.enabled
    ? `

FOLLOW-UP EMAIL OUTPUT (required):
After the complete SFDC Activity Entry, append this exact separator and heading:

---

## Follow-Up Email Draft

Draft a concise email with a subject line for this audience and tone:
- Audience: ${followUp.audience || "customer"}
- Tone: ${followUp.tone || "warm-professional"}

Lead with thanks and the meeting outcome. Include only supported follow-ups, asks, owners, due dates, and relevant context. Separate CSM-owned actions from customer-owned actions when both exist. Do not include source citations, internal-only commentary, account strategy, or sentiment analysis. This section will be removed from the meeting note and stored as a separate Obsidian file.
`
    : "";

  return `Please analyze this meeting transcript and create detailed meeting notes.

Meeting Title: ${title}
${csmIdentityBlock}${speakerGuidance}${multiTranscriptGuidance}${contextBlock}
---
SOURCE BLOCKS:
${sourceBlock}
---
${migrationBlock}

${buildTagCategories(accounts)}

SOURCE CITATION RULES
- Use only the source block IDs above as citations.
- Add citations to every factual bullet or factual paragraph outside the SFDC Activity Entry, using markers like [T1] or [N1].
- Put citations at the end of the sentence or bullet they support.
- Use [N#] for claims that come from the CSM's raw notes/context and [T#] for transcript claims.
- Use [O#] for details preserved from the existing meeting note during a migration.
- If a point is synthesized from multiple sources, cite each relevant source, e.g. [T2] [N1].
- Do not put citation markers inside the SFDC Activity Entry because it is copied into Salesforce.

Generate the meeting notes with EXACTLY this structure. Do NOT include a YAML frontmatter block.

Length: Meeting Notes is the section of record and has no length limit — make it as long as the
material genuinely warrants, measured in facts captured, not words spent. Consolidation rules still
apply: every fact once, tersely. The only capped section in this note is the SFDC Activity Entry,
whose limit is a Salesforce field constraint and still applies exactly as specified above.

# ${title}

<tag line: list extracted tags inline as #tag1 #tag2 #tag3>

---

## Executive Summary

Write 3-5 sentences capturing the overall purpose, key outcomes, and most important decisions from this meeting. This is a scannable overview, so keep it tight even though the notes below are complete.

---

## Meeting Notes

Provide complete, consolidated bulleted notes covering everything of substance in the sources. This is the section of record: someone who missed the meeting should be able to read it instead of the transcript and miss nothing that matters — but read it in a fraction of the time. Completeness is about facts, not word count: keep every specific, cut every wasted word.

- Cover every topic discussed, one bullet per topic thread with sub-bullets for its supporting detail. If a topic resurfaces later in the meeting, fold the new detail into that topic's existing bullet instead of starting a new one.
- State each fact, decision, and detail exactly once. Merge overlapping points into a single bullet; never restate the same point in different words or under multiple topics.
- Capture the specifics that get lost in summaries: names, numbers, dates, versions, product names, license and entitlement details, system and environment details, error messages, quantities, and timelines.
- Record decisions with the reasoning behind them, not just the outcome, and note who made or drove each one.
- Record open questions, disagreements, unresolved threads, and anything explicitly deferred — mark them as unresolved rather than implying closure.
- Preserve the substance of notable exchanges: what was asked, what the answer was, and any stated concern or objection. Report what was said, not how anyone seemed to feel about it.
- Where a speaker is identifiable, attribute the point to them.
- Write in tight note style: no throat-clearing lead-ins, no transitional filler, no commentary on the meeting itself.

Skip entirely: filler, verbatim repetition, small talk, personal updates or check-ins, and sentiment or mood commentary. When in doubt about whether a factual detail belongs, include it — but include it once, tersely. Do not editorialize or invent anything absent from the sources.

${healthSessionBlock ? `${healthSessionBlock}

` : ""}---

## Things NI SW Customer Success Should Take Note Of

Flag the most important items for NI Software's Customer Success team. Include: adoption signals, product usage concerns, explicitly stated customer complaints or positive feedback, risks to renewal or expansion, opportunities for CS to engage, and any commitments made to the customer. Be concise — one clear bullet per point, no filler.

---

## User-Level Callouts

Call out specific customer users, stakeholders, sponsors, admins, evaluators, champions, blockers, or NI/internal contacts who matter to account planning. Include only people actually mentioned in the transcript. For each person, capture role/team if stated, relationship or influence if stated, account-relevant context, and any follow-up implication. If no specific people are mentioned, write "Nothing noted."

- **[Name]** — [role/team or "not stated"]: [account-relevant context and planning implication]

---

## Site-Level Callouts

Call out specific customer sites, labs, campuses, buildings, cities, or named locations mentioned in the transcript. Include only locations actually mentioned. For each site/location, capture associated people or teams if stated, NI software/product context if stated, risks/blockers, and any site-level planning implication. If no specific sites or locations are mentioned, write "Nothing noted."

- **[Site / lab / location]** — [site context, associated stakeholders/teams, software context, and planning implication]

---

## Action Items

List all action items as Markdown task checkboxes. For each item include who owns it and a due date if mentioned. Format:
- [ ] [Action item description] — **Owner:** [Name or Team] | **Due:** [Date or "TBD"]

---

## Next Steps

List the agreed-upon next steps, upcoming milestones, follow-up meetings, or planned deliverables in priority order. Do not restate items already listed under Action Items — this section is for milestones and plans that are not individual owned tasks. If everything agreed upon is already covered by Action Items, write "Covered by Action Items above."

${goalSection}---

## SFDC Activity Entry

A Salesforce-ready activity entry for this meeting, following the rules below. Output EXACTLY this shape and nothing else in this section — no extra headings, bullets, or commentary.

The no-length-limit instruction applies to Meeting Notes and NOT to this section. This section is pasted into a Salesforce field: the Summary/Notes block (Summary + Outcomes + Next steps, including the labels) must be 120 words or fewer and 800 characters or fewer. Write the block, count the words, and trim until it fits before you output it. Detail that does not fit belongs in Meeting Notes above, not here.

**Recommended Title:** <Salesforce-ready title, per the RECOMMENDED TITLE rules>

**Type:** <one approved type>
**Subtype:** <matching subtype from that type's list>
**EA/EP Number(s):** <relevant number(s) from the list below, or "None on file">
**Reportable:** <Yes, or "No — reason">

**Summary/Notes:**
Summary: <who took part with roles, what drove the engagement, what was covered, and what the CSM did about it>
Outcomes: <what was confirmed, or "None stated"; label anything expected as expected>
Next steps: <the CSM's own 1-3 owned actions, or "None">
${SFDC_ACTIVITY_RULES}
${agreementBlock}${followUpOutput}`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      transcript,
      meetingTitle,
      apiKey,
      openaiApiKey,
      model,
      suggestedAgreements = [],
      meetingContext = "",
      sourceBundle,
      accounts = [],
      followUp,
      ownerNames = [],
      ownerPronouns = "",
      goals = [],
    } = body;

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }


    const client = createModelClient({ model, apiKey, openaiApiKey, signal: request.signal });
    const selectedModel = client.resolvedModel;

    const stream = client.messages.stream({
      model: selectedModel,
      max_tokens: maxOutputTokens(selectedModel),
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildPrompt(transcript, meetingTitle, suggestedAgreements, meetingContext, {
          accounts,
          sourceBundle,
          followUp,
          ownerNames,
          ownerPronouns,
          goals,
        }),
      }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              send({ type: "delta", text: chunk.delta.text });
            }
          }
          const finalMsg = await stream.finalMessage();
          send({ type: "done", usage: finalMsg.usage, model: selectedModel });
        } catch (err) {
          send({ type: "error", message: err?.message || "Processing failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error processing transcript:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process transcript" },
      { status: error?.status || 500 }
    );
  }
}
