import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { BATCH_TEMPORAL_RULE, TEMPORAL_ACCURACY_RULE, dateSortValue } from "@/lib/synthesisPolicy";

function buildExclusionList(accountName, allAccounts) {
  if (!allAccounts?.length) return "";
  const others = allAccounts.filter((a) => a.name !== accountName && a.name !== "Internal");
  if (!others.length) return "";

  const accountLines = others.map((a) => {
    const aliases = (a.aliases || []).join(", ");
    return aliases ? `  - ${a.name} (also referred to as: ${aliases})` : `  - ${a.name}`;
  });

  const keywordLines = others
    .filter((a) => a.keywords?.length)
    .map((a) => `  - ${a.keywords.join(", ")} → belong to ${a.name}, do not include in this summary`);

  let out = `\nOther customer accounts — NEVER mention them by name or alias:\n${accountLines.join("\n")}\n`;

  if (keywordLines.length) {
    out += `\nFORBIDDEN KEYWORDS — these terms are exclusively tied to other accounts. If you see them in a source, skip that content entirely. Do NOT write them anywhere in the output:\n${keywordLines.join("\n")}\n`;
  }

  return out;
}

function buildSynthesisPrompt(notes, today, accountName, allAccounts) {
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const rangeLabel = `${threeMonthsAgo.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} – ${new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const acct = accountName && accountName !== "Internal" ? accountName : null;

  const noteBlocks = notes
    .map((n) => {
      const tag = n.source === "cross-vault" ? ` [${n.sourceLabel}]` : "";
      return `### ${n.date} — ${n.title}${tag}${n._dayLabel || ""}\n\n${n.content}`;
    })
    .join("\n\n---\n\n");

  const accountScope = acct
    ? `This is an Account Status report for **${acct} ONLY**.

CRITICAL ACCOUNT SCOPING RULES — these override everything else:
- Report exclusively on ${acct}. Do NOT discuss, compare to, or mention any other customer account by any name or alias.
- Some sources come from other folders and may contain content about other accounts. Use ONLY the portions that pertain to ${acct}. Ignore everything about any other account, even within the same note.
- If a source mentions ${acct} only in passing, extract just the ${acct}-relevant parts.
- If a source has no ${acct} content, ignore it entirely.
- Never write a sentence that is about another account. The reader only cares about ${acct}.
${buildExclusionList(acct, allAccounts)}
`
    : "";

  return `You are a NI Software Customer Success Manager analyzing ${notes.length} meeting notes and transcripts from the past quarter (${rangeLabel}). Produce a detailed Account Status summary scoped to NI Software.

${accountScope}Scope rules:
- Focus on NI Software products, licenses, adoption, and CS activities${acct ? ` at ${acct}` : ""}
- Third-party software: mention briefly if relevant to NI context
- Hardware: mention only when directly tied to NI software usage
- Omit purely hardware or non-NI topics
- **Demo sessions and user groups:** If a source is a demo session, NI user group, or similar event, do NOT include generic product details or feature overviews from it. Only include content from those sources if there was a specific customer discussion, question, reaction, or account-relevant context around a product — e.g. a customer asked about it, expressed interest, raised a concern, or it was discussed in relation to their environment.

Sources include Obsidian meeting notes and notes from other folders that mention this account [folder name].

---
SOURCES:

${noteBlocks}

---

Generate the Account Status document using EXACTLY this structure. Be specific — reference actual names, dates, products, and details from the sources. Do not be vague.${acct ? ` Remember: ${acct} ONLY — never mention another account.` : ""}

**Source ordering:** Sources below are in chronological order — oldest first, newest last. Within a single day, meetings tagged *(earliest same-day meeting)* happened before those tagged *(latest same-day meeting)*. The last source to address any topic is the most recent and authoritative.

**Output ordering:** Within every section, present information newest-first. Lead with the most recent developments, then older context below.

**Citation rule:** When referencing a specific note, cite it by its session date (e.g. "per the 2026-05-14 meeting" or "as of 2026-04-02"). Do NOT use "Source 1", "Source 2", or any numbered references.

${TEMPORAL_ACCURACY_RULE}

# ${acct ? `${acct} ` : ""}Account Status — ${rangeLabel}

*Synthesized from ${notes.length} sources*

---

## Recent Highlights

Key decisions, outcomes, and notable updates from the quarter scoped to NI Software. Group by theme or project. Include specifics — names, dates, numbers, product names.

---

## Open Action Items

Aggregate ALL unchecked action items (- [ ]) from across all sources. Include owner and source date. Omit items resolved in a later note.

- [ ] [Action item] — **Owner:** [Name] | **From:** [Date]

---

## Pillars of Account Health

For each pillar: assign a **G/Y/R** rating, explain it in 1–2 sentences, then list all relevant details as bullets with sub-bullets. Write "Nothing noted this quarter." if no relevant information exists.

---

### Proficiency & Self Service — [G/Y/R]

*Are we building NI tool skill and self-service capability at this account? How are we scaling it?*

**Strategy sub-areas:**
- **Proficiency Plans** — Are there plans for new and/or experienced users? What's the status?
- **L&D Integration** — Is NI collateral embedded into the account's learning & development approach?
- **Onboarding** — Is NI being injected into the account's new-hire or team onboarding process?

[Details from sources]

---

### Adoption — [G/Y/R]

*What opportunities exist to drive new users or new NI products into successful use? What's needed to make them successful?*

**Strategy sub-areas:**
- **Evaluations & Pilots** — Any active SW evaluations or pilots? Are we providing hypercare?
- **Deployment Strategies** — Are we working with sponsors on SW deployment plans?
- **Access Enablement** — Has access been customized to the account's structure or needs?
- **Support & Case Trends** — Are there recurring support issues or case trends we should address?

[Details from sources]

---

### Sponsors & End Users — [G/Y/R]

*What relationships are we building? How are we elevating trust and closeness with key people?*

**Strategy sub-areas:**
- **Sponsor Engagement** — Who are the influential sponsors? What's our engagement strategy?
- **End-User Outreach** — Are we capturing end-user insight? Any outreach strategy in place?
- **Interaction Cadence** — What travel, meetings, or comms cadence do we have with this account?

[Details from sources]

---

### Expansion — [G/Y/R]

*What parts of the NI Software portfolio is the customer not using today? Why? How could we introduce them?*

**Strategy sub-areas:**
- **Whitespace Assessment** — What NI SW products/licenses are they not using? Why?
- **Expansion Investigation** — What potential expansion areas have been identified or discussed?
- **Success Collateral** — Have we created or shared NI success content to support growth conversations?

[Details from sources]

---

### Renewal Readiness — [G/Y/R]

*What risks and opportunities should we address before the next EA/VLA renewal?*

**Strategy sub-areas:**
- **Risk Identification** — What renewal risks exist? Are they being actively managed?
- **SSM Negotiation Points** — Are SSMs equipped with the right talking points for renewal?
- **Sponsor Leverage** — Are we using sponsor relationships to reduce churn risk?

[Details from sources]

---

### Overall CS Score — [G/Y/R]

**Overall Health:** [2–4 sentence description of the account's CS posture based on all five pillars]

**Overall Risks & Areas Requiring CS or AM Support:**
- [bullet list of key risks and escalation needs]

**Renewal Status:** [Low / Medium / High / No Risk] — [1–2 sentence rationale]

**Expansion Pipeline:**
- [bullet list of any mentioned expansion opportunities, scoped to NI SW]

---

## Digital Progress

Summarize what is known about the account's software and OS environment from the sources. Include versions, lab or location names, and any upgrade or migration activity mentioned. If nothing is noted, write "No software/OS environment details noted this quarter."

**Software Versions in Use:**
- [Product/tool name] — [version or tier, lab/location if known]

**Operating Systems:**
- [OS name and version] — [lab/location or team if known]

**Upgrade or Migration Activity:**
- [Any mentioned upgrades, planned migrations, or version-change discussions]

---

## Key Themes & Trends

3–5 bullets identifying recurring topics, risks, or patterns across multiple sources this quarter.

---

## Information Changes

List any cases where a newer source contradicts, reverses, or materially updates something stated in an older source. If none exist, write "No contradictions or reversals noted this quarter."

- **[Topic]** — Previously (as of [older date]): [old info]. Updated (as of [newer date]): [new info].

---

## Recommended Next Steps

Highest-priority next steps for the CS team in the coming weeks, in priority order. Scoped to NI Software activities.`;
}

function buildProductPrompt(notes, today, product, accountName, allAccounts) {
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const rangeLabel = `${threeMonthsAgo.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} – ${new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;

  const acct = accountName && accountName !== "Internal" ? accountName : null;

  const noteBlocks = notes
    .map((n) => {
      const tag = n.source === "cross-vault" ? ` [${n.sourceLabel}]` : "";
      return `### ${n.date} — ${n.title}${tag}${n._dayLabel || ""}\n\n${n.content}`;
    })
    .join("\n\n---\n\n");

  const p = product.name;
  const aliases = product.aliases?.join(", ") || p;

  const accountScope = acct
    ? `This report covers **${p} at ${acct} ONLY**.

CRITICAL ACCOUNT SCOPING RULES — these override everything else:
- Report exclusively on ${acct}'s use of ${p}. Do NOT discuss, compare to, or mention any other customer account by any name or alias.
- Some sources come from other folders and may contain content about other accounts. Use ONLY the portions about ${acct}. Ignore everything about any other account, even within the same note.
- If a source has no ${acct} + ${p} content, ignore it entirely.
- Never write a sentence about ${p} at another account. The reader only cares about ${acct}.
${buildExclusionList(acct, allAccounts)}
`
    : "";

  return `You are a NI Software Customer Success Manager reviewing ${notes.length} meeting notes and transcripts from the past quarter (${rangeLabel}). Produce a focused **${p} Account Status**${acct ? ` for ${acct}` : ""} covering only content relevant to ${p} (also referred to as: ${aliases}).

${accountScope}Scope rules:
- Focus exclusively on ${p}${acct ? ` at ${acct}` : ""} — licensing, adoption, deployment, support, training, and expansion
- Mention integrations with other NI tools only when directly tied to ${p}
- Omit topics unrelated to ${p}
- **Demo sessions and user groups:** If a source is a demo session, NI user group, or similar event, do NOT include generic ${p} product details or feature overviews from it. Only include content from those sources if there was a specific customer discussion, question, reaction, or account-relevant context — e.g. a customer asked about ${p}, expressed interest, raised a concern, or it was discussed in relation to their environment.

---
SOURCES:

${noteBlocks}

---

Generate the ${p} Account Status using EXACTLY this structure. Be specific — reference actual names, dates, product tiers, and details from the sources.${acct ? ` Remember: ${acct} ONLY — never mention another account.` : ""}

**Source ordering:** Sources below are in chronological order — oldest first, newest last. Within a single day, meetings tagged *(earliest same-day meeting)* happened before those tagged *(latest same-day meeting)*. The last source to address any topic is the most recent and authoritative.

**Output ordering:** Within every section, present information newest-first. Lead with the most recent developments, then older context below.

**Citation rule:** When referencing a specific note, cite it by its session date (e.g. "per the 2026-05-14 meeting" or "as of 2026-04-02"). Do NOT use "Source 1", "Source 2", or any numbered references.

${TEMPORAL_ACCURACY_RULE}

# ${p} Account Status${acct ? ` — ${acct}` : ""} — ${rangeLabel}

*Synthesized from ${notes.length} sources*

---

## Recent Highlights

Key decisions, outcomes, and updates related to ${p} this quarter. Include names, dates, product tiers (e.g. Base, Pro, SLS, SLE), and specifics.

---

## Open Action Items

Aggregate ALL unchecked action items (- [ ]) related to ${p} from across all sources.

- [ ] [Action item] — **Owner:** [Name] | **From:** [Date]

---

## ${p} Pillars

### Proficiency & Self Service — [G/Y/R]

*Are users building skill with ${p}? Is the account moving toward self-service?*

- **Proficiency Plans** — Training status for new and experienced ${p} users
- **L&D Integration** — Is ${p} content embedded in the account's learning approach?
- **Onboarding** — Is ${p} part of new-hire or team onboarding?

[Details from sources, or "Nothing noted this quarter."]

---

### Adoption — [G/Y/R]

*What is the current ${p} footprint? Who is using it and how actively?*

- **Active Tiers / SKUs** — Which ${p} products/tiers are deployed and in use?
- **Evaluations & Pilots** — Any active ${p} evaluations? Are we providing hypercare?
- **Deployment & Access** — Is ${p} deployed broadly? Any access or config blockers?
- **Support & Case Trends** — Any recurring ${p} support issues or open cases?

[Details from sources, or "Nothing noted this quarter."]

---

### Sponsors & End Users — [G/Y/R]

*Who owns and champions ${p} at this account? Who are the power users?*

- **${p} Sponsor(s)** — Who is the internal champion? How engaged are they?
- **End-User Insight** — Are we capturing feedback from ${p} end users?
- **Engagement Cadence** — How frequently are we meeting with ${p} stakeholders?

[Details from sources, or "Nothing noted this quarter."]

---

### Expansion — [G/Y/R]

*What ${p} tiers, modules, or use cases are untapped at this account?*

- **Whitespace** — Which ${p} tiers or add-ons are they NOT using? Why?
- **Expansion Opportunities** — Any discussed or identified growth areas?
- **Success Collateral** — Have we shared ${p} success stories or ROI content?

[Details from sources, or "Nothing noted this quarter."]

---

### Renewal Readiness — [G/Y/R]

*What is the ${p} renewal risk or opportunity heading into the next EA/VLA?*

- **Risk Factors** — Any dissatisfaction, low usage, or competitive threats related to ${p}?
- **SSM Talking Points** — What renewal narrative supports ${p} value?
- **Sponsor Leverage** — Are we using relationships to protect ${p} in renewal?

[Details from sources, or "Nothing noted this quarter."]

---

### Overall ${p} Health Score — [G/Y/R]

**Health Summary:** [2–3 sentences on the account's ${p} posture based on the five pillars above]

**Risks & Escalation Needs:**
- [bullet list]

**Renewal Status:** [Low / Medium / High / No Risk] — [1–2 sentence rationale]

**Expansion Pipeline:**
- [bullet list of ${p}-specific expansion opportunities]

---

## Digital Progress

Summarize what is known about the account's ${p} software and OS environment from the sources. Include versions, lab or location names, and any upgrade or migration activity mentioned. If nothing is noted, write "No software/OS environment details noted this quarter."

**${p} Versions in Use:**
- [Version or tier] — [lab/location or team if known]

**Operating Systems:**
- [OS name and version] — [lab/location or team if known]

**Upgrade or Migration Activity:**
- [Any mentioned upgrades, planned migrations, or version-change discussions related to ${p}]

---

## Key Themes & Trends

3–5 bullets on recurring ${p}-related patterns or risks across sources this quarter.

---

## Information Changes

List any cases where a newer source contradicts, reverses, or materially updates something stated in an older source. If none exist, write "No contradictions or reversals noted this quarter."

- **[Topic]** — Previously (as of [older date]): [old info]. Updated (as of [newer date]): [new info].

---

## Recommended Next Steps

Priority actions for the CS team related to ${p} in the coming weeks.`;
}

// Max output tokens per model. Sonnet 4.6 supports 16k; Haiku 4.5 caps at 8k.
const MODEL_MAX_OUTPUT = {
  "claude-opus-4-8": 32_000,
  "claude-opus-4-7": 32_000,
  "claude-opus-4-6": 32_000,
  "claude-opus-4-5": 32_000,
  "claude-sonnet-4-6": 16_000,
  "claude-haiku-4-5": 8_192,
};

function maxOutputTokens(model) {
  return MODEL_MAX_OUTPUT[model] || 8_192;
}

// Context window per model (input + output tokens). Sonnet 4.6 and the Opus
// family support 1M tokens; Haiku 4.5 supports 200K. Unknown models fall back
// to the conservative 200K so we never over-fill the prompt.
const MODEL_CONTEXT = {
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-opus-4-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
};

function contextTokens(model) {
  return MODEL_CONTEXT[model] || 200_000;
}

// Char budget for note content: context minus max output minus ~12k template
// overhead, in tokens, times ~4 chars/token, with a 5% safety margin.
function budgetChars(model) {
  const usableTokens = Math.floor((contextTokens(model) - maxOutputTokens(model) - 12_000) * 0.95);
  return usableTokens * 4;
}

function fitNotes(notes, model) {
  // Per-note cap scales with the model's context — large-context models can
  // hold much bigger individual notes before a single one needs trimming.
  const perNoteCap = contextTokens(model) >= 1_000_000 ? 300_000 : 80_000;
  const maxChars = budgetChars(model);

  const capped = notes.map((n) => ({
    ...n,
    content: n.content.length > perNoteCap ? n.content.slice(0, perNoteCap) + "\n\n[truncated — note exceeds per-source limit]" : n.content,
  }));

  let total = 0;
  const kept = [];
  for (const n of capped) {
    const size = (n.title?.length || 0) + n.content.length + 200;
    if (total + size > maxChars && kept.length > 0) break;
    kept.push(n);
    total += size;
  }
  return { kept, dropped: notes.length - kept.length };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineContainsKeyword(line, keywords) {
  return keywords.some((kw) => {
    const esc = escapeRegex(kw.trim());
    const left = /^\w/.test(kw) ? "\\b" : "";
    const right = /\w$/.test(kw) ? "\\b" : "";
    return new RegExp(`${left}${esc}${right}`, "i").test(line);
  });
}

// Physically remove lines containing keywords that belong to other accounts
// so Claude never sees them — prompt instructions alone aren't reliable enough.
function scrubForbiddenKeywords(notes, accountName, allAccounts) {
  const forbidden = (allAccounts || [])
    .filter((a) => a.name !== accountName && a.name !== "Internal")
    .flatMap((a) => a.keywords || [])
    .filter(Boolean);
  if (!forbidden.length) return notes;
  return notes.map((n) => ({
    ...n,
    content: n.content
      .split("\n")
      .filter((line) => !lineContainsKeyword(line, forbidden))
      .join("\n"),
  }));
}

function combineUsage(a = {}, b = {}) {
  return {
    input_tokens: (a.input_tokens || 0) + (b.input_tokens || 0),
    output_tokens: (a.output_tokens || 0) + (b.output_tokens || 0),
  };
}

function noteDateKey(note) {
  return dateSortValue(note.date);
}

function noteRangeLabel(notes) {
  const dates = notes.map((n) => n.date).filter(Boolean).sort();
  if (!dates.length) return "undated older notes";
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first} to ${last}`;
}

function groupNotesForSummary(notes, model) {
  const batchBudget = contextTokens(model) >= 1_000_000 ? 260_000 : 90_000;
  const chronological = [...notes].sort((a, b) => noteDateKey(a).localeCompare(noteDateKey(b)));
  const batches = [];
  let current = [];
  let currentSize = 0;

  for (const note of chronological) {
    const size = (note.title?.length || 0) + (note.content?.length || 0) + 200;
    if (current.length && currentSize + size > batchBudget) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(note);
    currentSize += size;
  }

  if (current.length) batches.push(current);
  return batches;
}

function buildBatchSummaryPrompt(notes, productFocus, accountName) {
  const label = noteRangeLabel(notes);
  const scope = productFocus
    ? `${productFocus.name}${accountName ? ` for ${accountName}` : ""}`
    : `${accountName || "the selected account"} account status`;
  const noteBlocks = notes
    .map((n) => `### ${n.date || "undated"} — ${n.title}\n\n${n.content}`)
    .join("\n\n---\n\n");

  return `Compress these older source notes for a later ${scope} report.

Preserve facts, dates, owners, open/closed action items, product/version details, risks, decisions, and relationship context. Do not invent anything.

${BATCH_TEMPORAL_RULE}

Return Markdown with this structure only:

# Source Summary — ${label}

## Current Facts From This Batch
- [dated facts, newest/current interpretation where possible]

## Updates And Corrections Within This Batch
- [newer date] corrected/updated [older date]: [what changed]

## Open Items Still Relevant
- [unchecked or unresolved item] — **Owner:** [owner] | **From:** [date]

## Historical Context
- [older context that may still matter, clearly marked as historical]

---
SOURCES:

${noteBlocks}`;
}

async function summarizeOverflowNotes(client, model, notes, productFocus, accountName) {
  if (!notes.length) return { summaryNotes: [], usage: { input_tokens: 0, output_tokens: 0 } };

  const batches = groupNotesForSummary(notes, model);
  let usage = { input_tokens: 0, output_tokens: 0 };
  const summaryNotes = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const msg = await client.messages.create({
      model,
      max_tokens: Math.min(maxOutputTokens(model), 4096),
      system: "You compress dated meeting notes for a later synthesis step. Preserve dated changes and newest-current facts. Respond with only Markdown.",
      messages: [{ role: "user", content: buildBatchSummaryPrompt(batch, productFocus, accountName) }],
    });

    usage = combineUsage(usage, msg.usage);
    summaryNotes.push({
      filename: `summary-${i + 1}.md`,
      date: batch[batch.length - 1]?.date || batch[0]?.date || "0000-00-00",
      title: `Compressed older context (${noteRangeLabel(batch)})`,
      content: msg.content[0]?.text || "",
      source: "summary",
      sourceLabel: "Compressed older notes",
      _summaryCount: batch.length,
    });
  }

  return { summaryNotes, usage };
}

function tagSameDayNotes(notes) {
  const dateCounts = {};
  for (const n of notes) dateCounts[n.date] = (dateCounts[n.date] || 0) + 1;
  const dateIndex = {};
  return notes.map((n) => {
    if (dateCounts[n.date] > 1) {
      dateIndex[n.date] = (dateIndex[n.date] || 0) + 1;
      const pos = dateIndex[n.date];
      const total = dateCounts[n.date];
      const label = pos === 1 ? " *(earliest same-day meeting)*" : pos === total ? " *(latest same-day meeting)*" : ` *(same-day meeting ${pos} of ${total})*`;
      return { ...n, _dayLabel: label };
    }
    return { ...n, _dayLabel: "" };
  });
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { notes, apiKey, model, today, replacements = [], corrections = [], productFocus, accountName, allAccounts = [] } = body;

    if (!notes || notes.length === 0) {
      return new Response(JSON.stringify({ error: "No notes provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const sanitizedNotes = notes.map((n) => ({
      ...n,
      title: applyReplacements(applyCorrections(n.title || "", corrections), replacements),
      content: applyReplacements(applyCorrections(n.content, corrections), replacements),
    }));

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const selectedModel = model || "claude-sonnet-4-6";
    const client = new Anthropic({ apiKey: key });
    const scrubbedNotes = scrubForbiddenKeywords(sanitizedNotes, accountName, allAccounts);
    let { kept, dropped } = fitNotes(scrubbedNotes, selectedModel);
    let summarizedCount = 0;
    let mapReduceUsage = { input_tokens: 0, output_tokens: 0 };

    if (dropped > 0) {
      const overflowNotes = scrubbedNotes.slice(kept.length);
      const summarized = await summarizeOverflowNotes(client, selectedModel, overflowNotes, productFocus, accountName);
      summarizedCount = overflowNotes.length;
      mapReduceUsage = summarized.usage;
      ({ kept, dropped } = fitNotes([...kept, ...summarized.summaryNotes], selectedModel));
    }

    // Reverse to chronological order (oldest → newest) for the prompt.
    // fitNotes works newest-first to drop oldest when over budget; once
    // trimmed, chronological order helps Claude reason about what supersedes what.
    const chronological = [...kept].reverse();

    // Tag same-day notes with position labels so Claude knows which came first.
    const taggedNotes = tagSameDayNotes(chronological);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const messageStream = client.messages.stream({
            model: selectedModel,
            max_tokens: maxOutputTokens(selectedModel),
            system: "You are an expert at synthesizing dated meeting notes into clear, actionable executive summaries. Newer dated sources override older dated sources when they conflict, resolve, or update a fact. Respond with only the Markdown document — no preamble.",
            messages: [{
              role: "user",
              content: productFocus
                ? buildProductPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], productFocus, accountName, allAccounts)
                : buildSynthesisPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], accountName, allAccounts),
            }],
          });

          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              send({ type: "delta", text: event.delta.text });
            }
          }

          const final = await messageStream.finalMessage();
          send({
            type: "done",
            noteCount: kept.length,
            droppedCount: dropped,
            summarizedCount,
            usage: combineUsage(final.usage, mapReduceUsage),
            model: selectedModel,
          });
        } catch (error) {
          send({ type: "error", message: error?.message || "Synthesis failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Synthesis failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
