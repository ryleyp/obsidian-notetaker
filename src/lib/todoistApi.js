// Server-side Todoist API calls (unified v1 API).

const TODOIST_API_BASE = "https://api.todoist.com/api/v1";

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
