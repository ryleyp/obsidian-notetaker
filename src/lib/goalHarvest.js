// Rolls the goal contributions recorded in saved notes up into one view per
// goal. Deterministic: every entry here was written into a note the CSM
// already reviewed, so nothing is re-inferred and no model runs.

import { matchGoal, parseGoalContributions } from "./goals";

const UNMATCHED = "__unmatched__";

// Groups every contribution found in `notes` under its configured goal.
// Contributions naming a goal that is not configured (renamed, or from an
// older review cycle) are kept separately rather than dropped, so nothing the
// CSM recorded disappears silently.
export function harvestGoalContributions(notes = [], goals = []) {
  const byGoal = new Map(goals.map((goal) => [goal.name, { goal, contributions: [] }]));
  const unmatched = new Map();
  let notesWithContributions = 0;

  const ordered = [...notes].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  for (const note of ordered) {
    const found = parseGoalContributions(note.content);
    if (!found.length) continue;
    notesWithContributions += 1;

    for (const entry of found) {
      const record = {
        ...entry,
        date: note.date || "",
        noteTitle: note.title || note.filename || "Untitled note",
        folder: note.folder ?? "",
      };
      const matched = matchGoal(entry.goal, goals);
      if (matched) {
        byGoal.get(matched.name).contributions.push(record);
        continue;
      }
      if (!unmatched.has(entry.goal)) unmatched.set(entry.goal, { goal: { name: entry.goal, target: "" }, contributions: [] });
      unmatched.get(entry.goal).contributions.push(record);
    }
  }

  const groups = [...byGoal.values()];
  const extras = [...unmatched.values()].map((group) => ({ ...group, unconfigured: true }));
  const all = [...groups, ...extras];

  return {
    groups: all,
    stats: {
      notesScanned: notes.length,
      notesWithContributions,
      contributions: all.reduce((sum, group) => sum + group.contributions.length, 0),
      goalsWithEvidence: all.filter((group) => group.contributions.length > 0).length,
      goalsWithoutEvidence: groups.filter((group) => group.contributions.length === 0).map((group) => group.goal.name),
      unconfiguredGoals: extras.map((group) => group.goal.name),
    },
  };
}

const escapeCell = (value) => String(value || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

// A review-ready Markdown document: one section per goal, newest evidence
// first, with the note each item came from so every claim stays traceable.
export function goalGroupsToMarkdown(groups = [], { title = "Performance Review Evidence", rangeLabel = "" } = {}) {
  const lines = [`# ${title}`];
  if (rangeLabel) lines.push("", `*${rangeLabel}*`);

  for (const group of groups) {
    lines.push("", "---", "", `## ${group.goal.name}`);
    if (group.goal.target) lines.push("", `**Target:** ${group.goal.target}`);
    if (group.unconfigured) lines.push("", "*Recorded in notes but not in your configured goals.*");

    if (!group.contributions.length) {
      lines.push("", "No contributions recorded in this period.");
      continue;
    }

    lines.push("", `**${group.contributions.length} contribution${group.contributions.length !== 1 ? "s" : ""}**`, "");
    lines.push("| Date | Contribution | Metric | Source Note |");
    lines.push("|------|--------------|--------|-------------|");
    for (const item of group.contributions) {
      lines.push(`| ${escapeCell(item.date)} | ${escapeCell(item.contribution)} | ${escapeCell(item.metric)} | ${escapeCell(item.noteTitle)} |`);
    }
  }

  return lines.join("\n");
}
