import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionToken } from "@/lib/sessionToken";
import { POST } from "./route";

// The route streams (see route.js: non-streaming Claude calls above ~21k
// output tokens are rejected by the SDK outright), so the mock exposes
// messages.stream(...).finalMessage() rather than messages.create(...).
const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { stream }; } }));
function mockFinalMessage(message) {
  stream.mockReturnValue({ finalMessage: async () => message });
}
const row = { eventDate: "2026-08-12", title: "Acme Sync", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Dana reviewed licensing.", sourceTitle: "Acme Notes", origin: "note", agreement: "EA 123" };
const change = { index: 0, title: row.title, type: row.type, subtype: row.subtype, comments: "Dana confirmed the licensing plan." };
function request(body = {}, token = getSessionToken()) {
  return new Request("http://localhost/api/improve-activities", { method: "POST", headers: { "content-type": "application/json", "x-notetaker-session": token }, body: JSON.stringify({ rows: [row, { ...row, origin: "generated" }], instructions: "Tighten the comments.", apiKey: "test-key", ...body }) });
}
beforeEach(() => {
  stream.mockReset();
  mockFinalMessage({ content: [{ type: "text", text: JSON.stringify({ message: "Proposed clearer comments.", changes: [change] }) }], usage: { input_tokens: 100, output_tokens: 30 }, stop_reason: "end_turn" });
});

describe("activity improvement", () => {
  it("sends both harvested and generated rows and returns proposals only", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect((await result.json()).changes).toEqual([change]);
    const prompt = stream.mock.calls[0][0].system;
    expect(prompt).toContain('"origin":"note"');
    expect(prompt).toContain('"origin":"generated"');
    expect(prompt).toContain("none loaded — wording-only refinement");
  });

  it("sanitizes all outbound text, scrubs other accounts before aliases, and restores replies", async () => {
    mockFinalMessage({ content: [{ type: "text", text: JSON.stringify({ message: "PERSON_1 confirmed it.", changes: [{ ...change, comments: "PERSON_1 confirmed the licensing plan. OtherCo is unrelated." }] }) }] });
    const result = await POST(request({ accountName: "Acme", allAccounts: [{ name: "Acme" }, { name: "OtherCo" }],
      replacements: [{ original: "Dana", alias: "PERSON_1" }, { original: "OtherCo", alias: "ORG_2" }],
      notes: [{ title: "Acme Notes", date: "2026-08-12", content: "Acme: Dana confirmed licensing.\nOtherCo has a secret migration." }],
      instructions: "Dana reviewed OtherCo too. Improve wording.",
    }));
    expect(result.status).toBe(200);
    const sent = JSON.stringify(stream.mock.calls[0][0]);
    expect(sent).not.toContain("Dana");
    expect(sent).not.toContain("OtherCo");
    expect(sent).not.toContain("secret migration");
    expect(sent).toContain("PERSON_1");
    const data = await result.json();
    expect(data.message).toBe("Dana confirmed it.");
    expect(data.changes[0].comments).not.toContain("OtherCo");
  });

  it("rejects untrusted requests without calling Claude", async () => {
    expect((await POST(request({}, "wrong-token"))).status).toBe(401);
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects excess rows instead of silently skipping any", async () => {
    expect((await POST(request({ rows: Array(81).fill(row) }))).status).toBe(400);
    expect(stream).not.toHaveBeenCalled();
  });

  it.each([
    { changes: [{ ...change, index: 99 }] },
    { changes: [{ ...change, subtype: "Invented subtype" }] },
    { changes: [{ ...change, comments: "x".repeat(801) }] },
    { changes: [change, change] },
  ])("rejects malformed proposals without partial edits: %j", async (override) => {
    mockFinalMessage({ content: [{ type: "text", text: JSON.stringify({ message: "Edits", ...override }) }] });
    const result = await POST(request());
    expect(result.status).toBe(500);
    expect(await result.json()).not.toHaveProperty("changes");
  });

  // A note roughly the size of a long meeting write-up.
  const bigNote = (date) => ({ date, title: `${date} - Acme Sync`, content: "Acme licensing detail. ".repeat(2_000) });

  it("reviews a quarter of long notes instead of refusing on size", async () => {
    // ~45 notes x ~46KB is well past the old fixed 350,000-character ceiling.
    const notes = Array.from({ length: 45 }, (_, i) => bigNote(`2026-${String((i % 12) + 1).padStart(2, "0")}-05`));
    expect(JSON.stringify(notes).length).toBeGreaterThan(350_000);

    const result = await POST(request({ notes, model: "claude-opus-5" }));

    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.sourcesDropped).toBe(0);
    expect(data.sourcesUsed).toBe(notes.length);
  });

  it("keeps the newest notes and says so when the sources cannot all fit", async () => {
    // Haiku's window is the smallest on offer, so it is where trimming bites.
    const notes = Array.from({ length: 30 }, (_, i) => bigNote(`2026-${String(i + 1).padStart(2, "0")}-05`.replace(/-(\d\d)-(\d\d)$/, (m, mm, dd) => `-${String(Math.min(+mm, 12)).padStart(2, "0")}-${dd}`)));
    const result = await POST(request({ notes, model: "claude-haiku-4-5" }));

    expect(result.status).toBe(200);
    const data = await result.json();
    expect(data.sourcesDropped).toBeGreaterThan(0);
    expect(data.sourcesUsed + data.sourcesDropped).toBe(notes.length);

    const prompt = stream.mock.calls[0][0].system;
    expect(prompt).toContain(`Only the ${data.sourcesUsed} most recent of ${notes.length} notes fit`);
    // Every row still reaches the model — the table is what is being improved.
    expect(prompt).toContain('"index":0');
    expect(prompt).toContain('"index":1');
  });

  it("sizes the request by the model Auto resolved to, not the literal \"auto\"", async () => {
    await POST(request({ model: "auto" }));
    const sent = stream.mock.calls[0][0];
    expect(sent.model).toBe("claude-sonnet-5");
    // Sonnet's ceiling, not the conservative one "auto" reports.
    expect(sent.max_tokens).toBe(64_000);
    expect(sent.response_format).toBeUndefined();
  });

  it("passes each row's known issues through so the pass targets them", async () => {
    await POST(request({ rows: [{ ...row, issues: "MUST FIX: Written in first person." }, row] }));
    const prompt = stream.mock.calls[0][0].system;
    expect(prompt).toContain('"knownIssues":"MUST FIX: Written in first person."');
    expect(prompt).toContain("Every row with knownIssues MUST receive a proposal");
    // Only the row that has issues carries the key, so the model is not told
    // to touch the clean one.
    expect((prompt.match(/"knownIssues":"/g) || []).length).toBe(1);
  });

  it("rejects truncated output", async () => {
    mockFinalMessage({ stop_reason: "max_tokens" });
    const result = await POST(request());
    expect((await result.json()).error).toContain("smaller reporting range");
  });
});
