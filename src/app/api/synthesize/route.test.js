import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionToken } from "@/lib/sessionToken";

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { stream }; } }));

const notes = [{ title: "2026-05-14 - Acme Sync", date: "2026-05-14", content: "## Action Items\n\n- [ ] Send the quote — **Owner:** Avery\n" }];

function post(body = {}) {
  return POST(new Request("http://localhost/api/synthesize", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": getSessionToken() },
    body: JSON.stringify({ notes, apiKey: "test-key", accountName: "Acme Aerospace", today: "2026-06-01", ...body }),
  }));
}

// The prompt is the user message; draining the SSE body runs the generator.
async function promptFrom(response) {
  const reader = response.body.getReader();
  while (!(await reader.read()).done) { /* drain */ }
  return stream.mock.calls[0][0].messages[0].content;
}

beforeEach(() => {
  stream.mockReset();
  stream.mockReturnValue({
    async *[Symbol.asyncIterator]() { /* no deltas */ },
    finalMessage: async () => ({ usage: { input_tokens: 10, output_tokens: 5 } }),
  });
});

describe("Account Status synthesis", () => {
  it("does not ask for a list of open action items", async () => {
    const prompt = await promptFrom(await post());

    expect(prompt).toContain("## Recent Highlights");
    expect(prompt).toContain("## Pillars of Account Health");
    expect(prompt).not.toContain("## Open Action Items");
    // And they must not resurface inside another section.
    expect(prompt).toContain("Do NOT list open action items");
  });

  it("leaves the product (SL Status) report's action items alone", async () => {
    const prompt = await promptFrom(await post({ productFocus: "SystemLink" }));
    expect(prompt).toContain("## Open Action Items");
  });
});
