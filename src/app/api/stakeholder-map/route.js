import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { dateSortValue } from "@/lib/synthesisPolicy";

const MODEL_MAX_OUTPUT = {
  "claude-opus-4-8": 32_000,
  "claude-opus-4-7": 32_000,
  "claude-opus-4-6": 32_000,
  "claude-opus-4-5": 32_000,
  "claude-sonnet-4-6": 16_000,
  "claude-haiku-4-5": 8_192,
};

const MODEL_CONTEXT = {
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-opus-4-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
};

function maxOutputTokens(model) {
  return MODEL_MAX_OUTPUT[model] || 8_192;
}

function contextTokens(model) {
  return MODEL_CONTEXT[model] || 200_000;
}

function budgetChars(model) {
  const usableTokens = Math.floor((contextTokens(model) - maxOutputTokens(model) - 10_000) * 0.95);
  return usableTokens * 4;
}

function sourceTag(note) {
  return note.source && note.source !== "obsidian" ? ` [${note.sourceLabel || note.source}]` : "";
}

function noteDateKey(note) {
  return dateSortValue(note.date);
}

function fitNotes(notes, model) {
  const perNoteCap = contextTokens(model) >= 1_000_000 ? 300_000 : 80_000;
  const maxChars = budgetChars(model);
  const capped = notes.map((n) => ({
    ...n,
    content: n.content.length > perNoteCap
      ? `${n.content.slice(0, perNoteCap)}\n\n[truncated - source exceeds per-source limit]`
      : n.content,
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

function tagSameDayNotes(notes) {
  const dateCounts = {};
  for (const n of notes) dateCounts[n.date] = (dateCounts[n.date] || 0) + 1;
  const dateIndex = {};
  return notes.map((n) => {
    if (dateCounts[n.date] > 1) {
      dateIndex[n.date] = (dateIndex[n.date] || 0) + 1;
      const pos = dateIndex[n.date];
      const total = dateCounts[n.date];
      const label = pos === 1 ? " *(earliest same-day source)*" : pos === total ? " *(latest same-day source)*" : ` *(same-day source ${pos} of ${total})*`;
      return { ...n, _dayLabel: label };
    }
    return { ...n, _dayLabel: "" };
  });
}

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
    .map((a) => `  - ${a.keywords.join(", ")} -> belong to ${a.name}, do not include in this map`);

  let out = `\nOther customer accounts - do not include them in this map:\n${accountLines.join("\n")}\n`;
  if (keywordLines.length) {
    out += `\nForbidden keywords tied to other accounts:\n${keywordLines.join("\n")}\n`;
  }
  return out;
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

export function buildStakeholderMapPrompt(notes, today, accountName, allAccounts) {
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const rangeLabel = `${threeMonthsAgo.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} - ${new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  const acct = accountName && accountName !== "Internal" ? accountName : "Selected Account";
  const noteBlocks = notes
    .map((n) => `### ${n.date || "undated"} - ${n.title}${sourceTag(n)}${n._dayLabel || ""}\n\n${n.content}`)
    .join("\n\n---\n\n");

  return `You are a NI Software Customer Success Manager creating a standalone customer stakeholder and site-level planning map for ${acct}.

Analyze the provided account notes and transcripts from ${rangeLabel}. Extract account-relevant people, customer teams, NI/internal contacts, sites, labs, campuses, cities, buildings, and named locations.

Scope rules:
- Map ${acct} only. If a source contains another customer account, ignore that other account completely.
- Customer stakeholders are highest priority. Include NI/internal contacts only when they own, influence, or are repeatedly tied to this account's engagement.
- Include sites/labs/locations even when no individual stakeholder is tied to them yet.
- Do not invent names, titles, sites, labs, influence levels, relationships, or next steps.
- If duplicate spellings, aliases, or abbreviations clearly refer to the same person/site, merge them under the clearest name and list the aliases.
${buildExclusionList(accountName, allAccounts)}

Sources are in chronological order, oldest first. Within a single day, same-day labels indicate order.

Citation rule: Every mapped person and every mapped site must list every provided source that mentions them. Use source date, title, and source label when present. Do not write "multiple meetings" without enumerating those meetings.

---
SOURCES:

${noteBlocks}

---

Generate the Customer & Site Mapping document using EXACTLY this structure:

# ${acct} Customer & Site Mapping - ${rangeLabel}

*Mapped from ${notes.length} source${notes.length !== 1 ? "s" : ""}*

---

## Source Coverage

- **Sources reviewed:** ${notes.length}
- **Date range:** ${rangeLabel}
- **Source types:** [summarize Obsidian notes, transcripts, and cross-folder notes represented in the sources]

---

## Customer Stakeholders

- **[Name]** - [role, title, team, or "not stated"]
  - **Aliases / spelling variants:** [aliases or "none noted"]
  - **Mentioned in:**
    - [YYYY-MM-DD - source title (source label)] - [brief account-relevant context from that source]
    - [repeat for every source mentioning this person]
  - **Relationship / influence:** [sponsor, champion, end user, admin, evaluator, blocker, unknown, etc.]
  - **Associated sites / teams:** [sites, labs, teams, or "not stated"]
  - **Planning implication:** [next engagement, follow-up, enablement need, risk, or "No planning action noted."]

---

## NI / Internal Contacts Mentioned

- **[Name]** - [role or "not stated"]
  - **Mentioned in:**
    - [YYYY-MM-DD - source title (source label)] - [brief context]
  - **Account planning role:** [what they own or influence, or "not stated"]

---

## Site / Lab / Location Map

- **[Site, lab, city, campus, or location name]** - [site context or "not stated"]
  - **Mentioned in:**
    - [YYYY-MM-DD - source title (source label)] - [brief site-relevant context from that source]
    - [repeat for every source mentioning this site/location]
  - **Stakeholders / teams tied to site:** [names or teams, or "not stated"]
  - **NI software footprint / adoption context:** [products, versions, deployment, training, support, or "not stated"]
  - **Risks / blockers:** [site-specific risks or "none noted"]
  - **Site-level planning implication:** [site visit, enablement, deployment, support, renewal, expansion, or "No planning action noted."]

---

## Stakeholder-Site Cross References

- **[Stakeholder] <-> [Site/Lab]** - [relationship and source date/title]

---

## Planning Gaps

- [missing title/contact/site owner/location detail, ambiguity, or source gap that should be clarified]

If no account-relevant stakeholders or sites are found, write exactly: "No stakeholder or site details noted this quarter."`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { notes, apiKey, model, today, replacements = [], corrections = [], accountName, allAccounts = [] } = body;

    if (!notes || notes.length === 0) {
      return new Response(JSON.stringify({ error: "No notes provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const sanitizedNotes = notes.map((n) => ({
      ...n,
      title: applyReplacements(applyCorrections(n.title || "", corrections), replacements),
      content: applyReplacements(applyCorrections(n.content, corrections), replacements),
    }));

    const selectedModel = model || "claude-sonnet-4-6";
    const scrubbedNotes = scrubForbiddenKeywords(sanitizedNotes, accountName, allAccounts);
    const newestFirst = [...scrubbedNotes].sort((a, b) => noteDateKey(b).localeCompare(noteDateKey(a)));
    const { kept, dropped } = fitNotes(newestFirst, selectedModel);
    const chronological = [...kept].reverse();
    const taggedNotes = tagSameDayNotes(chronological);

    const client = new Anthropic({ apiKey: key });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const messageStream = client.messages.stream({
            model: selectedModel,
            max_tokens: maxOutputTokens(selectedModel),
            system: "You produce precise customer stakeholder maps and site-level planning indexes from dated account notes. Preserve source attribution. Respond with only the Markdown document - no preamble.",
            messages: [{
              role: "user",
              content: buildStakeholderMapPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], accountName, allAccounts),
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
            usage: final.usage,
            model: selectedModel,
          });
        } catch (error) {
          send({ type: "error", message: error?.message || "Mapping failed" });
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
    return new Response(JSON.stringify({ error: error?.message || "Mapping failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
