// Harvests the SFDC Activity Entry a saved note already carries into an EA
// Activity row. The CSM reviewed that entry when the note was saved, so it
// is used as-is — no model call, no re-classification, no chance of
// misattribution. Notes without an entry are the only ones Claude sees.

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

// Row shape matches parseActivityRows. Returns null when the note has no
// usable entry (no section, or no Type).
export function harvestSfdcRow(note) {
  const section = sfdcSectionOf(note?.content);
  if (!section) return null;
  const rawType = field(section, "Type");
  if (!rawType) return null;

  const type = normalizeSfdcType(rawType);
  const subtype = normalizeSfdcSubtype(rawType, field(section, "Subtype"));
  const agreement = field(section, "EA/EP Number\\(s\\)").replace(/^none on file\.?$/i, "");
  const comments = summaryBlock(section);
  if (!comments) return null;

  return {
    eventDate: note.date || "",
    title: String(note.title || "").replace(/^Email - /i, "").trim(),
    type,
    subtype,
    comments,
    agreement,
    sourceTitle: note.title || "",
    origin: "note",
    review: false,
    reviewReason: "",
    verify: "",
    verifyReason: "",
  };
}

// Splits scanned notes into harvested rows and the notes Claude still needs
// to read.
export function harvestNotes(notes) {
  const rows = [];
  const remaining = [];
  for (const note of notes || []) {
    const row = harvestSfdcRow(note);
    if (row) rows.push(row);
    else remaining.push(note);
  }
  return { rows, remaining };
}
