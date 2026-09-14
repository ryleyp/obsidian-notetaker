import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionToken } from "@/lib/sessionToken";
import { POST } from "./route";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));
const row = { eventDate: "2026-08-12", title: "Acme Sync", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Dana reviewed licensing.", sourceTitle: "Acme Notes", origin: "note", agreement: "EA 123" };
const change = { index: 0, title: row.title, type: row.type, subtype: row.subtype, comments: "Dana confirmed the licensing plan." };
function request(body = {}, token = getSessionToken()) {
  return new Request("http://localhost/api/improve-activities", { method: "POST", headers: { "content-type": "application/json", "x-notetaker-session": token }, body: JSON.stringify({ rows: [row, { ...row, origin: "generated" }], instructions: "Tighten the comments.", apiKey: "test-key", ...body }) });
}
beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ message: "Proposed clearer comments.", changes: [change] }) }], usage: { input_tokens: 100, output_tokens: 30 }, stop_reason: "end_turn" });
});

describe("activity improvement", () => {
  it("sends both harvested and generated rows and returns proposals only", async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect((await result.json()).changes).toEqual([change]);
    const prompt = create.mock.calls[0][0].system;
    expect(prompt).toContain('"origin":"note"');
    expect(prompt).toContain('"origin":"generated"');
    expect(prompt).toContain("none loaded — wording-only refinement");
  });

  it("sanitizes all outbound text, scrubs other accounts before aliases, and restores replies", async () => {
    create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ message: "PERSON_1 confirmed it.", changes: [{ ...change, comments: "PERSON_1 confirmed the licensing plan. OtherCo is unrelated." }] }) }] });
    const result = await POST(request({ accountName: "Acme", allAccounts: [{ name: "Acme" }, { name: "OtherCo" }],
      replacements: [{ original: "Dana", alias: "PERSON_1" }, { original: "OtherCo", alias: "ORG_2" }],
      notes: [{ title: "Acme Notes", date: "2026-08-12", content: "Acme: Dana confirmed licensing.\nOtherCo has a secret migration." }],
      instructions: "Dana reviewed OtherCo too. Improve wording.",
    }));
    expect(result.status).toBe(200);
    const sent = JSON.stringify(create.mock.calls[0][0]);
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
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects excess rows instead of silently skipping any", async () => {
    expect((await POST(request({ rows: Array(81).fill(row) }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { changes: [{ ...change, index: 99 }] },
    { changes: [{ ...change, subtype: "Invented subtype" }] },
    { changes: [{ ...change, comments: "x".repeat(801) }] },
    { changes: [change, change] },
  ])("rejects malformed proposals without partial edits: %j", async (override) => {
    create.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ message: "Edits", ...override }) }] });
    const result = await POST(request());
    expect(result.status).toBe(500);
    expect(await result.json()).not.toHaveProperty("changes");
  });

  it("rejects truncated output", async () => {
    create.mockResolvedValue({ stop_reason: "max_tokens" });
    const result = await POST(request());
    expect((await result.json()).error).toContain("smaller reporting range");
  });
});
