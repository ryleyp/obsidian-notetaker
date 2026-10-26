import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as processPost } from "./process/route";
import { POST as regeneratePost } from "./regenerate/route";
import { POST as followUpPost } from "./follow-up/route";
import { getSessionToken } from "@/lib/sessionToken";

const { stream, create } = vi.hoisted(() => ({ stream: vi.fn(), create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { stream, create }; } }));

const ALIAS = /PRIVATE_[A-F0-9]{12}/;

function post(handler, path, body) {
  return handler(new Request(`http://localhost/api/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": getSessionToken() },
    body: JSON.stringify({ apiKey: "test-key", model: "claude-sonnet-5", ...body }),
  }));
}

const textOf = (params) => `${params.system}\n${params.messages[0].content}`;

// A stream that quotes the placeholder it was shown, split across two chunks
// the way a real model's tokens can split it.
function splitAliasStream(params) {
  const alias = textOf(params).match(ALIAS)?.[0] || "none";
  const cut = Math.floor(alias.length / 2);
  const chunks = ["- Contact: ", alias.slice(0, cut), alias.slice(cut), " for the count."];
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of chunks) yield { type: "content_block_delta", delta: { type: "text_delta", text } };
    },
    finalMessage: async () => ({ usage: { input_tokens: 10, output_tokens: 5 } }),
  };
}

async function readSse(res) {
  const body = await res.text();
  const events = body.split("\n\n").filter((part) => part.startsWith("data: ")).map((part) => JSON.parse(part.slice(6)));
  return {
    text: events.filter((event) => event.type === "delta").map((event) => event.text).join(""),
    done: events.find((event) => event.type === "done"),
    error: events.find((event) => event.type === "error"),
  };
}

beforeEach(() => {
  stream.mockReset();
  create.mockReset();
  stream.mockImplementation(splitAliasStream);
  create.mockImplementation(async (params) => ({
    content: [{ type: "text", text: `Hi — ${textOf(params).match(ALIAS)?.[0]} will follow up.` }],
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
});

describe("leftover email addresses are repaired, not blocked", () => {
  it("New Note: never sends the address, and streams the real one back even when the placeholder is split", async () => {
    const res = await post(processPost, "process", {
      transcript: "Please send it to dana.okafor@example.test by Friday.",
      meetingTitle: "Count check",
    });
    expect(res.status).toBe(200);
    const { text, done, error } = await readSse(res);

    expect(error).toBeUndefined();
    expect(textOf(stream.mock.calls[0][0])).not.toContain("dana.okafor@example.test");
    expect(text).toBe("- Contact: dana.okafor@example.test for the count.");
    expect(done.privacyRepairs).toEqual({ email: 1 });
  });

  it("New Note: reports no repair when there was nothing to repair", async () => {
    stream.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() { yield { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } }; },
      finalMessage: async () => ({ usage: {} }),
    }));
    const { done } = await readSse(await post(processPost, "process", { transcript: "Nothing sensitive here.", meetingTitle: "T" }));
    expect(done.privacyRepairs).toBeUndefined();
  });

  it("Ask for Changes: never sends the address, and restores it in the streamed note", async () => {
    const res = await post(regeneratePost, "regenerate", {
      notes: "# Sync\n\n- Reach Dana at dana.okafor@example.test.",
      instruction: "Tighten this.",
    });
    const { text, error } = await readSse(res);

    expect(error).toBeUndefined();
    expect(textOf(stream.mock.calls[0][0])).not.toContain("dana.okafor@example.test");
    expect(text).toBe("- Contact: dana.okafor@example.test for the count.");
  });

  it("Follow-up draft: never sends the address, and restores it in the draft", async () => {
    const res = await post(followUpPost, "follow-up", {
      notes: "# Sync\n\n- Reach Dana at dana.okafor@example.test.",
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(textOf(create.mock.calls[0][0])).not.toContain("dana.okafor@example.test");
    expect(data.draft).toBe("Hi — dana.okafor@example.test will follow up.");
  });
});
