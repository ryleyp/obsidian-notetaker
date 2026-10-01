import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionToken } from "@/lib/sessionToken";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

const OPEN_TASKS = [
  { id: 101, content: "Send the cert rotation runbook", labels: ["acme"] },
  { id: 102, content: "Book the Q4 review", labels: ["acme"] },
  { id: 103, content: "Chase the Beacon licence count", labels: ["beacon"] },
];

const NOTE = `# 2026-10-01 - Acme Sync

## Executive Summary

CSM sent the cert rotation runbook to Dana on the call. The Q4 review is still unscheduled.

## Action Items

- [x] Send the cert rotation runbook — **Owner:** CSM
- [ ] Book the Q4 review — **Owner:** CSM
`;

let closed = [];

function mockTodoist({ failClose = false } = {}) {
  globalThis.fetch = vi.fn(async (url, init) => {
    const target = String(url);
    if (target.includes("/tasks") && (!init || init.method === undefined || init.method === "GET")) {
      return { ok: true, status: 200, json: async () => ({ results: OPEN_TASKS, next_cursor: null }) };
    }
    if (target.includes("/close")) {
      if (failClose) return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) };
      closed.push(target.match(/tasks\/(\d+)\/close/)?.[1]);
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

function post(body, token = getSessionToken()) {
  return POST(new Request("http://localhost/api/todoist-reconcile", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": token },
    body: JSON.stringify({ apiToken: "tok", projectId: "proj", ...body }),
  }));
}

beforeEach(() => {
  closed = [];
  create.mockReset();
  create.mockResolvedValue({ content: [{ type: "text", text: "" }], usage: { input_tokens: 10, output_tokens: 2 } });
  mockTodoist();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.fetch;
});

describe("/api/todoist-reconcile preview", () => {
  it("proposes the task the note ticks off, scoped to the account", async () => {
    const data = await (await post({ notes: NOTE, label: "acme" })).json();

    expect(data.proposals).toEqual([
      { id: "101", content: "Send the cert rotation runbook", reason: "Ticked off in this note", evidence: "", certain: true },
    ]);
    // The other account's task was never even considered.
    expect(data.openTasks).toBe(2);
  });

  it("adds what the model finds, but only with a quote from the note", async () => {
    create.mockResolvedValue({
      content: [{ type: "text", text: [
        '{"id":"102","done":true,"reason":"Booked on the call","evidence":"The Q4 review is still unscheduled."}',
        '{"id":"103","done":true,"reason":"out of scope","evidence":"nope"}',
      ].join("\n") }],
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const data = await (await post({ notes: NOTE, label: "acme", apiKey: "test-key" })).json();

    // Ticked-off first, then the model's — and never another account's task.
    expect(data.proposals.map((p) => p.id)).toEqual(["101", "102"]);
    expect(data.proposals[1].evidence).toBe("The Q4 review is still unscheduled.");
    expect(data.model).toBe("claude-haiku-4-5");
  });

  it("says so when it could only do the exact matches", async () => {
    const data = await (await post({ notes: NOTE, label: "acme" })).json();
    expect(data.warnings.join(" ")).toContain("add an API key");
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the proposal when the model call fails, rather than losing the run", async () => {
    create.mockRejectedValue(new Error("rate limited"));
    const data = await (await post({ notes: NOTE, label: "acme", apiKey: "test-key" })).json();
    expect(data.proposals.map((p) => p.id)).toEqual(["101"]);
    expect(data.warnings.join(" ")).toContain("rate limited");
  });

  it("does nothing without a note, and refuses without credentials or a session", async () => {
    expect((await (await post({ notes: "", label: "acme" })).json()).proposals).toEqual([]);
    expect((await post({ notes: NOTE, apiToken: "" })).status).toBe(400);
    expect((await post({ notes: NOTE }, "wrong-token")).status).toBe(401);
  });
});

describe("/api/todoist-reconcile close", () => {
  it("closes exactly the approved tasks", async () => {
    const data = await (await post({ mode: "close", taskIds: ["101", "102"] })).json();
    expect(data).toMatchObject({ closed: 2, skipped: 0 });
    expect(closed).toEqual(["101", "102"]);
  });

  it("will not close a task that is not open in this project", async () => {
    const data = await (await post({ mode: "close", taskIds: ["101", "999"] })).json();
    expect(data).toMatchObject({ closed: 1, skipped: 1 });
    expect(closed).toEqual(["101"]);
  });

  it("reports a failure instead of claiming the task closed", async () => {
    mockTodoist({ failClose: true });
    const data = await (await post({ mode: "close", taskIds: ["101"] })).json();
    expect(data.closed).toBe(0);
    expect(data.failed).toHaveLength(1);
  });

  it("refuses an empty close request", async () => {
    expect((await post({ mode: "close", taskIds: [] })).status).toBe(400);
  });
});
