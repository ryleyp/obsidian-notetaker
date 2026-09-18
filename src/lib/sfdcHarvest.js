// Harvests the SFDC Activity Entry a saved note already carries into an EA
// Activity row. The CSM reviewed that entry when the note was saved, so its
// classification and substance are used as-is — no model call, no
// re-classification, no chance of misattribution. What this module does
// change is presentation and hygiene: filename-style titles become SFDC
// titles, the CSM's name becomes "CSM", agreement numbers are normalized,
// duplicate notes collapse to one row, internal check-ins stay out, and
// rows carrying redaction marks are flagged for review.

import { normalizeSfdcSubtype, normalizeSfdcType } from "./sfdcTaxonomy";
import { cleanActivityTitle, csmNameToRole, fixActivityRow, lintActivityRow } from "./activityLint";

export { cleanActivityTitle, csmNameToRole };

function field(section, label) {
  const m = section.match(new RegExp(`\\*\\*${label}:\\*\\*\\s*([^\\n]*)`, "i"));
  return m ? m[1].trim() : "";
}

function summaryBlock(section) {
  const m = section.match(/\*\*Summary\/Notes:\*\*\s*\n([\s\S]*?)(?=\n\s*\n\s*(?:---|\*\*|##)|$)/);
  if (!m) return "";
  return m[1]
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function sfdcSectionOf(content) {
  const m = String(content || "").match(/## SFDC Activity Entry\s*\n([\s\S]*?)(?=\n## |$)/);
  return m ? m[1].replace(/\n---\s*$/, "").trim() : "";
}

// "EA-15552" / "ea 15552" / "EA #15552" → "EA 15552"; "None on file" → "".
export function normalizeAgreements(value) {
  const text = String(value || "").trim();
  if (!text || /^none( on file)?\.?$/i.test(text)) return "";
  return text
    .split(/[,;]|\band\b/i)
    .map((part) => part.trim().replace(/^(EA|EP)\s*[-#:]?\s*(\d+)$/i, (_, t, n) => `${t.toUpperCase()} ${n}`))
    .filter(Boolean)
    .join(", ");
}

// Manager 1:1s, team meetings, career conversations: internal to the CSM,
// never an EA engagement with the customer, even when the account comes up.
const INTERNAL_CHECK_IN = /\b(1x1|1:1|1 on 1|one[- ]on[- ]one|team meeting|staff meeting|scorecard|career|new role|rotation|interview|lunch with|tour)\b/i;

export function isInternalCheckIn(note) {
  return INTERNAL_CHECK_IN.test(String(note?.title || ""));
}

export function dedupeKey(row) {
  return cleanActivityTitle(row?.title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Row shape matches parseActivityRows. Returns null when the note has no
// usable entry (no section, or no Type).
// "Reportable: No — internal 1:1" → { reportable: false, reason }. Notes
// written before the field existed have no line and count as reportable.
export function reportableField(section) {
  const raw = field(section, "Reportable");
  if (!raw) return { reportable: true, reason: "" };
  const m = raw.match(/^(yes|no)\b\s*[—–:-]?\s*(.*)$/i);
  if (!m) return { reportable: true, reason: "" };
  return { reportable: m[1].toLowerCase() === "yes", reason: m[2].trim() };
}

export function harvestSfdcRow(note, { ownerNames = [], agreementsOnFile = false } = {}) {
  const section = sfdcSectionOf(note?.content);
  if (!section) return null;
  const rawType = field(section, "Type");
  if (!rawType) return null;

  const type = normalizeSfdcType(rawType);
  const subtype = normalizeSfdcSubtype(rawType, field(section, "Subtype"));
  const agreement = normalizeAgreements(field(section, "EA/EP Number\\(s\\)"));
  const rawComments = summaryBlock(section);
  if (!rawComments.trim()) return null;

  // Title is the engagement as the note names it. Older entries wrote that
  // as "Activity Title"; current ones carry only a Recommended Title — the
  // Salesforce-ready one — so the note's own title fills Title instead.
  const activityTitle = field(section, "Activity Title");
  const recommendedTitle = field(section, "Recommended Title");
  const { reportable, reason: reportableReason } = reportableField(section);

  // Safe hygiene only: the CSM's name to "CSM", markers out, empty labelled
  // fragments out. Anything needing judgement is reported, not changed.
  const { row: fixed } = fixActivityRow({
    title: activityTitle || cleanActivityTitle(note.title),
    comments: rawComments,
  }, { ownerNames });

  const row = {
    eventDate: note.date || "",
    title: fixed.title,
    improvedTitle: cleanActivityTitle(recommendedTitle).slice(0, 200),
    type,
    subtype,
    comments: fixed.comments,
    agreement,
    sourceTitle: note.title || "",
    origin: "note",
    reportable,
    reportableReason,
    verify: "",
    verifyReason: "",
  };
  const lint = lintActivityRow(row, { ownerNames, agreementsOnFile });
  const hard = lint.filter((issue) => issue.severity === "hard");
  return {
    ...row,
    lint,
    review: hard.length > 0,
    reviewReason: hard.map((issue) => issue.message).join(" "),
  };
}

// Splits scanned notes into harvested rows, the notes Claude still needs to
// read, and notes skipped as internal check-ins. Duplicate notes (same
// cleaned title — e.g. "Thread" and "Thread (1)") collapse to the newest.
export function harvestNotes(notes, { ownerNames = [], skipInternalCheckIns = true, agreementsOnFile = false } = {}) {
  const rows = [];
  const remaining = [];
  const skipped = [];
  const seen = new Map(); // dedupeKey -> index in rows

  const ordered = [...(notes || [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  for (const note of ordered) {
    if (skipInternalCheckIns && isInternalCheckIn(note)) {
      skipped.push({ title: note.title || "", reason: "internal check-in" });
      continue;
    }
    const row = harvestSfdcRow(note, { ownerNames, agreementsOnFile });
    if (!row) {
      remaining.push(note);
      continue;
    }
    // The note itself decided at save time that this was not an EA
    // engagement worth logging. The same toggle that admits internal
    // check-ins admits these, so nothing is hidden for good.
    if (skipInternalCheckIns && !row.reportable) {
      skipped.push({ title: note.title || "", reason: row.reportableReason ? `not reportable — ${row.reportableReason}` : "not reportable" });
      continue;
    }
    const key = dedupeKey(row);
    if (key && seen.has(key)) {
      skipped.push({ title: note.title || "", reason: `duplicate of "${rows[seen.get(key)].title}"` });
      continue;
    }
    if (key) seen.set(key, rows.length);
    rows.push(row);
  }
  return { rows, remaining, skipped };
}

// The postability check for the entry inside a note, before it is saved.
// Returns null when the note has no entry to check.
export function lintNoteEntry(content, { ownerNames = [], agreementsOnFile = false } = {}) {
  const section = sfdcSectionOf(content);
  if (!section) return null;
  const rawType = field(section, "Type");
  const row = {
    eventDate: String(content || "").match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "",
    title: field(section, "Recommended Title") || field(section, "Activity Title") || "Activity",
    type: normalizeSfdcType(rawType),
    subtype: normalizeSfdcSubtype(rawType, field(section, "Subtype")),
    comments: summaryBlock(section),
    agreement: normalizeAgreements(field(section, "EA/EP Number\\(s\\)")),
  };
  // A note's date is not the entry's problem; only the entry is judged here.
  const issues = lintActivityRow(row, { ownerNames, agreementsOnFile }).filter((issue) => issue.code !== "date");
  const fixable = issues.filter((issue) => issue.fixable);
  return { issues, fixable: fixable.length, row };
}

// Rewrites the Summary/Notes block of the note's entry with the safe fixes
// applied, leaving every other byte of the note alone.
export function fixNoteEntry(content, { ownerNames = [] } = {}) {
  const text = String(content || "");
  const sectionMatch = text.match(/(## SFDC Activity Entry\s*\n)([\s\S]*?)(?=\n## |$)/);
  if (!sectionMatch) return { content: text, applied: [] };
  const section = sectionMatch[2];
  const blockMatch = section.match(/(\*\*Summary\/Notes:\*\*\s*\n)([\s\S]*?)(?=\n\s*\n\s*(?:---|\*\*|##)|$)/);
  if (!blockMatch) return { content: text, applied: [] };

  const original = blockMatch[2];
  const lines = original.split("\n").map((line) => line.trim()).filter(Boolean);
  const { row, applied } = fixActivityRow({ title: "", comments: lines.join(" ") }, { ownerNames });
  if (!applied.length) return { content: text, applied: [] };

  // Keep the labelled lines on their own lines when they survived the fix.
  const rebuilt = row.comments
    .replace(/\s+(Contribution:|Outcomes?:|Next steps?:)/g, "\n$1")
    .trim();
  const nextSection = section.replace(blockMatch[0], `${blockMatch[1]}${rebuilt}`);
  return { content: text.replace(sectionMatch[0], `${sectionMatch[1]}${nextSection}`), applied };
}
