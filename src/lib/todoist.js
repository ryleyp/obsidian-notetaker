// Helpers for pushing the CSM's own follow-ups into Todoist.

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

// Turns one "- [ ] Do the thing — **Owner:** X | **Due:** date" action-item
// line into a Todoist task. Returns null for completed items.
export function todoistTaskFromItemLine(line, { noteTitle = "", label = "" } = {}) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return null;
  if (/^-\s*\[[xX]\]/.test(trimmed)) return null;

  let content = trimmed.replace(/^-\s*(\[[ ]?\]\s*)?/, "").trim();
  let dueString = "";

  const ownerMatch = content.match(/\s*[—–-]\s*\*\*Owner:\*\*\s*(.*)$/);
  if (ownerMatch) {
    content = content.slice(0, ownerMatch.index).trim();
    const dueMatch = ownerMatch[1].match(/\*\*Due:\*\*\s*(.+)$/);
    if (dueMatch) dueString = dueMatch[1].trim();
  }
  if (/^"?tbd"?\.?$/i.test(dueString)) dueString = "";
  if (!content) return null;

  return {
    content,
    dueString: dueString || undefined,
    labels: label ? [label] : [],
    description: noteTitle ? `From: ${noteTitle}` : undefined,
  };
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
