// Deterministic postability checks for EA Activity rows.
//
// Three model passes can already review a row (classification, source
// verification, improvement), but none of them is a gate, and the things
// that most often make a row unpostable are mechanical: over the Salesforce
// limit, first person, the CSM's own name, a leftover citation marker, a
// placeholder, "CSM attended". Those are checked here with no model, on every
// row, every time — and the safe ones are fixed the same way.
//
// Severity: "hard" means Salesforce or the reporting convention rejects it
// as written; "soft" means it will read badly to whoever opens the record.

import { CONTRIBUTION_VERBS, isCanonicalPair } from "./sfdcTaxonomy";

export const COMMENT_CHAR_LIMIT = 800;
export const COMMENT_WORD_LIMIT = 120;
export const TITLE_CHAR_LIMIT = 200;

const JARGON = [
  "synergy", "synergies", "leverage", "leveraged", "leveraging", "circle back", "circled back",
  "bandwidth", "actionable", "value-add", "value add", "touch base", "touched base",
  "low-hanging fruit", "move the needle", "boil the ocean",
];

const CITATION = /\s*\[[TNEO]\d+\]/g;
const PLACEHOLDER = /\[(?:name|names|x|#|n|date|title|region|attendees|description|impact|outcome|product)\]|<[^>\n]{1,40}>|lorem ipsum/i;
const PASSIVE_CSM = /\bCSM(?:'s)?\s+(?:only\s+|just\s+|merely\s+)?(?:observed|listened|attended|was present|sat in|joined the (?:call|meeting|session)|was in attendance|took notes|monitored)\b/i;
const FIRST_PERSON_CAPS = /\b(?:I|I'm|I'll|I've|I'd)\b/;
const FIRST_PERSON = /\b(?:we|we're|we'll|we've|we'd|our|ours|my|me)\b/i;
const EMPTY_OUTCOME = /\s*Outcomes?:\s*None(?: stated| noted)?\.?/i;
const EMPTY_NEXT = /\s*Next steps?:\s*None\.?/i;
const LONE_SUMMARY = /^Summary:\s*/i;
const REDACTION = /█/;

// The four labelled parts a postable entry carries.
const HAS_SUMMARY = /\bSummary:/i;
const HAS_CONTRIBUTION = /\bContribution:/i;
const HAS_OUTCOMES = /\bOutcomes?:/i;
const NO_CONTRIBUTION_STATED = /\bContribution:\s*(?:none\b|n\/a\b)/i;
const CONTRIBUTION_VERB = new RegExp(`\\b(?:${CONTRIBUTION_VERBS.join("|")})\\b`, "i");

// Revenue causation is the claim reviewers push back on hardest, because the
// note almost never supports it.
const REVENUE_CLAIM = /\b(?:drove|generated|secured|delivered|produced|resulted in|led to|closed)\b[^.]{0,60}\b(?:revenue|renewal|renewals|expansion|upsell|deal|ARR|bookings|growth|pipeline)\b/i;

// Roles and titles that identify who was in the room.
// Split so acronyms stay case-sensitive: a case-insensitive "IT" or "AM"
// would match the words "it" and "am" in ordinary prose.
const ROLE_WORD = /\b(?:admin|administrator|lead|leads|manager|director|engineer|engineering|sponsor|architect|technician|scientist|analyst|owner|principal|supervisor)\b/i;
const ROLE_ACRONYM = /\b(?:VP|CTO|CIO|FAE|AM|GTS|IT|PM|QA|R&D)\b/;
const TITLE_GENERIC = /^(?:sync|meeting|call|check[- ]?in|touchpoint|discussion|update|follow[- ]?up|catch[- ]?up|chat|review|session)$/i;
const ATTENDANCE_TBD = /\b(?:attendees|participants):\s*TBD\b/i;
const GROUP_SUBTYPES = ["Demo Days", "User Group"];

export const wordCount = (text) => String(text || "").trim().split(/\s+/).filter(Boolean).length;

const sourceKey = (title) => String(title || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

// The source notes that more than one row cites, for lintActivityRow's
// duplicateSources option. Rows with no source are not duplicates of
// each other.
export function duplicateSourceNotes(rows = []) {
  const seen = new Map();
  for (const row of rows) {
    const key = sourceKey(row?.sourceTitle);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The CSM's own name in Salesforce text reads oddly to anyone else; the
// convention is "CSM".
export function csmNameToRole(text, ownerNames = []) {
  let out = String(text || "");
  for (const name of ownerNames || []) {
    const n = String(name || "").trim();
    if (!n) continue;
    out = out.replace(new RegExp(`\\b${escapeRegex(n)}(?:'s)?\\b`, "g"), (m) => (m.endsWith("'s") ? "CSM's" : "CSM"));
  }
  return out;
}

function mentionsOwner(text, ownerNames = []) {
  return (ownerNames || []).some((name) => {
    const n = String(name || "").trim();
    return n && new RegExp(`\\b${escapeRegex(n)}\\b`).test(text);
  });
}

// Filename → SFDC engagement title: drop the "Email - " marker, mail-client
// prefixes ("[EXTERNAL] RE- ", "FW:", "Declined- "), a leading date, and a
// "(1)" duplicate-file suffix.
export function cleanActivityTitle(title) {
  let out = String(title || "")
    .replace(/^\d{4}-\d{2}-\d{2}\s*-?\s*/, "")
    .replace(/^Email\s*-\s*/i, "");
  // Markers and reply prefixes interleave ("FW: [EXTERNAL] Re- ..."), so
  // peel them until nothing changes.
  for (;;) {
    const next = out
      .replace(/^\s*\[(external|ext)\]\s*/i, "")
      .replace(/^\s*(re|fw|fwd|aw|declined|accepted|tentative|canceled|cancelled)\s*[-:–]\s*/i, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s*\(\d+\)\s*$/, "").replace(/\s+/g, " ").trim();
}

// Strips the empty labelled fragments a note-time entry is told to write
// when it has nothing to say ("Outcomes: None stated"). They are honest in
// the note and noise in Salesforce.
function stripEmptyFragments(comment) {
  let out = String(comment || "");
  out = out.replace(EMPTY_OUTCOME, "").replace(EMPTY_NEXT, "");
  // If only the Summary label is left it labels nothing.
  if (!/\b(?:Contribution|Outcomes?|Next steps?):/i.test(out)) out = out.replace(LONE_SUMMARY, "");
  return out.replace(/\s+/g, " ").trim();
}

function collapse(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

// Every problem with a row, most serious first. Pure and cheap — safe to run
// on every render.
export function lintActivityRow(row, { ownerNames = [], agreementsOnFile = false, today = new Date(), duplicateSources = null } = {}) {
  const issues = [];
  const push = (code, severity, message, fixable = false) => issues.push({ code, severity, message, fixable });
  const title = String(row?.title || "");
  const comment = String(row?.comments || "");
  const body = collapse(comment);
  const type = String(row?.type || "");
  const subtype = String(row?.subtype || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row?.eventDate || ""))) push("date", "hard", "Event date must be YYYY-MM-DD.");
  if (!isCanonicalPair(type, subtype)) push("taxonomy", "hard", "Type and subtype must be an exact pair from the Salesforce taxonomy.");
  if (!collapse(comment)) push("empty-comment", "hard", "The comment is empty.");
  if (REDACTION.test(comment) || REDACTION.test(title)) push("redacted", "hard", "Mentions another account (redacted) — rewrite before filing.");

  const chars = comment.length;
  const words = wordCount(comment);
  if (chars > COMMENT_CHAR_LIMIT || words > COMMENT_WORD_LIMIT) {
    push("over-limit", "hard", `Comment is ${chars} characters / ${words} words; Salesforce takes ${COMMENT_CHAR_LIMIT} characters / ${COMMENT_WORD_LIMIT} words.`);
  }
  if (PLACEHOLDER.test(comment) || PLACEHOLDER.test(title)) push("placeholder", "hard", "Contains a placeholder that was never filled in.");
  if (mentionsOwner(comment, ownerNames)) push("csm-name", "hard", "Names the CSM — Salesforce entries say \"CSM\".", true);
  if (FIRST_PERSON_CAPS.test(comment) || FIRST_PERSON.test(comment)) push("first-person", "hard", "Written in first person; use past tense with \"CSM\" as the subject.");
  if (CITATION.test(comment)) push("citations", "soft", "Carries source markers like [T1] that mean nothing outside the app.", true);
  CITATION.lastIndex = 0;
  if (PASSIVE_CSM.test(comment)) push("passive-attendance", "soft", "Says the CSM observed or attended — describe the meeting and leave the CSM's participation unmentioned.");
  const jargon = JARGON.filter((term) => new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(comment));
  if (jargon.length) push("jargon", "soft", `Corporate filler: ${jargon.join(", ")}.`);
  if (EMPTY_OUTCOME.test(comment)) push("no-outcome", "soft", "No outcome stated — the record will read as a meeting that went nowhere.", true);
  else if (EMPTY_NEXT.test(comment)) push("empty-next-steps", "soft", "\"Next steps: None\" is noise in Salesforce.", true);
  if (type === "User Groups" && ["Demo Days", "User Group"].includes(subtype) && !(/\bRegion:/i.test(comment) && /\b(?:Attendees|Participants):/i.test(comment))) {
    push("group-format", "soft", "User group rows carry \"Region: X, Attendees: #\" (TBD is fine) and an Outcome.");
  }
  if (title.length > TITLE_CHAR_LIMIT) push("title-length", "hard", `Title is ${title.length} characters; the limit is ${TITLE_CHAR_LIMIT}.`);
  else if (cleanActivityTitle(title) !== collapse(title)) push("title-noise", "soft", "Title carries a date, mail prefix, or duplicate suffix.", true);
  if (agreementsOnFile && !String(row?.agreement || "").trim()) push("missing-agreement", "soft", "No EA/EP number, but this account has agreements on file.");

  // The reporting standard the account team reviews against: one record that
  // shows context, the CSM's own contribution, and a confirmed result.
  if (body) {
    // An entry with no labels at all is free prose. One whose "Outcomes:
    // None stated" was stripped as Salesforce noise is not missing structure,
    // so only a complete absence of labels counts here.
    if (!HAS_SUMMARY.test(body) && !HAS_CONTRIBUTION.test(body) && !HAS_OUTCOMES.test(body)) {
      push("structure", "soft", "Entries carry labelled Summary, Contribution, Outcomes, and Next steps parts.");
    } else if (!HAS_CONTRIBUTION.test(body)) {
      push("no-contribution", "soft", "No Contribution line — the record does not say what the CSM personally did.");
    } else if (!NO_CONTRIBUTION_STATED.test(body) && !CONTRIBUTION_VERB.test(body.split(/\bContribution:/i)[1] || "")) {
      push("weak-contribution", "soft", "The Contribution line does not open with a real verb (defined, coordinated, escalated, resolved...).");
    }
    if (REVENUE_CLAIM.test(body)) {
      push("revenue-claim", "soft", "Claims revenue causation — reviewers reject this unless the source says it outright.");
    }
    if (!ROLE_WORD.test(body) && !ROLE_ACRONYM.test(comment) && !/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(comment)) {
      push("no-participants", "soft", "Nobody is named or given a role — a reader cannot tell who was involved.");
    }
  }
  const titleWords = wordCount(title);
  if (title && (titleWords < 4 || TITLE_GENERIC.test(collapse(title)))) {
    push("weak-title", "soft", "Title names the engagement but not its purpose — add the initiative, team, site, or product.");
  }
  if (type === "Other" || subtype === "Other") {
    push("other-category", "soft", "Filed as \"Other\" — check whether a specific category fits before posting.");
  }

  // Status has to match reality: a record still sitting in "Planned" after
  // its date is the single most common thing a quarter-end review catches.
  const status = String(row?.status || "Completed");
  const eventDate = String(row?.eventDate || "");
  const inThePast = /^\d{4}-\d{2}-\d{2}$/.test(eventDate) && new Date(`${eventDate}T12:00:00`) < today;
  if (status === "Planned" && inThePast) {
    push("stale-planned", "hard", "Still marked Planned although its date has passed — update it with what happened, or cancel it.");
  }
  if (status === "Canceled" && !/\b(?:cancel|postpon|reschedul|declin|no[- ]show|did not|didn't)\w*\b/i.test(body)) {
    push("canceled-no-reason", "soft", "Canceled with no reason recorded.");
  }
  if (status === "Planned" && /\bOutcomes?:\s*(?!None\b)\S/i.test(body)) {
    push("planned-with-outcome", "hard", "A planned record cannot already have an outcome.");
  }
  // One meeting or email thread is one activity. A note split across two rows
  // inflates the count and splits one engagement's story in half.
  if (duplicateSources?.has(sourceKey(row?.sourceTitle))) {
    push("split-note", "hard", "Another row cites the same source note — one meeting or email thread is one activity. Merge them, keeping the primary purpose and folding the other themes into the summary.");
  }
  if (GROUP_SUBTYPES.includes(subtype) && inThePast && ATTENDANCE_TBD.test(body)) {
    push("attendance-tbd", "soft", "Event has happened but attendance is still TBD — fill in the final count.");
  }

  const rank = { hard: 0, soft: 1 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// Applies only the fixes that cannot change meaning: the CSM's name to
// "CSM", citation markers out, empty labelled fragments out, whitespace
// collapsed, title noise stripped. Anything that needs judgement — length,
// first person, missing outcomes — is left for the CSM or a review pass.
export function fixActivityRow(row, { ownerNames = [] } = {}) {
  const applied = [];
  let comments = String(row?.comments || "");
  let title = String(row?.title || "");

  const withoutCitations = comments.replace(CITATION, "");
  if (withoutCitations !== comments) { comments = withoutCitations; applied.push("citations"); }

  const withRole = csmNameToRole(comments, ownerNames);
  if (withRole !== comments) { comments = withRole; applied.push("csm-name"); }

  const withoutEmpty = stripEmptyFragments(comments);
  if (withoutEmpty !== collapse(comments)) applied.push(EMPTY_OUTCOME.test(comments) ? "no-outcome" : "empty-next-steps");
  comments = withoutEmpty;

  const cleanTitle = cleanActivityTitle(title);
  if (cleanTitle !== collapse(title) && cleanTitle) { title = cleanTitle; applied.push("title-noise"); }
  else title = collapse(title);

  const next = { ...row, comments, title };
  return { row: next, applied, changed: applied.length > 0 || comments !== row?.comments || title !== row?.title };
}

export function lintSummary(rows = [], options = {}) {
  let hard = 0;
  let soft = 0;
  let fixable = 0;
  let rowsWithIssues = 0;
  for (const row of rows) {
    const issues = row?.lint || lintActivityRow(row, options);
    if (!issues.length) continue;
    rowsWithIssues += 1;
    for (const issue of issues) {
      if (issue.severity === "hard") hard += 1; else soft += 1;
      // A row already filed in Salesforce is left alone by the bulk fix —
      // editing it here would misrepresent what was actually filed — so its
      // issues are reported but never counted as fixable.
      if (issue.fixable && !row?.filed) fixable += 1;
    }
  }
  return { hard, soft, fixable, rowsWithIssues };
}

// One line per issue, for a prompt or a tooltip.
export function describeIssues(issues = []) {
  return issues.map((issue) => `${issue.severity === "hard" ? "MUST FIX" : "should fix"}: ${issue.message}`).join(" ");
}

// Every rule the linter can raise, in one place, so the skill's reference
// document and the app describe exactly the same checks. A test asserts that
// every code pushed above appears here, so the two cannot drift.
export const LINT_RULES = [
  { code: "date", severity: "hard", catches: "An event date that is not YYYY-MM-DD.", fix: "Use the date of the meeting or thread, from the note title." },
  { code: "taxonomy", severity: "hard", catches: "A Type/Subtype pair that is not an exact match in the taxonomy.", fix: "Copy both values character-for-character from the taxonomy." },
  { code: "empty-comment", severity: "hard", catches: "No comment at all.", fix: "Write the four labelled parts." },
  { code: "redacted", severity: "hard", catches: "A redaction mark, meaning another account's name was scrubbed out of this text.", fix: "Rewrite the sentence without the other account, or drop the row." },
  { code: "over-limit", severity: "hard", catches: "A comment over 800 characters or 120 words — Salesforce will not accept it.", fix: "Cut detail from Summary first; never cut Contribution or Outcomes." },
  { code: "placeholder", severity: "hard", catches: "A template placeholder that was never filled in, such as [Name] or <region>.", fix: "Fill it in from the sources, or remove the clause. \"TBD\" is honest for an unknown attendee count." },
  { code: "csm-name", severity: "hard", catches: "The CSM's own name in text other people read.", fix: "Say \"CSM\". Applied automatically.", fixable: true },
  { code: "first-person", severity: "hard", catches: "\"I\", \"we\", \"our\", \"my\" — activity records are written in the third person.", fix: "Rewrite in past tense with \"CSM\" as the subject." },
  { code: "title-length", severity: "hard", catches: "A title over 200 characters.", fix: "Shorten to the engagement and its purpose." },
  { code: "citations", severity: "soft", catches: "Source markers like [T1] or [N2], which mean nothing outside the note app.", fix: "Strip them. Applied automatically.", fixable: true },
  { code: "passive-attendance", severity: "soft", catches: "\"CSM attended / observed / listened / was present\".", fix: "Describe the meeting and say who led it; leave the CSM's presence unmentioned unless they contributed." },
  { code: "jargon", severity: "soft", catches: "Corporate filler: synergy, leverage, circle back, bandwidth, actionable, value-add, touch base.", fix: "Say the plain thing instead." },
  { code: "no-outcome", severity: "soft", catches: "\"Outcomes: None stated\" — honest in the note, noise in Salesforce.", fix: "Drop the fragment, or state what was actually confirmed. Removal applied automatically.", fixable: true },
  { code: "empty-next-steps", severity: "soft", catches: "\"Next steps: None\".", fix: "Drop the fragment, or name the next action. Removal applied automatically.", fixable: true },
  { code: "group-format", severity: "soft", catches: "A Demo Days or User Group row without \"Region: X, Attendees: #\" and an outcome.", fix: "Add region and attendance (TBD is fine) and state the impact." },
  { code: "title-noise", severity: "soft", catches: "A title carrying a leading date, a mail prefix (RE:/FW:/[EXTERNAL]), or a \"(1)\" duplicate suffix.", fix: "Strip them. Applied automatically.", fixable: true },
  { code: "missing-agreement", severity: "soft", catches: "No EA/EP number on a row while the account has agreements on file.", fix: "Add the number the engagement relates to, or leave blank deliberately." },
  { code: "structure", severity: "soft", catches: "Free prose with none of the four labels.", fix: "Rewrite as Summary / Contribution / Outcomes / Next steps." },
  { code: "no-contribution", severity: "soft", catches: "No Contribution line — the record does not say what the CSM personally did.", fix: "Add it, opening with a real verb, or \"None beyond attendance\" when that is the truth." },
  { code: "weak-contribution", severity: "soft", catches: "A Contribution line that does not open with a real verb.", fix: "Open with defined, coordinated, advised, resolved, escalated, mapped, validated, introduced, documented, or secured." },
  { code: "revenue-claim", severity: "soft", catches: "Revenue causation — drove renewal, generated expansion, closed the deal.", fix: "State what actually happened; claim revenue impact only when a source says it outright." },
  { code: "no-participants", severity: "soft", catches: "Nobody named and no role given.", fix: "Name the customer contact with their title when the sources give it." },
  { code: "weak-title", severity: "soft", catches: "A title naming the engagement but not its purpose, or under four words.", fix: "Add the initiative, team, site, or product." },
  { code: "other-category", severity: "soft", catches: "Type or Subtype filed as \"Other\".", fix: "Check whether a specific category fits. Repeated \"Other\" is a taxonomy gap worth raising." },
  { code: "stale-planned", severity: "hard", catches: "A record still marked Planned after its date has passed.", fix: "Update it with what actually happened and mark it Completed, or cancel it with a reason." },
  { code: "planned-with-outcome", severity: "hard", catches: "An outcome on a record for something that has not happened yet.", fix: "Remove the outcome until the engagement occurs, or correct the status." },
  { code: "canceled-no-reason", severity: "soft", catches: "A canceled record with no reason recorded.", fix: "Say briefly why it did not happen — postponed, declined, rescheduled." },
  { code: "attendance-tbd", severity: "soft", catches: "A past user group or demo still showing \"Attendees: TBD\".", fix: "Fill in the final count now that the event has happened." },
  { code: "split-note", severity: "hard", catches: "Two rows citing the same source note — one meeting or email thread split into several activities.", fix: "Merge them into one record: classify by the primary purpose and carry the other themes in the summary." },
];
