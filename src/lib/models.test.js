
describe("defaultReviewModel", () => {
  const both = { apiKey: "a", openaiApiKey: "o" };

  it("prefers the other provider when its key is configured", () => {
    expect(defaultReviewModel("claude-opus-5", both)).toBe("gpt-5.6-terra");
    expect(defaultReviewModel("gpt-6-astra", both)).toBe("claude-sonnet-5");
  });

  it("stays in-provider when the other provider has no key, so the review can actually run", () => {
    expect(defaultReviewModel("claude-opus-5", { apiKey: "a" })).toBe("claude-sonnet-5");
    expect(defaultReviewModel("claude-sonnet-5", { apiKey: "a" })).toBe("claude-opus-5");
    expect(defaultReviewModel("gpt-6-astra", { openaiApiKey: "o" })).toBe("gpt-5.6-sol");
    expect(defaultReviewModel("gpt-5.6-terra", { openaiApiKey: "o" })).toBe("gpt-5.6-sol");
  });

  it("keeps the cross-provider default when no key is visible client-side", () => {
    // Keys may still be set server-side in .env.local.
    expect(defaultReviewModel("claude-opus-5", {})).toBe("gpt-5.6-terra");
    expect(defaultReviewModel("gpt-6-astra", {})).toBe("claude-sonnet-5");
  });
});

describe("missingProviderKey", () => {
  it("reports only the selected model's own provider", () => {
    expect(missingProviderKey("gpt-6-astra", { apiKey: "a" })).toBe(true);
    expect(missingProviderKey("gpt-6-astra", { openaiApiKey: "o" })).toBe(false);
    expect(missingProviderKey("claude-opus-5", { openaiApiKey: "o" })).toBe(true);
    expect(missingProviderKey("claude-opus-5", { apiKey: "a" })).toBe(false);
  });

  it("never flags auto routing, which picks a model from whatever is configured", () => {
    expect(missingProviderKey("auto", { apiKey: "a" })).toBe(false);
    expect(missingProviderKey("", {})).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  defaultReviewModel,
  missingProviderKey,
  modelDisplayName,
  budgetChars,
  calcCost,
  contextLimit,
  estimateUsage,
  firstTextBlock,
  maxOutputTokens,
  modelRateLabel,
  resolveAutoModel,
} from "@/lib/models";

describe("firstTextBlock", () => {
  it("returns the text of a plain text response", () => {
    expect(firstTextBlock({ content: [{ type: "text", text: "hello" }] })).toBe("hello");
  });

  // The regression this function exists for: on the Claude 5 family thinking
  // is on by default, so content[0] is a thinking block. Index-based access
  // yielded undefined and every caller's `|| ""` fallback turned that into
  // silently empty output rather than a visible failure.
  it("skips a leading thinking block", () => {
    const message = {
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "the real answer" },
      ],
    };
    expect(firstTextBlock(message)).toBe("the real answer");
  });

  it("skips tool_use blocks", () => {
    const message = {
      content: [
        { type: "tool_use", id: "t1", name: "x", input: {} },
        { type: "text", text: "after the tool" },
      ],
    };
    expect(firstTextBlock(message)).toBe("after the tool");
  });

  it("returns empty string when there is no text block", () => {
    expect(firstTextBlock({ content: [{ type: "thinking", thinking: "" }] })).toBe("");
    expect(firstTextBlock({ content: [] })).toBe("");
    expect(firstTextBlock({})).toBe("");
    expect(firstTextBlock(null)).toBe("");
  });

  it("ignores a text block whose text is not a string", () => {
    expect(firstTextBlock({ content: [{ type: "text" }, { type: "text", text: "ok" }] })).toBe("ok");
  });
});

describe("model capability lookups", () => {
  it("exposes the current Claude 5 defaults", () => {
    expect(DEFAULT_MODEL).toBe("claude-opus-5");
    expect(contextLimit("claude-opus-5")).toBe(1_000_000);
    expect(contextLimit("claude-sonnet-5")).toBe(1_000_000);
    expect(contextLimit("claude-haiku-4-5")).toBe(200_000);
  });

  it("still resolves superseded models so old saved settings keep working", () => {
    expect(contextLimit("claude-sonnet-4-6")).toBe(1_000_000);
    expect(maxOutputTokens("claude-opus-4-8")).toBe(32_000);
  });

  it("falls back conservatively for an unknown model", () => {
    expect(contextLimit("claude-does-not-exist")).toBe(200_000);
    expect(maxOutputTokens("claude-does-not-exist")).toBe(32_000);
  });

  it("offers only current models in the picker", () => {
    expect(MODEL_OPTIONS.map((o) => o.id)).toEqual([
      "gpt-6-astra",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "claude-haiku-4-5",
      "claude-sonnet-5",
      "claude-opus-5",
    ]);
  });

  it("still resolves a retired model saved in settings without offering it", () => {
    expect(MODEL_OPTIONS.some((o) => o.id === "gpt-5.4")).toBe(false);
    expect(modelDisplayName("gpt-5.4")).toBe("GPT-5.4");
    expect(contextLimit("gpt-5.4")).toBe(1_050_000);
  });

  it("shows the same input/output rate breakdown for OpenAI and Claude models", () => {
    expect(modelRateLabel("gpt-5.6-terra")).toBe("$2 in / $12 out per 1M");
    expect(modelRateLabel("claude-sonnet-5")).toBe("$3 in / $15 out per 1M");
  });

  it("routes Auto to fast or full models using an available provider", () => {
    expect(resolveAutoModel("auto", { openaiApiKey: "key", task: "fast" })).toBe("gpt-5.6-luna");
    expect(resolveAutoModel("auto", { openaiApiKey: "key" })).toBe("gpt-5.6-terra");
    expect(resolveAutoModel("auto", { apiKey: "key", task: "fast" })).toBe("claude-haiku-4-5");
    expect(resolveAutoModel("auto", { apiKey: "key" })).toBe("claude-sonnet-5");
  });
});

describe("budgetChars", () => {
  it("leaves room for output and template overhead", () => {
    const budget = budgetChars("claude-sonnet-5");
    const ceiling = (contextLimit("claude-sonnet-5") - maxOutputTokens("claude-sonnet-5")) * 4;
    expect(budget).toBeGreaterThan(0);
    expect(budget).toBeLessThan(ceiling);
  });

  it("honours a caller-supplied overhead", () => {
    expect(budgetChars("claude-sonnet-5", 10_000)).toBeGreaterThan(budgetChars("claude-sonnet-5", 12_000));
  });

  it("never returns a negative budget", () => {
    expect(budgetChars("claude-haiku-4-5", 10_000_000)).toBe(0);
  });
});

describe("cost helpers", () => {
  it("prices a response from the model table", () => {
    const cost = calcCost({ input_tokens: 1_000_000, output_tokens: 1_000_000 }, "claude-opus-5");
    expect(cost.cost).toBeCloseTo(30.0);
    expect(cost.label).toBe("Opus");
  });

  it("scales the estimate with the caller's expected output length", () => {
    const notes = [{ title: "t", content: "x".repeat(4000) }];
    const short = estimateUsage(notes, "claude-sonnet-5");
    const long = estimateUsage(notes, "claude-sonnet-5", 4000);
    expect(long.cost).toBeGreaterThan(short.cost);
    expect(long.inputTokens).toBe(short.inputTokens);
  });
});
