import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { createModelClient } from "@/lib/modelClient";
import { FAST_MODEL, firstTextBlock } from "@/lib/models";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { closeTodoistTask, listProjectTasks } from "@/lib/todoistApi";
import {
  completionEvidence,
  mergeProposals,
  parseCompletionVerdicts,
  tasksForLabel,
  tasksTickedOffByNote,
} from "@/lib/todoistReconcile";

// Reads a note that was just written against the account's open Todoist
// tasks and says which of them it finishes.
//
//   "preview" — propose. Tasks the note ticks off by name are certain; the
//               rest come from a model that has to quote the note for each
//               one. Nothing is closed.
//   "close"   — close the task ids the CSM approved, and only those.
//
// Closing someone's task list is not a thing to do on a guess, so the two
// are separate calls with the CSM in between.

const MAX_TASKS = 120;

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const {
      mode = "preview",
      apiToken,
      projectId,
      notes = "",
      noteTitle = "",
      label = "",
      taskIds = [],
      replacements = [],
      corrections = [],
      apiKey,
      openaiApiKey,
      model,
    } = await request.json();

    if (!apiToken?.trim() || !projectId?.trim()) {
      return NextResponse.json({ error: "Todoist token and project are required" }, { status: 400 });
    }

    if (mode === "close") {
      const wanted = [...new Set(taskIds.map(String))].slice(0, 50);
      if (!wanted.length) return NextResponse.json({ error: "No tasks to close" }, { status: 400 });

      // Only ever close a task that is open in this project right now.
      const open = new Set((await listProjectTasks(apiToken.trim(), projectId.trim())).map((task) => String(task.id)));
      let closed = 0;
      const failed = [];
      for (const id of wanted.filter((id) => open.has(id))) {
        try {
          await closeTodoistTask(apiToken.trim(), id);
          closed += 1;
        } catch (err) {
          failed.push({ id, error: err?.message || "Request failed" });
          if (err?.status === 401 || err?.status === 403) break;
        }
      }
      return NextResponse.json({ closed, failed, skipped: wanted.length - closed - failed.length });
    }

    if (!String(notes || "").trim()) return NextResponse.json({ proposals: [] });

    const scoped = tasksForLabel(await listProjectTasks(apiToken.trim(), projectId.trim()), label).slice(0, MAX_TASKS);
    if (!scoped.length) return NextResponse.json({ proposals: [], openTasks: 0 });

    const certain = tasksTickedOffByNote(scoped, notes);
    const remaining = scoped.filter((task) => !certain.some((item) => item.id === String(task.id)));

    let suggested = [];
    let usage = null;
    let resolvedModel = null;
    const warnings = [];

    const hasKey = apiKey?.trim() || openaiApiKey?.trim() || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
    if (remaining.length && hasKey) {
      const clean = (text) => applyReplacements(applyCorrections(String(text || ""), corrections), replacements);
      try {
        const client = createModelClient({ model: model || FAST_MODEL, apiKey, openaiApiKey, task: "fast", signal: request.signal });
        resolvedModel = client.resolvedModel;
        const msg = await client.messages.create({
          model: client.resolvedModel,
          max_tokens: 2000,
          system: "You decide which of a Customer Success Manager's open to-dos a new meeting note or email thread shows are finished. Be strict: only a task the note says was actually done. A task merely discussed, planned, rescheduled, or still outstanding is NOT done. Respond with only newline-delimited JSON objects, no prose.",
          messages: [{
            role: "user",
            content: `OPEN TASKS (JSON):\n${JSON.stringify(remaining.map((task) => ({ id: String(task.id), content: clean(task.content) })), null, 1)}\n\nNOTE "${clean(noteTitle)}":\n\n${clean(completionEvidence(notes))}\n\nFor each task the note shows is DONE, output one line: {"id":"<task id>","done":true,"reason":"<short reason>","evidence":"<exact quote from the note, max 240 chars>"}\nThe evidence must be a real quote from the note above. Output nothing for tasks that are not clearly done — most of the time that is every task.`,
          }],
        });
        usage = msg.usage || null;
        suggested = parseCompletionVerdicts(firstTextBlock(msg), remaining);
      } catch (err) {
        warnings.push(`Could not check the remaining ${remaining.length} tasks: ${err.message}`);
      }
    } else if (remaining.length) {
      warnings.push("Only exact ticked-off matches were checked — add an API key to have the rest read against this note.");
    }

    return NextResponse.json({
      proposals: mergeProposals(certain, suggested),
      openTasks: scoped.length,
      warnings,
      usage,
      model: resolvedModel,
    });
  } catch (error) {
    console.error("Todoist reconcile error:", error);
    return NextResponse.json({ error: error?.message || "Could not check Todoist" }, { status: error?.status || 500 });
  }
}
