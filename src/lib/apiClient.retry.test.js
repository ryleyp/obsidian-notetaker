import { afterEach, describe, expect, it, vi } from "vitest";

// A tab left open across a server restart is holding the previous process's
// token; the server now rejects it with 401. apiFetch should recover
// transparently by fetching a new token and retrying once, not require the
// user to reload the page (or, worse, loop forever on a real auth failure).

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function sessionResponse(token) {
  return new Response(JSON.stringify({ token }), { status: 200 });
}

describe("apiFetch stale-session recovery", () => {
  it("refetches the token and retries once after a 401, succeeding transparently", async () => {
    let sessionCalls = 0;
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      if (url === "/api/session") {
        sessionCalls += 1;
        return sessionResponse(sessionCalls === 1 ? "token-A" : "token-B");
      }
      const token = new Headers(init?.headers).get("x-notetaker-session");
      calls.push(token);
      if (token === "token-A") return new Response(JSON.stringify({ error: "Invalid local session token" }), { status: 401 });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));

    const { apiFetch } = await import("./apiClient");
    const res = await apiFetch("/api/notes");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // The stale token was tried once, the retry used the freshly fetched one.
    expect(calls).toEqual(["token-A", "token-B"]);
    expect(sessionCalls).toBe(2);

    // A later call reuses the refreshed token without fetching /api/session again.
    calls.length = 0;
    const before = sessionCalls;
    const res2 = await apiFetch("/api/notes");
    expect(res2.status).toBe(200);
    expect(calls).toEqual(["token-B"]);
    expect(sessionCalls).toBe(before);
  });

  it("returns the second 401 as-is when the retry also fails, rather than looping", async () => {
    let sessionCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/session") {
        sessionCalls += 1;
        return sessionResponse(`token-${sessionCalls}`);
      }
      return new Response(JSON.stringify({ error: "Invalid local session token" }), { status: 401 });
    }));

    const { apiFetch } = await import("./apiClient");
    const res = await apiFetch("/api/notes");

    expect(res.status).toBe(401);
    // One priming session call plus exactly one refresh on the 401 — not a loop.
    expect(sessionCalls).toBe(2);
  });

  it("does not retry a non-401 error response", async () => {
    let requestCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (url === "/api/session") return sessionResponse("token-A");
      requestCalls += 1;
      return new Response(JSON.stringify({ error: "Vault path is required" }), { status: 400 });
    }));

    const { apiFetch } = await import("./apiClient");
    const res = await apiFetch("/api/notes");

    expect(res.status).toBe(400);
    expect(requestCalls).toBe(1);
  });
});
