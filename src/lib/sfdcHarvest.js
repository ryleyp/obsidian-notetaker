// Harvests the SFDC Activity Entry a saved note already carries into an EA
// Activity row. The CSM reviewed that entry when the note was saved, so its
// classification and substance are used as-is — no model call, no
// re-classification, no chance of misattribution. What this module does
// change is presentation and hygiene: filename-style titles become SFDC
// titles, the CSM's name becomes "CSM", agreement numbers are normalized,
// duplicate notes collapse to one row, internal check-ins stay out, and
// rows carrying redaction marks are flagged for review.

import { normalizeSfdcSubtype, normalizeSfdcType } from "./sfdcTaxonomy";

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

// The CSM's own name in Salesforce text reads oddly; the convention is "CSM".
export function csmNameToRole(text, ownerNames = []) {
  let out = String(text || "");
  for (const name of ownerNames || []) {
    const n = String(name || "").trim();
    if (!n) continue;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${esc}(?:'s)?\\b`, "g"), (m) => (m.endsWith("'s") ? "CSM's" : "CSM"));
  }
  return out;
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
export function harvestSfdcRow(note, { ownerNames = [] } = {}) {
  const section = sfdcSectionOf(note?.content);
  if (!section) return null;
  const rawType = field(section, "Type");
  if (!rawType) return null;

  const type = normalizeSfdcType(rawType);
  const subtype = normalizeSfdcSubtype(rawType, field(section, "Subtype"));
  const agreement = normalizeAgreements(field(section, "EA/EP Number\\(s\\)"));
  const comments = csmNameToRole(summaryBlock(section), ownerNames);
  if (!comments) return null;

  const redacted = /█/.test(comments) || /█/.test(note.title || "");

  return {
    eventDate: note.date || "",
    title: cleanActivityTitle(note.title),
    type,
    subtype,
    comments,
    agreement,
    sourceTitle: note.title || "",
    origin: "note",
    review: redacted,
    reviewReason: redacted ? "Mentions another account (redacted) — edit the comment before filing" : "",
    verify: "",
    verifyReason: "",
  };
}

// Splits scanned notes into harvested rows, the notes Claude still needs to
// read, and notes skipped as internal check-ins. Duplicate notes (same
// cleaned title — e.g. "Thread" and "Thread (1)") collapse to the newest.
export function harvestNotes(notes, { ownerNames = [], skipInternalCheckIns = true } = {}) {
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
    const row = harvestSfdcRow(note, { ownerNames });
    if (!row) {
      remaining.push(note);
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
