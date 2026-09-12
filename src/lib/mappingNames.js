// Which names belong in the Mapping tab's "Names & Context" list, and where
// each one was actually seen. Matching is whole-word: a saved term like
// "Hern" must not surface because "northern" contains it.

import { textHasAlias } from "./accounts";

function typeFromAlias(alias) {
  return String(alias || "").toUpperCase().startsWith("PERSON_") ? "person" : "org";
}

function noteText(note) {
  return `${note?.title || ""}\n${note?.content || ""}`;
}

// "folder" when the term appears (as a whole word) in a note from the
// selected folder; "elsewhere" when it only appears in cross-folder or
// transcript sources; "" when it appears nowhere.
export function termProvenance(notes, terms) {
  const list = (Array.isArray(terms) ? terms : [terms]).map((t) => String(t || "").trim()).filter(Boolean);
  if (!list.length) return "";
  let elsewhere = false;
  for (const note of notes || []) {
    const text = noteText(note);
    if (!list.some((term) => textHasAlias(text, term))) continue;
    if (!note.source || note.source === "obsidian") return "folder";
    elsewhere = true;
  }
  return elsewhere ? "elsewhere" : "";
}

// Saved glossary terms present in the loaded sources, with provenance.
export function savedReplacementsInSources(notes, replacements) {
  const items = [];
  for (const r of replacements || []) {
    const foundIn = termProvenance(notes, [r.original, r.restored]);
    if (!foundIn) continue;
    items.push({
      text: r.original,
      type: typeFromAlias(r.alias),
      alias: r.alias,
      restored: r.restored || r.original,
      context: "",
      enabled: true,
      saved: true,
      foundIn,
    });
  }
  return items;
}

// Tags AI-detected names with where they were seen so names that only
// occur in other folders' notes can be set aside.
export function withProvenance(items, notes) {
  return (items || []).map((item) => ({ ...item, foundIn: termProvenance(notes, [item.text, item.restored]) || "elsewhere" }));
}
