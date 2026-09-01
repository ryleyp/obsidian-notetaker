// Server-side Todoist API calls (unified v1 API).

const TODOIST_API_BASE = "https://api.todoist.com/api/v1";

// Creates a task, retrying once if Todoist rejects the due date — notes often
// carry free-text dues ("Week of August 20") that Todoist's natural-language
// parser refuses; the task itself should still be created. The retry uses
// fallbackDue (the source note's ISO date) when given, else no due date.
export async function createTodoistTaskWithDueFallback(apiToken, payload, fallbackDue) {
  try {
    return { data: await createTodoistTask(apiToken, payload), droppedDue: false };
  } catch (err) {
    if (err?.status !== 400 || !payload.due_string) throw err;
    const { due_string, ...withoutDue } = payload;
    const retry = fallbackDue && fallbackDue !== due_string
      ? { ...withoutDue, due_string: fallbackDue }
      : withoutDue;
    return { data: await createTodoistTask(apiToken, retry), droppedDue: true };
  }
}

export async function createTodoistTask(apiToken, payload) {
  const res = await fetch(`${TODOIST_API_BASE}/tasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(`Todoist responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    error.status = res.status;
    throw error;
  }
  return res.json().catch(() => ({}));
}

// Contents of tasks completed in the project since `since`, for marking the
// matching Obsidian action items done.
export async function listCompletedTaskContents(apiToken, projectId, since) {
  const contents = [];
  let cursor = null;

  do {
    const params = new URLSearchParams({
      project_id: projectId,
      since: since.toISOString(),
      until: new Date().toISOString(),
      limit: "100",
    });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${TODOIST_API_BASE}/tasks/completed/by_completion_date?${params}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      const error = new Error(`Todoist responded ${res.status} while listing completed tasks`);
      error.status = res.status;
      throw error;
    }
    const data = await res.json();
    for (const task of data.items || data.results || []) {
      if (task?.content) contents.push(task.content);
    }
    cursor = data.next_cursor || null;
  } while (cursor);

  return contents;
}

// Contents of every active task in a project, for duplicate detection.
export async function listProjectTaskContents(apiToken, projectId) {
  const contents = [];
  let cursor = null;

  do {
    const params = new URLSearchParams({ project_id: projectId, limit: "200" });
    if (cursor) params.set("cursor", cursor);
    const res = await fetch(`${TODOIST_API_BASE}/tasks?${params}`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) {
      const error = new Error(`Todoist responded ${res.status} while listing tasks`);
      error.status = res.status;
      throw error;
    }
    const data = await res.json();
    for (const task of data.results || []) {
      if (task?.content) contents.push(task.content);
    }
    cursor = data.next_cursor || null;
  } while (cursor);

  return contents;
}
