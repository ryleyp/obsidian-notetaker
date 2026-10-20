import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionToken } from "@/lib/sessionToken";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

const shot = (id) => ({ id, name: `${id}.png`, mediaType: "image/jpeg", data: "QUJD" });

function post(body, token = getSessionToken()) {
  return POST(new Request("http://localhost/api/read-chat-screenshots", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": token },
    body: JSON.stringify({ apiKey: "test-key", model: "claude-sonnet-5", ...body }),
  }));
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async ({ messages }) => ({
    content: [{ type: "text", text: `[9:0${messages[0].content[1].text.match(/Screenshot (\d+)/)[1]} AM] Sender: line` }],
    usage: { input_tokens: 500, output_tokens: 40 },
  }));
});

describe("/api/read-chat-screenshots", () => {
  it("reads screenshots in order and sums the usage", async () => {
    const res = await post({ shots: [shot("a"), shot("b")], allowUnredactedImages: true });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.shots).toEqual([
      { id: "a", text: "[9:01 AM] Sender: line", error: "" },
      { id: "b", text: "[9:02 AM] Sender: line", error: "" },
    ]);
    expect(data.usage).toEqual({ input_tokens: 1000, output_tokens: 80 });
    expect(create.mock.calls[0][0].system).toContain("Put that sender on every message in the run");
  });

  it("shows each screenshot the transcription so far, including text carried in from earlier", async () => {
    await post({ shots: [shot("a"), shot("b")], previousText: "[8:59 AM] Earlier: before", allowUnredactedImages: true });
    const first = create.mock.calls[0][0].messages[0].content[1].text;
    const second = create.mock.calls[1][0].messages[0].content[1].text;
    expect(first).toContain("[8:59 AM] Earlier: before");
    expect(second).toContain("[8:59 AM] Earlier: before");
    expect(second).toContain("[9:01 AM] Sender: line");
  });

  it("lets a link in the transcription so far through to the next screenshot", async () => {
    create.mockImplementationOnce(async () => ({
      content: [{ type: "text", text: "[9:01 AM] Sender: see https://example.test/doc" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const data = await (await post({ shots: [shot("a"), shot("b")], allowUnredactedImages: true })).json();
    expect(data.shots[1].error).toBe("");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("fails one screenshot without losing the rest", async () => {
    create.mockImplementationOnce(async () => { throw new Error("image too small"); });
    const data = await (await post({ shots: [shot("a"), shot("b")], allowUnredactedImages: true })).json();
    expect(data.shots[0]).toEqual({ id: "a", text: "", error: "image too small" });
    expect(data.shots[1].text).toBe("[9:02 AM] Sender: line");
  });

  it("rejects a bad payload before spending anything", async () => {
    expect((await post({ shots: [] })).status).toBe(400);
    expect((await post({ shots: [{ id: "x", mediaType: "application/pdf", data: "QUJD" }] })).status).toBe(400);
    expect((await post({ shots: [shot("a")] }, "wrong-token")).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("requires explicit approval before sending image pixels", async () => {
    expect((await post({ shots: [shot("a")] })).status).toBe(422);
    expect(create).not.toHaveBeenCalled();
  });
});
