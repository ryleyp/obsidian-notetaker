// Mechanical cleanup of "## Action Items" sections in existing notes:
// normalize lines to the canonical
//   - [ ] task — **Owner:** Name | **Due:** date
// shape, map first-person owners to the CSM's configured name, and drop
// exact duplicates within a note. Conservative by design — a line it can't
// confidently parse is left alone.

import { normalizeTaskContent } from "./todoist";

const SECTION_REGEX = /(## Action Items\n)([\s\S]*?)(?=\n## |\n---\n|$)/;

// Parses one bullet from an Action Items section. Returns null when the line
// isn't a bullet or doesn't look like a task we can safely normalize.
export function parseActionItemLine(line) {
  const bullet = line.match(/^(\s*)- (\[[ xX]\] )?(.*)$/);
  if (!bullet) return null;
  const [, indent, checkbox, rest] = bullet;
  if (!rest.trim()) return null;

  // Owner marker, bold or plain, after a dash/pipe or bare.
  const ownerMatch = rest.match(/\s*(?:[—–|-]\s*)?\*{0,2}Owner:\*{0,2}\s*(.+)$/i);
  let text = rest;
  let owner = "";
  let due = "";
  if (ownerMatch) {
    text = rest.slice(0, ownerMatch.index).trim().replace(/[—–|-]\s*$/, "").trim();
    let ownerRest = ownerMatch[1].trim();
    const dueMatch = ownerRest.match(/\s*(?:[—–|-]\s*)?\*{0,2}Due:\*{0,2}\s*(.+)$/i);
    if (dueMatch) {
      due = dueMatch[1].trim().replace(/^\*+|\*+$/g, "");
      ownerRest = ownerRest.slice(0, dueMatch.index).trim();
    }
    owner = ownerRest.replace(/^\*+|\*+$/g, "").replace(/[|,;]\s*$/, "").trim();
  }
  if (!text.trim()) return null;

  return {
    indent: indent || "",
    checked: /\[[xX]\]/.test(checkbox || ""),
    text: text.trim(),
    owner,
    due,
  };
}

export function formatActionItemLine({ indent = "", checked, text, owner, due }) {
  const box = checked ? "[x]" : "[ ]";
  if (!owner) return `${indent}- ${box} ${text}`;
  return `${indent}- ${box} ${text} — **Owner:** ${owner} | **Due:** ${due || "TBD"}`;
}

function canonicalOwner(owner, ownerNames = []) {
  const primary = (ownerNames[0] || "").trim();
  if (primary && /^(me|myself|i)$/i.test(owner.trim())) return primary;
  return owner.trim();
}

// Proposed edits for one note's Action Items section.
// Returns [{ from, to, reason }]; `to: ""` means delete the line.
export function cleanupActionItems(content, { ownerNames = [] } = {}) {
  const section = String(content || "").match(SECTION_REGEX);
  if (!section) return [];

  const edits = [];
  const seen = new Set();

  for (const line of section[2].split("\n")) {
    const parsed = parseActionItemLine(line);
    if (!parsed) continue;

    const item = { ...parsed, owner: canonicalOwner(parsed.owner, ownerNames) };
    const key = `${normalizeTaskContent(item.text)}||${item.owner.toLowerCase()}`;

    if (seen.has(key)) {
      edits.push({ from: `${line}\n`, to: "", reason: "duplicate item" });
      continue;
    }
    seen.add(key);

    const normalized = formatActionItemLine(item);
    if (normalized !== line) {
      const reason = item.owner !== parsed.owner ? "owner mapped to your name" : "normalized format";
      edits.push({ from: line, to: normalized, reason });
    }
  }

  return edits;
}

// Marks a specific open action item as done. Returns an edit or null.
export function completeActionItemEdit(content, itemLine) {
  if (!String(content || "").includes(itemLine)) return null;
  if (!/^\s*- \[ \] /.test(itemLine)) return null;
  return {
    from: itemLine,
    to: itemLine.replace("- [ ] ", "- [x] "),
    reason: "completed",
  };
}

// The open (unchecked) action-item lines of a note's Action Items section.
export function openActionItemLines(content) {
  const section = String(content || "").match(SECTION_REGEX);
  if (!section) return [];
  return section[2].split("\n").filter((line) => /^\s*- \[ \] /.test(line));
}
