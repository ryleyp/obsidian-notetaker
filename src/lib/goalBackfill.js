// Backfilling goal contributions into notes written before goals existed.
//
// Notes generated after goals are configured carry their own "## Goal
// Contributions" section, reviewed by the CSM at save time. Older notes have
// nothing. This reads those older notes and proposes what each one
// contributed, for the CSM to tick before anything is written.
//
// Two rules keep the backfill from damaging reviewed work:
//   - a note that already carries the section is never a candidate, so a
//     re-run cannot overwrite what the CSM already approved;
//   - proposals are dropped unless they name a configured goal, so the model
//     cannot introduce a goal by writing one into a note.

import { GOAL_SECTION_HEADING, NO_CONTRIBUTIONS, formatContributionLine, matchGoal } from "./goals";

// Sections that can actually show a goal contribution. The transcript and raw
// notes are deliberately left out: what matters is the reviewed write-up.
const EVIDENCE_SECTIONS = [
  ["Executive Summary", 700],
  ["Meeting Notes", 1600],
  ["Action Items", 500],
  ["Next Steps", 400],
  ["SFDC Activity Entry", 700],
];

export function hasGoalSection(content) {
  return new RegExp(`^##\\s+${GOAL_SECTION_HEADING}\\s*$`, "im").test(String(content || ""));
}

// The part of a note the model is allowed to judge from. Falls back to the
// head of the note when it carries none of the usual headings.
export function goalEvidenceExcerpt(content) {
  const text = String(content || "");
  const parts = [];
  for (const [heading, limit] of EVIDENCE_SECTIONS) {
    const match = text.match(new RegExp(`^##\\s+${heading}\\s*$\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "im"));
    const body = match?.[1]?.trim();
    if (body) parts.push(`## ${heading}\n${body.slice(0, limit)}`);
  }
  if (parts.length) return parts.join("\n\n");
  return text.trim().slice(0, 2000);
}

export function buildGoalSection(contributions = []) {
  const lines = contributions
    .filter((item) => String(item?.goal || "").trim() && String(item?.contribution || "").trim())
    .map(formatContributionLine);
  return `## ${GOAL_SECTION_HEADING}\n\n${lines.length ? lines.join("\n") : NO_CONTRIBUTIONS}\n`;
}

// Writes the section where generated notes carry it — directly above the SFDC
// Activity Entry — matching whatever separator that heading already uses.
// Returns null when the note already has a section, so callers skip rather
// than duplicate.
export function insertGoalSection(content, contributions = []) {
  const text = String(content || "");
  if (!text.trim() || hasGoalSection(text)) return null;
  const section = buildGoalSection(contributions).trimEnd();

  const lines = text.split("\n");
  const sfdcIndex = lines.findIndex((line) => /^##\s+SFDC Activity Entry\s*$/i.test(line));
  if (sfdcIndex === -1) return `${text.trimEnd()}\n\n---\n\n${section}\n`;

  // Walk back over the blank lines and the horizontal rule that introduce the
  // SFDC heading: they belong to it, so the new section goes above them.
  let cut = sfdcIndex;
  while (cut > 0 && !lines[cut - 1].trim()) cut -= 1;
  let rule = false;
  if (cut > 0 && /^-{3,}$/.test(lines[cut - 1].trim())) {
    rule = true;
    cut -= 1;
    while (cut > 0 && !lines[cut - 1].trim()) cut -= 1;
  }

  const head = lines.slice(0, cut).join("\n").trimEnd();
  const tail = lines.slice(sfdcIndex).join("\n");
  const divider = rule ? "---\n\n" : "";
  return `${head}\n\n${divider}${section}\n\n${divider}${tail}`;
}

// Reads the model's answer for one batch. Anything that does not name a
// configured goal, or points at a note that was not in the batch, is dropped
// and counted rather than guessed at.
export function parseBackfillVerdicts(text, notes = [], goals = []) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "").trim().replace(/^```(json)?\n?|\n?```$/g, ""));
  } catch {
    return { byNote: new Map(), dropped: 0, parseFailed: true };
  }
  if (!Array.isArray(parsed)) return { byNote: new Map(), dropped: 0, parseFailed: true };

  const byNote = new Map();
  let dropped = 0;
  for (const entry of parsed) {
    const note = notes[entry?.id];
    const contribution = String(entry?.contribution || "").replace(/\s+/g, " ").trim();
    const matched = matchGoal(entry?.goal, goals);
    if (!note || !contribution || !matched) {
      if (entry) dropped += 1;
      continue;
    }
    if (!byNote.has(note.relativePath)) byNote.set(note.relativePath, []);
    byNote.get(note.relativePath).push({
      goal: matched.name,
      contribution: contribution.slice(0, 300),
      metric: String(entry?.metric || "").replace(/\s+/g, " ").trim().slice(0, 80),
    });
  }
  return { byNote, dropped, parseFailed: false };
}

export function chunk(items = [], size = 6) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
