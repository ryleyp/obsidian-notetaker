import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionToken } from "@/lib/sessionToken";

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { stream }; } }));

function post(body) {
  return POST(new Request("http://localhost/api/email-thread", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": getSessionToken() },
    body: JSON.stringify({ apiKey: "test-key", model: "claude-sonnet-5", ...body }),
  }));
}

// The model echoes back whatever placeholder stands in for the first address
// it was shown, the way a real note would quote a contact.
beforeEach(() => {
  stream.mockReset();
  stream.mockImplementation((params) => ({
    finalMessage: async () => {
      const prompt = params.messages[0].content;
      const alias = prompt.match(/PRIVATE_[A-F0-9]{12}/)?.[0] || "none";
      return { content: [{ type: "text", text: `- Contact: ${alias}` }], usage: { input_tokens: 10, output_tokens: 5 } };
    },
  }));
});

describe("/api/email-thread email repair", () => {
  it.each(["email", "teams"])("never sends a leftover address in a %s thread, and restores it in the note", async (threadKind) => {
    const res = await post({
      threadKind,
      threadTitle: "Count check",
      emailThread: "From: Okafor, Dana <dana.okafor@example.test>\nCc: sam.lee@example.test\n\nPlease confirm the count.",
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    const sent = stream.mock.calls[0][0];
    const sentText = `${sent.system}\n${sent.messages[0].content}`;
    expect(sentText).not.toContain("dana.okafor@example.test");
    expect(sentText).not.toContain("sam.lee@example.test");

    expect(data.note).toBe("- Contact: dana.okafor@example.test");
    expect(data.privacyRepairs).toEqual({ email: 2 });
  });

  it("reports no repair when there was nothing to repair", async () => {
    const data = await (await post({ threadTitle: "T", emailThread: "Please confirm the count." })).json();
    expect(data.privacyRepairs).toBeUndefined();
  });
});
