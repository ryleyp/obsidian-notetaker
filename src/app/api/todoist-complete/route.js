import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { closeTodoistTask, listProjectTasks } from "@/lib/todoistApi";

// Closes active Todoist tasks whose content starts with the given prefix —
// used to retire "Respond to <thread>" reminders once a pasted update shows
// no reply is owed anymore.
export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { apiToken, projectId, contentPrefix } = body;

    if (!apiToken?.trim() || !projectId?.trim()) {
      return NextResponse.json({ error: "Todoist token and project are required" }, { status: 400 });
    }
    if (!contentPrefix?.trim() || contentPrefix.trim().length < 12) {
      return NextResponse.json({ error: "A specific content prefix is required" }, { status: 400 });
    }

    const tasks = (await listProjectTasks(apiToken.trim(), projectId.trim()))
      .filter((task) => task.content.startsWith(contentPrefix.trim()))
      .slice(0, 20);

    let closed = 0;
    const failed = [];
    for (const task of tasks) {
      try {
        await closeTodoistTask(apiToken.trim(), task.id);
        closed += 1;
      } catch (err) {
        failed.push({ content: task.content, error: err?.message || "Request failed" });
        if (err?.status === 401 || err?.status === 403) break;
      }
    }

    return NextResponse.json({ closed, failed });
  } catch (error) {
    console.error("Todoist complete error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to close Todoist tasks" },
      { status: error?.status || 500 }
    );
  }
}
