// Helpers for pushing the CSM's own follow-ups into Todoist.

import { detectAccount } from "./accounts";

// Accepts a bare Todoist project id or a full project URL like
// https://app.todoist.com/app/project/work-tasks-6fwxxx999Mwh88Gj
// and returns the id Todoist's API expects.
export function parseTodoistProjectId(input) {
  const value = String(input || "").trim();
  if (!value) return "";
  if (!value.includes("/")) return value;
  const lastSegment = value.split("/").filter(Boolean).pop() || "";
  // Project URLs end in "<slug>-<id>"; the id is the trailing run of
  // alphanumerics after the final hyphen.
  const match = lastSegment.match(/([A-Za-z0-9]+)$/);
  return match ? match[1] : "";
}

// Label = the account folder the note lives in (last path segment), made
// label-safe. Todoist creates unknown labels automatically.
export function todoistLabelForFolder(folderPath) {
  const name = String(folderPath || "").split("/").filter(Boolean).pop() || "";
  return name.trim().replace(/\s+/g, "-");
}

// Label for a note in a folder: the matched account's configured Todoist tag
// when one is set in Settings, otherwise the folder name.
export function todoistLabelForNote(folderPath, accounts) {
  const account = detectAccount(folderPath, accounts || []);
  const custom = (account.todoistLabel || "").trim();
  if (custom) return custom.replace(/\s+/g, "-");
  return todoistLabelForFolder(folderPath);
}

// Source-citation markers like [T12] [N1] that generated notes append to
// bullets; they don't belong in a task or a due date.
function stripCitations(text) {
  return String(text || "").replace(/\s*\[[TNEO]\d+\]/g, "").trim();
}

// Turns one "- [ ] Do the thing — **Owner:** X | **Due:** date" action-item
// line into a Todoist task. Returns null for completed items.
//
// noteDate ("YYYY-MM-DD", usually from the note's title) becomes the task's
// date when the item has no due of its own, and the retry date when Todoist
// rejects a free-text due — so every task is at least dated by its meeting.
export function todoistTaskFromItemLine(line, { noteTitle = "", label = "", noteDate = "" } = {}) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  if (/^-\s*\[[xX]\]/.test(trimmed)) return null;

  let content = trimmed.replace(/^-\s*(\[[ ]?\]\s*)?/, "").trim();
  let dueString = "";

  const ownerMatch = content.match(/\s*[—–-]\s*\*\*Owner:\*\*\s*(.*)$/);
  if (ownerMatch) {
    content = content.slice(0, ownerMatch.index).trim();
    const dueMatch = ownerMatch[1].match(/\*\*Due:\*\*\s*(.+)$/);
    if (dueMatch) dueString = stripCitations(dueMatch[1]);
  }
  content = stripCitations(content);
  if (/^"?tbd"?\.?$/i.test(dueString)) dueString = "";
  if (!content) return null;

  const fallbackDue = /^\d{4}-\d{2}-\d{2}$/.test(String(noteDate || "").trim())
    ? noteDate.trim()
    : undefined;

  return {
    content,
    dueString: dueString || fallbackDue || undefined,
    fallbackDueString: fallbackDue,
    labels: label ? [label] : [],
    description: noteTitle ? `From: ${noteTitle}` : undefined,
  };
}

// "YYYY-MM-DD" from a note title like "2026-08-25 - Acme Sync", or "".
export function noteDateFromTitle(title) {
  return String(title || "").match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

// Comparison key for duplicate detection: markdown emphasis, case, spacing,
// and trailing punctuation don't make two tasks different.
export function normalizeTaskContent(content) {
  return String(content || "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim()
    .toLowerCase();
}

export function todoistConfigured(settings) {
  return Boolean(settings?.todoistApiToken?.trim() && parseTodoistProjectId(settings?.todoistProject));
}

export async function pushTodoistTasks(apiFetch, settings, tasks) {
  if (!tasks.length) return null;
  const res = await apiFetch("/api/todoist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiToken: settings.todoistApiToken.trim(),
      projectId: parseTodoistProjectId(settings.todoistProject),
      tasks,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Todoist request failed");
  return data;
}
