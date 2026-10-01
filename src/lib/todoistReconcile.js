// Keeping Todoist in step with a note that was just written.
//
// Two problems, both from the same gap: a note was pushed to Todoist without
// anyone looking at what was already there.
//
//   Duplicates — every save pushed every action item, so re-saving a note, or
//   a follow-up meeting that carries an open item forward, filed the same task
//   again.
//
//   Stale tasks — a meeting or email that settles an outstanding action left
//   its Todoist task open, because nothing read the new note against the list.
//
// The matching here is deliberately literal. Closing someone's task is not
// something to guess at, so a proposal has to be either a task the note ticks
// off itself, or one a model points at with a quote from the note.

import { normalizeTaskContent } from "./todoist";

// Tasks whose content is already in the project, by the same normalized key
// the backfill uses. Returns the tasks worth creating and what was skipped.
export function dropTasksAlreadyInProject(tasks = [], existingContents = []) {
  const existing = new Set(existingContents.map(normalizeTaskContent).filter(Boolean));
  const kept = [];
  const skipped = [];
  // A single batch can repeat an item too (Action Items and Next Steps often
  // say the same thing), so the batch checks against itself as it goes.
  const seen = new Set();

  for (const task of tasks) {
    const key = normalizeTaskContent(task?.content);
    if (!key) continue;
    if (existing.has(key) || seen.has(key)) {
      skipped.push(task);
      continue;
    }
    seen.add(key);
    kept.push(task);
  }
  return { tasks: kept, skipped };
}

const CHECKED_LINE = /^\s*-\s*\[[xX✓✔]\]\s*(.+)$/;

// The action items this note marks as already done.
export function completedItemLines(content) {
  return String(content || "")
    .split("\n")
    .map((line) => line.match(CHECKED_LINE)?.[1])
    .filter(Boolean)
    .map((text) => text.replace(/\s*[—–-]\s*\*\*Owner:\*\*.*$/, "").trim())
    .filter(Boolean);
}

// Only the tasks carrying this account's label — a note about one account
// must never close another account's task. With no label, nothing is scoped
// out, which is why the caller passes one whenever it has one.
export function tasksForLabel(tasks = [], label = "") {
  const wanted = String(label || "").trim().toLowerCase();
  if (!wanted) return [...tasks];
  return tasks.filter((task) => (task?.labels || []).some((l) => String(l).toLowerCase() === wanted));
}

// Tasks this note ticks off by name. Exact normalized match only: a task is
// closed because the note says that exact thing is done, not because it looks
// similar.
export function tasksTickedOffByNote(tasks = [], content = "") {
  const done = new Set(completedItemLines(content).map(normalizeTaskContent).filter(Boolean));
  if (!done.size) return [];
  return tasks
    .filter((task) => done.has(normalizeTaskContent(task?.content)))
    .map((task) => ({
      id: String(task.id),
      content: task.content,
      reason: "Ticked off in this note",
      evidence: "",
      certain: true,
    }));
}

// The part of a note worth reading to decide what got finished. The whole
// note is mostly background; these sections are where completion shows up.
export function completionEvidence(content, limit = 6000) {
  const text = String(content || "");
    const sections = ["Executive Summary", "Thread Summary", "Meeting Notes", "Decisions", "Action Items", "Next Steps"]
    .map((heading) => {
      const match = text.match(new RegExp(`^##\\s+${heading}\\s*$\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "im"));
      const body = match?.[1]?.trim();
      return body ? `## ${heading}\n${body}` : "";
    })
    .filter(Boolean);
  const joined = sections.join("\n\n") || text.trim();
  return joined.slice(0, limit);
}

// Reads the model's verdicts. Anything that does not name a task from the
// list, or comes back without evidence, is dropped rather than guessed at.
export function parseCompletionVerdicts(text, tasks = []) {
  const byId = new Map(tasks.map((task) => [String(task.id), task]));
  const out = [];
  const seen = new Set();

  for (const line of String(text || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const id = String(parsed?.id ?? "");
    const task = byId.get(id);
    const evidence = String(parsed?.evidence || "").trim();
    if (!task || seen.has(id) || !parsed?.done || !evidence) continue;
    seen.add(id);
    out.push({
      id,
      content: task.content,
      reason: String(parsed.reason || "Completed per this note").slice(0, 200),
      evidence: evidence.slice(0, 240),
      certain: false,
    });
  }
  return out;
}

// Ticked-off matches first — those are the ones the CSM can accept at a
// glance — then the model's, with no task proposed twice.
export function mergeProposals(certain = [], suggested = []) {
  const seen = new Set(certain.map((item) => item.id));
  return [...certain, ...suggested.filter((item) => !seen.has(item.id))];
}
