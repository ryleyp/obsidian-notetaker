import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionToken } from "@/lib/sessionToken";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

const TODAY = "2026-10-07";
const ACCOUNT = "Acme Aerospace";

const recent = (date, extra = "") => ({
  date,
  title: `${date} - Acme Sync`,
  content: `## Executive Summary\n\nThe SLE migration is progressing at MFC.${extra}\n\n## Transcript\n\nraw speech nobody should quote`,
});

const DRAFT = `${ACCOUNT}: ${TODAY} - At MFC, the SLE migration is progressing and the pilot runs in a closed area. Unclassified programs continue, and classified programs follow once it wraps. At RMS, the migration is underway.

Risk: The classified migration will not finish by the October 2027 deadline, so bridge licenses need to be added ahead of renewal.

Next step: Reconvene with MFC in early November to review the assessment.

---

Other risks considered:
- Pilot slips past October`;

function mockDraft(text = DRAFT) {
  create.mockResolvedValue({ content: [{ type: "text", text }], usage: { input_tokens: 100, output_tokens: 40 } });
}

function post(body = {}, token = getSessionToken()) {
  return POST(new Request("http://localhost/api/status-update", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": token },
    body: JSON.stringify({
      account: ACCOUNT, accountName: ACCOUNT, today: TODAY, apiKey: "test-key",
      notes: [recent("2026-10-06"), recent("2026-09-28")],
      ...body,
    }),
  }));
}

beforeEach(() => {
  create.mockReset();
  mockDraft();
});

describe("/api/status-update", () => {
  it("returns the three parts, the private list apart from them, and the sources", async () => {
    const data = await (await post()).json();

    expect(data.update.status.startsWith(`${ACCOUNT}: ${TODAY} - `)).toBe(true);
    expect(data.update.risk).toContain("October 2027 deadline");
    expect(data.update.nextStep).toContain("early November");
    expect(data.update.otherRisks).toEqual(["Pilot slips past October"]);
    expect(data.sourceNotes).toHaveLength(2);
    expect(data.flags).toEqual([]);
  });

  it("sends only the quarter's notes, newest first, and says what fell outside", async () => {
    const data = await (await post({ notes: [recent("2026-10-06"), recent("2026-01-15"), recent("2026-09-20")] })).json();

    const prompt = create.mock.calls[0][0].messages[0].content;
    expect(prompt.indexOf("2026-10-06")).toBeLessThan(prompt.indexOf("2026-09-20"));
    expect(prompt).not.toContain("2026-01-15");
    expect(data.notesOutsideWindow).toBe(1);
    expect(data.flags.map((f) => f.id)).toContain("D9");
  });

  it("sends the reportable sections and not the transcript", async () => {
    await post();
    const prompt = create.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("The SLE migration is progressing");
    expect(prompt).not.toContain("raw speech nobody should quote");
  });

  it("pseudonymizes what it sends and restores names in the draft", async () => {
    mockDraft(DRAFT.replace("the pilot runs", "PERSON_1 runs the pilot"));
    const data = await (await post({
      replacements: [{ original: "Dana Whitfield", alias: "PERSON_1" }],
      notes: [recent("2026-10-06", " Dana Whitfield owns it.")],
    })).json();

    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain("Dana Whitfield");
    expect(data.update.status).toContain("Dana Whitfield");
    // Restored, and then caught by the rule that bans naming individuals.
    expect(data.flags.map((f) => f.id)).toContain("D5");
  });

  it("repairs the dashes and header the spec bans before returning", async () => {
    mockDraft("At MFC the migration progresses — the pilot runs. It continues. It wraps in November.\n\nRisk: It slips.\n\nNext step: Reconvene.");
    const data = await (await post()).json();

    expect(data.update.status.startsWith(`${ACCOUNT}: ${TODAY} - `)).toBe(true);
    expect(data.update.status).not.toContain("—");
    expect(data.update.status).toContain("progresses, the pilot runs");
  });

  it("refuses when nothing is recent, rather than reporting on stale notes", async () => {
    const response = await post({ notes: [recent("2025-11-20")] });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("last quarter");
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses without an account or a session token", async () => {
    expect((await post({ account: "", accountName: "" })).status).toBe(400);
    expect((await post({}, "wrong-token")).status).toBe(401);
  });
});
