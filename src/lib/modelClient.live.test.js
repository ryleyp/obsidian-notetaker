import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { createModelClient } from "./modelClient";
import { MODEL_OPTIONS, isOpenAIModel, modelRateLabel } from "./models";

// Real calls against the live OpenAI API, through the same adapter the app
// uses — the mocked tests prove the plumbing, this proves the model IDs and
// the streaming contract are actually right.
//
// Opt in explicitly, because every run spends money:
//   LIVE_MODEL_TEST=1 npx vitest run src/lib/modelClient.live.test.js
// The key comes from OPENAI_API_KEY in the environment or .env.local; it is
// never printed.

function openaiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const envFile = fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf-8");
    return envFile.match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

const key = openaiKey();
const enabled = Boolean(process.env.LIVE_MODEL_TEST && key);
const openaiModels = MODEL_OPTIONS.filter((option) => isOpenAIModel(option.id)).map((option) => option.id);

describe.skipIf(!enabled)("live OpenAI models", () => {
  it.each(openaiModels)("%s answers a non-streaming request", async (model) => {
    const client = createModelClient({ model, openaiApiKey: key });
    const message = await client.messages.create({
      system: "Reply with one word.",
      messages: [{ role: "user", content: "Reply with the single word: ready" }],
      max_tokens: 2000,
    });
    expect(message.content[0].text.toLowerCase()).toContain("ready");
    expect(message.usage.output_tokens).toBeGreaterThan(0);
    console.log(`  ${model} ok · ${modelRateLabel(model)} · ${message.usage.input_tokens} in / ${message.usage.output_tokens} out`);
  }, 120_000);

  it("streams deltas and resolves finalMessage", async () => {
    const client = createModelClient({ model: "gpt-5.6-luna", openaiApiKey: key });
    const stream = client.messages.stream({
      system: "Reply with one word.",
      messages: [{ role: "user", content: "Reply with the single word: streaming" }],
      max_tokens: 2000,
    });
    let streamed = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta") streamed += event.delta.text;
    }
    const message = await stream.finalMessage();
    expect(streamed.toLowerCase()).toContain("streaming");
    expect(message.content[0].text).toBe(streamed);
  }, 120_000);

  it("resolves finalMessage without iterating, the way the email-thread note calls it", async () => {
    const client = createModelClient({ model: "gpt-5.6-luna", openaiApiKey: key });
    const message = await client.messages.stream({
      system: "Reply with one word.",
      messages: [{ role: "user", content: "Reply with the single word: direct" }],
      max_tokens: 2000,
    }).finalMessage();
    expect(message.content[0].text.toLowerCase()).toContain("direct");
  }, 120_000);
});

describe.skipIf(enabled)("live OpenAI models (skipped)", () => {
  it("explains how to enable the live check", () => {
    expect(openaiModels.length).toBeGreaterThan(0);
  });
});
