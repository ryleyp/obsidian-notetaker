import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/requestSafety";

const TODOIST_TASKS_URL = "https://api.todoist.com/api/v1/tasks";

// Relays task creation to Todoist so the browser never talks to Todoist
// directly (CORS) and the token stays out of page-visible network calls to
// third-party origins other than Todoist itself.
export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { apiToken, projectId, tasks } = body;

    if (!apiToken?.trim()) {
      return NextResponse.json({ error: "Todoist API token is required. Add it in Settings." }, { status: 400 });
    }
    if (!projectId?.trim()) {
      return NextResponse.json({ error: "Todoist project is required. Add it in Settings." }, { status: 400 });
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return NextResponse.json({ error: "At least one task is required" }, { status: 400 });
    }
    if (tasks.length > 50) {
      return NextResponse.json({ error: "Too many tasks in one request" }, { status: 400 });
    }

    const created = [];
    const failed = [];

    for (const task of tasks) {
      const content = String(task?.content || "").trim();
      if (!content) continue;
      const payload = {
        content,
        project_id: projectId.trim(),
        ...(task.dueString ? { due_string: String(task.dueString) } : {}),
        ...(Array.isArray(task.labels) && task.labels.length ? { labels: task.labels.map(String) } : {}),
        ...(task.description ? { description: String(task.description) } : {}),
      };

      try {
        const res = await fetch(TODOIST_TASKS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiToken.trim()}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          failed.push({ content, error: `Todoist responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}` });
          // A bad token or project fails every task the same way; stop early.
          if (res.status === 401 || res.status === 403 || res.status === 404) break;
          continue;
        }
        const data = await res.json().catch(() => ({}));
        created.push({ content, id: data.id || null });
      } catch (err) {
        failed.push({ content, error: err?.message || "Request failed" });
      }
    }

    return NextResponse.json({ created, failed, count: created.length });
  } catch (error) {
    console.error("Todoist push error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to add Todoist tasks" },
      { status: error?.status || 500 }
    );
  }
}
