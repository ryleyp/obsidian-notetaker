import Anthropic from "@anthropic-ai/sdk";
import { isOpenAIModel, providerLabel, resolveAutoModel } from "./models";

// Adapt OpenAI Responses to the small message/stream interface used by the
// existing workflows, preserving their prompts, parsers, and output formats.
export function createModelClient({ model, apiKey, openaiApiKey, signal, task = "generation" }) {
  const resolvedModel = resolveAutoModel(model, { apiKey: apiKey || process.env.ANTHROPIC_API_KEY, openaiApiKey: openaiApiKey || process.env.OPENAI_API_KEY, task });
  const openai = isOpenAIModel(resolvedModel);
  const key = openai ? openaiApiKey || process.env.OPENAI_API_KEY : apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) throw Object.assign(new Error(`${providerLabel(resolvedModel)} API key is required. Add it in Settings or set ${openai ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} in .env.local.`), { status: 400 });
  if (!openai) {
    const anthropic = new Anthropic({ apiKey: key });
    return { resolvedModel, messages: {
      create: (params) => anthropic.messages.create({ ...params, model: resolvedModel }),
      stream: (params) => anthropic.messages.stream({ ...params, model: resolvedModel }),
    } };
  }

  async function send(params, stream) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000),
      body: JSON.stringify({ model: resolvedModel, instructions: params.system || undefined,
        input: params.messages, max_output_tokens: params.max_tokens, stream, store: false,
        text: params.response_format ? { format: params.response_format } : undefined }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw Object.assign(new Error(String(error.error?.message || `OpenAI request failed (${response.status})`).replaceAll(key, "[API key]")), { status: response.status });
    }
    return response;
  }

  function message(response) {
    if (response.status === "failed" || response.error) throw new Error(response.error?.message || "OpenAI generation failed");
    if (response.status === "incomplete") throw new Error(`OpenAI generation stopped early: ${response.incomplete_details?.reason || "incomplete response"}`);
    const parts = (response.output || []).filter((item) => item.type === "message").flatMap((item) => item.content || []);
    if (parts.some((part) => part.type === "refusal")) throw new Error("OpenAI could not complete this request. Review the input and try again.");
    const text = parts.filter((part) => part.type === "output_text").map((part) => part.text).join("");
    if (!text.trim()) throw new Error("OpenAI returned no text. Please try again.");
    return { content: [{ type: "text", text }], usage: { input_tokens: response.usage?.input_tokens || 0, output_tokens: response.usage?.output_tokens || 0 }, stop_reason: "end_turn" };
  }

  return { resolvedModel, messages: {
    async create(params) { return message(await (await send(params, false)).json()); },
    stream(params) {
      let final;
      let consumed = false;
      const stream = {
        async *[Symbol.asyncIterator]() {
          consumed = true;
          const response = await send(params, true);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          try {
            while (true) {
              const { value, done } = await reader.read();
              buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
              buffer = buffer.replace(/\r\n/g, "\n");
              // A final SSE event without a trailing blank line still counts.
              if (done && buffer.trim()) buffer += "\n\n";
              let boundary;
              while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
                if (!data || data === "[DONE]") continue;
                const event = JSON.parse(data);
                if (event.type === "response.output_text.delta") yield { type: "content_block_delta", delta: { type: "text_delta", text: event.delta } };
                else if (event.type === "response.completed") final = message(event.response);
                else if (event.type === "response.failed" || event.type === "response.incomplete") {
                  message(event.response);
                  throw new Error("OpenAI generation did not complete.");
                } else if (event.type === "error") throw new Error(event.message || "OpenAI streaming failed");
              }
              if (done) break;
            }
            if (!final) throw new Error("OpenAI connection ended before completion. Please retry.");
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        },
        // Anthropic's stream resolves finalMessage() whether or not the caller
        // iterated, and callers that only want the finished message (the
        // email-thread note) rely on that — so drain it here when untouched.
        async finalMessage() {
          if (!final && !consumed) {
            const iterator = stream[Symbol.asyncIterator]();
            while (!(await iterator.next()).done) { /* drain to completion */ }
          }
          if (!final) throw new Error("OpenAI response has not completed.");
          return final;
        },
      };
      return stream;
    },
  } };
}
