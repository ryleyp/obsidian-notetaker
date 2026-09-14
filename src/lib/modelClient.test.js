import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelClient } from "./modelClient";
import { POST as generateNote } from "@/app/api/process/route";
import { POST as generateReport } from "@/app/api/synthesize/route";
import { POST as improveReport } from "@/app/api/improve-activities/route";
import { getSessionToken } from "./sessionToken";

const params = { model: "gpt-5.6-terra", system: "Keep the Markdown format.", messages: [{ role: "user", content: "Notes" }], max_tokens: 2000 };
const completed = (text) => ({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 42, output_tokens: 17 } });
function sse(events, chunkSize = 7) {
  const bytes = new TextEncoder().encode(events.map((event) => `event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } }));
}
const client = () => createModelClient({ model: params.model, apiKey: "claude-key-never-send", openaiApiKey: "openai-test-key" });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OpenAI provider adapter", () => {
  it("resolves finalMessage for callers that never iterate the stream", async () => {
    // The email-thread note only wants the finished message, the way
    // Anthropic's stream allows; the adapter must drain itself.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([
      { type: "response.output_text.delta", delta: "# Thread note" },
      { type: "response.completed", response: completed("# Thread note") },
    ])));
    const message = await client().messages.stream(params).finalMessage();
    expect(message.content[0].text).toBe("# Thread note");
  });

  it("uses only the OpenAI credential, identical prompt text, and disables response storage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(completed("# Notes")));
    vi.stubGlobal("fetch", fetchMock);
    const result = await client().messages.create(params);
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(request.headers.Authorization).toBe("Bearer openai-test-key");
    expect(JSON.stringify(request)).not.toContain("claude-key-never-send");
    expect(JSON.parse(request.body)).toMatchObject({ instructions: params.system, input: params.messages, max_output_tokens: 2000, store: false });
    expect(result).toMatchObject({ content: [{ type: "text", text: "# Notes" }], usage: { input_tokens: 42, output_tokens: 17 } });
  });

  it("preserves Unicode text across split SSE chunks and normalizes final usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([
      { type: "response.output_text.delta", delta: "# Notes — café" },
      { type: "response.completed", response: completed("# Notes — café") },
    ])));
    const stream = client().messages.stream(params);
    const chunks = [];
    for await (const event of stream) chunks.push(event.delta.text);
    expect(chunks.join("")).toBe("# Notes — café");
    expect((await stream.finalMessage()).usage.output_tokens).toBe(17);
  });

  it("preserves partial deltas but rejects premature stream termination", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse([{ type: "response.output_text.delta", delta: "partial" }])));
    const chunks = [];
    await expect((async () => { for await (const event of client().messages.stream(params)) chunks.push(event.delta.text); })()).rejects.toThrow("before completion");
    expect(chunks).toEqual(["partial"]);
  });

  it("reports provider errors and incomplete output rather than accepting it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: { message: "Invalid API key" } }, { status: 401 })));
    await expect(client().messages.create(params)).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } })));
    await expect(client().messages.create(params)).rejects.toThrow("max_output_tokens");
  });

  it("never falls back to an Anthropic key for OpenAI", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => createModelClient({ model: "gpt-5.6-terra", apiKey: "claude-key" })).toThrow("OpenAI (ChatGPT) API key is required");
  });

  it("resolves Auto to the configured provider before sending", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(completed("# Auto")));
    vi.stubGlobal("fetch", fetchMock);
    const auto = createModelClient({ model: "auto", openaiApiKey: "openai-test-key" });
    expect(auto.resolvedModel).toBe("gpt-5.6-terra");
    await auto.messages.create({ ...params, model: "auto" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe("gpt-5.6-terra");
  });
});

function request(body) {
  return new Request("http://localhost/api/test", { method: "POST", headers: { "content-type": "application/json", "x-notetaker-session": getSessionToken() }, body: JSON.stringify({ model: "gpt-5.6-terra", openaiApiKey: "test-key", ...body }) });
}
describe("OpenAI workflow integration", () => {
  it("uses the established meeting note template and existing streaming envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse([{ type: "response.output_text.delta", delta: "## Executive Summary\nPlan approved." }, { type: "response.completed", response: completed("## Executive Summary\nPlan approved.") }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await generateNote(request({ transcript: "Acme approved licensing.", meetingTitle: "Planning" }));
    const text = await response.text();
    expect(text).toContain('"type":"delta"');
    expect(text).toContain('"type":"done"');
    const input = JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content;
    expect(input).toContain("## Executive Summary");
    expect(input).toContain("## SFDC Activity Entry");
  });

  it("uses the same NDJSON report prompt for OpenAI", async () => {
    const row = JSON.stringify({ title: "Licensing Sync", comments: "Approved licensing." });
    const fetchMock = vi.fn().mockResolvedValue(sse([{ type: "response.output_text.delta", delta: row }, { type: "response.completed", response: completed(row) }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await generateReport(request({ notes: [{ title: "Acme Sync", date: "2026-08-12", content: "Acme approved licensing." }], accountName: "Acme", promptType: "csm-activity" }));
    expect(await response.text()).toContain('"type":"done"');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).instructions).toContain("newline-delimited JSON");
  });

  it("improves both existing and new activities through OpenAI with unchanged schema", async () => {
    const row = { title: "Sync", comments: "Reviewed licensing.", type: "Strategic Relationship Management", subtype: "EA Admin Sync" };
    const change = { index: 0, ...row, comments: "Confirmed the licensing plan." };
    const fetchMock = vi.fn().mockResolvedValue(Response.json(completed(JSON.stringify({ message: "Tightened the summary.", changes: [change] }))));
    vi.stubGlobal("fetch", fetchMock);
    const response = await improveReport(request({ rows: [{ ...row, origin: "note" }, { ...row, origin: "generated" }] }));
    expect(response.status).toBe(200);
    expect((await response.json()).changes).toEqual([change]);
    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).instructions;
    expect(prompt).toContain('"origin":"note"');
    expect(prompt).toContain('"origin":"generated"');
    const format = JSON.parse(fetchMock.mock.calls[0][1].body).text.format;
    expect(format).toMatchObject({ type: "json_schema", name: "ea_activity_improvement", strict: true });
  });
});
