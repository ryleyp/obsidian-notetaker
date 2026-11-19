import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST, buildReplyPrompt, promptTemplateText } from "./route";
import { getSessionToken } from "@/lib/sessionToken";
import { assertOutboundPrivacy } from "@/lib/privacyBoundary";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

function post(body, headers = { "x-notetaker-session": getSessionToken() }) {
  return POST(new Request("http://localhost/api/draft-reply", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ apiKey: "test-key", model: "claude-sonnet-5", ...body }),
  }));
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async (params) => {
    const alias = params.messages[0].content.match(/PRIVATE_[A-F0-9]{12}/)?.[0] || "none";
    return { content: [{ type: "text", text: `Reply to ${alias}` }], usage: { input_tokens: 10, output_tokens: 5 } };
  });
});

describe("buildReplyPrompt", () => {
  it("shapes an email reply with a subject and the shared CSM practices", () => {
    const prompt = buildReplyPrompt({
      thread: "From: PRIVATE_AAAAAAAAAAAA\n\nCan you confirm the count?",
      note: "## Thread Summary\n\n- Count requested.",
      accountContext: "### 2026-10-03 - Sync\nNext steps:\n- Pilot in November.",
      threadTitle: "Count check",
      reason: "PRIVATE_AAAAAAAAAAAA asked for the count",
      ownerNames: ["PRIVATE_BBBBBBBBBBBB"],
    });

    expect(prompt).toContain("**Subject:** RE:");
    expect(prompt).toContain("CSM best practices");
    expect(prompt).toContain("Why a reply is owed: PRIVATE_AAAAAAAAAAAA asked for the count");
    expect(prompt).toContain("RECENT ACCOUNT HISTORY");
    expect(prompt).toContain("Pilot in November.");
    expect(prompt).toContain("## Before You Send");
    expect(prompt).toContain("Customer contacts.");
  });

  it("shapes a Teams reply as a chat message and leaves out empty sources", () => {
    const prompt = buildReplyPrompt({ thread: "[9:02] You: on it", threadKind: "teams", audience: "internal" });

    expect(prompt).toContain("Write a Teams chat message");
    expect(prompt).not.toContain("**Subject:** RE:");
    expect(prompt).toContain("NI colleagues only.");
    expect(prompt).not.toContain("RECENT ACCOUNT HISTORY");
    expect(prompt).not.toContain("PREVIOUS DRAFT");
  });

  it("carries the CSM's instruction and the draft being revised", () => {
    const prompt = buildReplyPrompt({ thread: "t", instructions: "Offer Tuesday.", previousDraft: "Hi there." });
    expect(prompt).toContain("Offer Tuesday.");
    expect(prompt).toContain("PREVIOUS DRAFT");
  });

  it("clears the privacy boundary when anonymized, and is blocked when a glossary name is left in", () => {
    const policy = { sensitiveTerms: ["Dana", "Acme", "Teams"], templateText: promptTemplateText() };
    const send = (thread) => () => assertOutboundPrivacy(
      { messages: [{ role: "user", content: buildReplyPrompt({ thread, threadKind: "teams" }) }] },
      policy
    );
    expect(send("PRIVATE_AAAAAAAAAAAA: can you confirm?")).not.toThrow();
    expect(send("Dana: can you confirm?")).toThrow(/blocked this AI request/);
  });
});

describe("/api/draft-reply", () => {
  it("rejects a caller without the session token", async () => {
    const res = await post({ thread: "hello" }, {});
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires thread content", async () => {
    expect((await post({ thread: " " })).status).toBe(400);
  });

  it("never sends a leftover address, and restores it in the draft", async () => {
    const res = await post({ thread: "From: dana.okafor@example.test\n\nPlease confirm the count." });
    expect(res.status).toBe(200);
    const data = await res.json();

    const sent = create.mock.calls[0][0];
    expect(`${sent.system}\n${sent.messages[0].content}`).not.toContain("dana.okafor@example.test");
    expect(data.draft).toBe("Reply to dana.okafor@example.test");
  });
});
