import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { createTodoistTaskWithDueFallback, listProjectTaskContents } from "@/lib/todoistApi";
import { dropTasksAlreadyInProject } from "@/lib/todoistReconcile";

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

    // Every save used to push every action item, so re-saving a note — or a
    // follow-up meeting carrying an open item forward — filed the same task
    // again. Skip what the project already has before creating anything.
    let toCreate = tasks;
    let skipped = [];
    try {
      const existing = await listProjectTaskContents(apiToken.trim(), projectId.trim());
      ({ tasks: toCreate, skipped } = dropTasksAlreadyInProject(tasks, existing));
    } catch (err) {
      // Listing is a convenience; a push that cannot check still goes through
      // rather than losing the CSM's action items.
      console.warn("Todoist duplicate check skipped:", err?.message);
    }

    const created = [];
    const failed = [];

    for (const task of toCreate) {
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
        const { data } = await createTodoistTaskWithDueFallback(apiToken.trim(), payload, task.fallbackDueString ? String(task.fallbackDueString) : undefined);
        created.push({ content, id: data.id || null });
      } catch (err) {
        failed.push({ content, error: err?.message || "Request failed" });
        // A bad token or project fails every task the same way; stop early.
        if (err?.status === 401 || err?.status === 403 || err?.status === 404) break;
      }
    }

    return NextResponse.json({ created, failed, count: created.length, skipped: skipped.length });
  } catch (error) {
    console.error("Todoist push error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to add Todoist tasks" },
      { status: error?.status || 500 }
    );
  }
}
