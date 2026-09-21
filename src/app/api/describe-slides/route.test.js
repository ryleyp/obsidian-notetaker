import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { getSessionToken } from "@/lib/sessionToken";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

const slide = (id) => ({ id, name: `${id}.png`, mediaType: "image/jpeg", data: "QUJD" });

function post(body, token = getSessionToken()) {
  return POST(new Request("http://localhost/api/describe-slides", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": token },
    body: JSON.stringify({ apiKey: "test-key", model: "claude-sonnet-5", ...body }),
  }));
}

beforeEach(() => {
  create.mockReset();
  create.mockImplementation(async ({ messages }) => ({
    content: [{ type: "text", text: `# Read ${messages[0].content[1].text.match(/Slide (\d+)/)[1]}` }],
    usage: { input_tokens: 500, output_tokens: 40 },
  }));
});

describe("/api/describe-slides", () => {
  it("reads each slide with one image call and sums the usage", async () => {
    const res = await post({ slides: [slide("a"), slide("b")] });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.slides).toEqual([{ id: "a", text: "# Read 1", error: "" }, { id: "b", text: "# Read 2", error: "" }]);
    expect(data.usage).toEqual({ input_tokens: 1000, output_tokens: 80 });
    expect(create).toHaveBeenCalledTimes(2);
    const sent = create.mock.calls[0][0];
    expect(sent.messages[0].content[0]).toMatchObject({ type: "image", source: { media_type: "image/jpeg", data: "QUJD" } });
    expect(sent.system).toContain("Never guess at cropped or blurred text");
  });

  it("fails one slide without losing the rest", async () => {
    create.mockImplementationOnce(async () => { throw new Error("image too small"); });
    const data = await (await post({ slides: [slide("a"), slide("b")] })).json();
    expect(data.slides[0]).toEqual({ id: "a", text: "", error: "image too small" });
    expect(data.slides[1].text).toBe("# Read 2");
  });

  it("rejects a bad payload before spending anything", async () => {
    expect((await post({ slides: [] })).status).toBe(400);
    expect((await post({ slides: [{ id: "x", mediaType: "application/pdf", data: "QUJD" }] })).status).toBe(400);
    expect((await post({ slides: [slide("a")] }, "wrong-token")).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
