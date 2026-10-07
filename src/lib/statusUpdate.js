// The short, shareable account status update: a status paragraph, a risk
// line, and a next-step line that the CSM can send upward or across the team.
//
// The notes already hold the facts; what went wrong in drafts was the shape.
// They came back too long, repeated themselves, named individuals, quoted
// pricing, or hedged. So the rules here are mostly subtractive, and the
// checks run on the draft before the CSM ever sees it.
//
// Config spec: "Status Update Rules - App Config" in the vault.

// A trailing quarter, not the previous completed one: a status update is
// about what is happening now, so the current quarter has to be in it. The
// notes are still ordered newest first and the prompt leans on the recent
// ones, so a wider window adds context without burying this week.
export const STATUS_WINDOW_DAYS = 90;
export const STATUS_WINDOW_LABEL = "last quarter";

// The sections a status update is allowed to draw from. The transcript and
// the SFDC entry are deliberately out: this is about what is happening on the
// account, not a record of a meeting.
export const STATUS_SOURCE_SECTIONS = [
  "Executive Summary",
  "Meeting Notes",
  "Things NI SW Customer Success Should Take Note Of",
  "Action Items",
  "Next Steps",
];

const HEDGES = ["worth confirming", "tbd", "unconfirmed", "needs to be verified", "needs validation", "to be confirmed"];
const MONEY = /[$£€]\s?\d|\b\d[\d,.]*\s*(?:dollars|usd)\b|\bper\s+(?:node|user|seat|core)\b|\b\d[\d,.]*\s*(?:hours|credits|licenses|licences|seats|nodes)\b/i;

// Abbreviations, products, and org shorthand the spec explicitly allows, so
// the name check does not flag them as people.
const NOT_A_NAME = new Set([
  "sl", "sls", "sle", "ea", "ep", "bdm", "gam", "mfc", "rms", "ni", "csm", "fae", "am", "it", "snow",
  "systemlink", "labview", "teststand", "diadem", "flexlogger", "veristand", "pro", "server", "enterprise",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "early", "late", "end", "risk", "next", "step", "status", "update", "both",
  "unclassified", "classified", "two", "three", "four", "five", "at", "in", "the", "their", "and",
]);

const sentencesOf = (text) =>
  String(text || "")
    .split(/(?<=[.!?])\s+(?=[A-Z("'])/)
    .map((s) => s.trim())
    .filter(Boolean);

const normalizeWord = (word) => word.replace(/[^A-Za-z]/g, "").toLowerCase();

// Notes inside the reporting window, newest first. A status update is about
// what is happening now, so anything older is simply not source material.
export function recentStatusNotes(notes = [], { today = new Date(), windowDays = STATUS_WINDOW_DAYS } = {}) {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - windowDays);
  const inWindow = [];
  const older = [];

  for (const note of notes) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(note?.date || "")) ? new Date(`${note.date}T12:00:00`) : null;
    (date && date >= cutoff ? inWindow : older).push(note);
  }
  inWindow.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return { notes: inWindow, older: older.length };
}

// Only the sections a status update draws from.
export function statusNoteExcerpt(content, limit = 2500) {
  const text = String(content || "");
  const parts = STATUS_SOURCE_SECTIONS
    .map((heading) => {
      const match = text.match(new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*$\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "im"));
      const body = match?.[1]?.trim();
      return body ? `## ${heading}\n${body}` : "";
    })
    .filter(Boolean);
  return (parts.join("\n\n") || text.trim()).slice(0, limit);
}

export function buildStatusUpdatePrompt({
  account = "",
  productFocus = "",
  divisionsOrSites = "",
  today = "",
  priorUpdate = "",
  notes = [],
  includeRisk = true,
  includeNextStep = true,
} = {}) {
  const noteBlocks = notes
    .map((note) => `### ${note.date} — ${note.title}\n\n${statusNoteExcerpt(note.content)}`)
    .join("\n\n---\n\n");

  const parts = [`1. A status paragraph that starts with "${account}: ${today} - ". Three to five sentences, organized by division or site. Cover each active motion and its likely outcome.`];
  if (includeRisk) parts.push(`${parts.length + 1}. A line starting with "Risk: ". One sentence naming the single most important risk as cause and consequence.`);
  if (includeNextStep) parts.push(`${parts.length + 1}. A line starting with "Next step: ". One sentence with the nearest concrete action and its timeframe.`);

  return `You are drafting a short account status update for a Customer Success Manager for NI software. The update will be shared with her internal team, so it must be accurate, brief, and easy to scan.

Account: ${account}
Product focus: ${productFocus || "none specified"}
Divisions or sites: ${divisionsOrSites || "none specified"}
Today's date: ${today}
Prior approved update (refresh this if present): ${priorUpdate || "none"}

Source notes (newest first):
${noteBlocks || "none"}

Write exactly ${parts.length} part${parts.length !== 1 ? "s" : ""} and nothing else:

${parts.join("\n")}

Rules:
- Never use em dashes.
- Do not name individuals. Use roles such as "the BDM" or "the GAM".
- Do not include dollar amounts, pricing, credit hours, or license counts.
- Do not include internal caveats or hedges. State the likely outcome plainly.
- Say each point once. Do not repeat the same idea in the status paragraph and the risk line.
- Prefer the broader motion over product detail when the detail is not settled.
- Use full sentences, proper capitalization, and American spelling. Keep it professional and plain, with no business jargon.
- Write dates as "October 2027", "early November", "end of October". The header date uses YYYY-MM-DD.
- If a prior approved update is provided, keep its structure and wording wherever the notes have not changed, and update only what is new.
- Only use facts found in the source notes. If the notes conflict, use the most recent one.
- The notes span a quarter and are ordered newest first. Lead with where each motion stands now; older notes are background, and a motion that has since moved on is reported at its current state, not its earlier one.

After the parts above, add a line "---" and then "Other risks considered:" with up to five short bullets of risks you did not use. This section is for the CSM only and will not be shared.`;
}

export function parseStatusUpdate(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  const [body, ...rest] = raw.split(/\n\s*---\s*\n/);
  const tail = rest.join("\n");

  const lines = String(body || "").split("\n").map((line) => line.trim());
  const riskIndex = lines.findIndex((line) => /^risk:/i.test(line));
  const nextIndex = lines.findIndex((line) => /^next steps?:/i.test(line));

  const statusEnd = [riskIndex, nextIndex].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? lines.length;
  const status = lines.slice(0, statusEnd).filter(Boolean).join(" ").trim();

  const otherRisks = tail
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((line) => line && !/^other risks considered:?$/i.test(line));

  return {
    status,
    risk: riskIndex >= 0 ? lines[riskIndex].replace(/^risk:\s*/i, "").trim() : "",
    nextStep: nextIndex >= 0 ? lines[nextIndex].replace(/^next steps?:\s*/i, "").trim() : "",
    otherRisks,
  };
}

// The text that actually gets shared. "Other risks considered" never appears
// here — it exists so the CSM can swap one in, not to be sent.
export function shareableStatusText({ status = "", risk = "", nextStep = "" } = {}) {
  return [status, risk && `Risk: ${risk}`, nextStep && `Next step: ${nextStep}`]
    .filter(Boolean)
    .join("\n\n");
}

// Dashes the spec bans, replaced without leaving doubled punctuation behind.
function removeDashes(text) {
  return String(text || "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Capitalised pairs that read like a person's name. Deliberately narrow: it
// flags for a human to look at, it never edits.
function looksLikeNames(text) {
  const found = new Set();
  for (const match of String(text || "").matchAll(/\b([A-Z][a-z]{1,})\s+([A-Z][a-z]{1,})\b/g)) {
    if (NOT_A_NAME.has(normalizeWord(match[1])) || NOT_A_NAME.has(normalizeWord(match[2]))) continue;
    found.add(`${match[1]} ${match[2]}`);
  }
  return [...found];
}

// The spec's post-draft checks. D1 and D2 are repaired; everything else is
// reported, because fixing it would mean rewriting the CSM's meaning.
export function checkStatusUpdate(parsed, {
  account = "",
  today = "",
  knownNames = [],
  notesOutsideWindow = 0,
  accountTerms = [],
} = {}) {
  const flags = [];
  const flag = (id, message) => flags.push({ id, message });

  // D1 — dashes the spec bans.
  let status = removeDashes(parsed.status);
  const risk = removeDashes(parsed.risk);
  const nextStep = removeDashes(parsed.nextStep);

  // D2 — the header the update has to start with.
  const header = `${account}: ${today} - `;
  if (account && today && !status.startsWith(header)) {
    status = `${header}${status.replace(new RegExp(`^${account.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*:?\\s*\\d{4}-\\d{2}-\\d{2}?\\s*-?\\s*`, "i"), "").trim()}`;
  }

  const fixed = { ...parsed, status, risk, nextStep };
  const bodyAfterHeader = status.slice(header.length);

  // D3 — length of the status paragraph.
  const sentenceCount = sentencesOf(bodyAfterHeader).length;
  if (sentenceCount < 3 || sentenceCount > 5) {
    flag("D3", `The status paragraph is ${sentenceCount} sentence${sentenceCount !== 1 ? "s" : ""}; it should be three to five.`);
  }

  // D4 — one sentence each.
  for (const [id, label, value] of [["D4", "Risk", risk], ["D4", "Next step", nextStep]]) {
    if (!value) continue;
    const count = sentencesOf(value).length;
    if (count !== 1) flag(id, `${label} is ${count} sentences; it should be exactly one.`);
  }

  // D5 — individuals named instead of roles.
  const safe = new Set([...accountTerms, account].flatMap((term) => String(term || "").split(/\s+/)).map(normalizeWord).filter(Boolean));
  const shareable = shareableStatusText(fixed);
  const named = [
    ...knownNames.filter((name) => name && new RegExp(`\\b${String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(shareable)),
    ...looksLikeNames(shareable).filter((pair) => !pair.split(/\s+/).every((word) => safe.has(normalizeWord(word)))),
  ];
  if (named.length) flag("D5", `Names an individual instead of a role: ${[...new Set(named)].join(", ")}.`);

  // D6 — money, pricing, counts.
  if (MONEY.test(shareable)) flag("D6", "Mentions an amount, price, or count. The shareable text carries none of those.");

  // D7 — hedges.
  const hedged = HEDGES.filter((phrase) => shareable.toLowerCase().includes(phrase));
  if (hedged.length) flag("D7", `Hedges instead of stating the outcome: ${hedged.join(", ")}.`);

  // D8 — the same point made twice.
  const repeated = repeatedPhrase(bodyAfterHeader, [risk, nextStep].filter(Boolean).join(" "));
  if (repeated) flag("D8", `Repeats the same point across parts: "${repeated}".`);

  // D9 — everything has to come from the reporting window.
  if (notesOutsideWindow > 0) {
    flag("D9", `${notesOutsideWindow} note${notesOutsideWindow !== 1 ? "s were" : " was"} older than the ${STATUS_WINDOW_LABEL} and ${notesOutsideWindow !== 1 ? "were" : "was"} not used.`);
  }

  return { fixed, flags };
}

// The longest shared run of four or more words, which is what a repeated
// point actually looks like in practice.
function repeatedPhrase(a, b, minWords = 4) {
  const words = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const left = words(a);
  const right = new Set();
  const rightWords = words(b);
  for (let i = 0; i + minWords <= rightWords.length; i += 1) {
    right.add(rightWords.slice(i, i + minWords).join(" "));
  }
  for (let i = 0; i + minWords <= left.length; i += 1) {
    const phrase = left.slice(i, i + minWords).join(" ");
    if (right.has(phrase)) return phrase;
  }
  return "";
}
