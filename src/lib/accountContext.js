import { markdownSections } from "./customerFacts";

// What a reply needs to know about the account beyond the thread it answers:
// the recent history. Only the sections that record where things stand are
// kept, so a handful of notes fits in a prompt without their full text.
const CONTEXT_SECTIONS = [
  ["Summary", ["executive summary", "thread summary", "notes"]],
  ["Decisions", ["decisions"]],
  ["Open questions", ["open questions"]],
  ["Action items", ["action items", "to-dos"]],
  ["Next steps", ["next steps"]],
];

const EMPTY_BODY = /^(nothing noted|none noted|no explicit decisions in this thread|no to-dos in this thread|covered by action items above)[.!]?$/i;

function dateFromFilename(filename) {
  return String(filename || "").match(/\d{4}-\d{2}-\d{2}/)?.[0] || "";
}

function tidy(body) {
  return String(body || "")
    // Citation markers point at sources the reply never sees.
    .replace(/\s*\[[TNEOS]\d+\]/g, "")
    .replace(/^\*\*Response needed:\*\*.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text, limit) {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const lastBreak = cut.lastIndexOf("\n");
  return `${(lastBreak > limit * 0.6 ? cut.slice(0, lastBreak) : cut).trimEnd()}\n…`;
}

// Builds a compact digest of an account's most recent notes, newest first.
// `notes` is [{ filename, content }]; `exclude` drops the note for the thread
// being answered, which the reply already receives in full.
export function buildAccountContext(notes = [], { exclude = () => false, maxNotes = 6, perNoteChars = 1600, maxChars = 9000 } = {}) {
  const dated = notes
    .filter((note) => dateFromFilename(note.filename) && !exclude(note))
    .sort((a, b) => dateFromFilename(b.filename).localeCompare(dateFromFilename(a.filename))
      || String(b.filename).localeCompare(String(a.filename)));

  const blocks = [];
  const sources = [];
  let used = 0;
  for (const note of dated) {
    if (blocks.length >= maxNotes) break;
    const sections = markdownSections(note.content);
    const parts = [];
    for (const [label, headings] of CONTEXT_SECTIONS) {
      const body = tidy(headings.map((heading) => sections.get(heading)).find(Boolean));
      if (body && !EMPTY_BODY.test(body)) parts.push(`${label}:\n${body}`);
    }
    if (!parts.length) continue;
    const title = String(note.filename).replace(/\.md$/i, "");
    const block = `### ${title}\n${clip(parts.join("\n\n"), perNoteChars)}`;
    if (used + block.length > maxChars) break;
    blocks.push(block);
    sources.push(note.filename);
    used += block.length;
  }

  return { context: blocks.join("\n\n"), sources };
}
