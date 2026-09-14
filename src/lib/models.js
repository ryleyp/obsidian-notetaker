// Single source of truth for Claude model capabilities, pricing, and response
// parsing. Previously MODEL_CONTEXT lived in four separate files and
// MODEL_MAX_OUTPUT in two, so adding a model meant editing five places and
// getting a different answer in each tab when one was missed.
//
// Adding a model: add one row to MODELS, and one entry to MODEL_OPTIONS if it
// should be user-selectable. Nothing else needs to change.

// context / maxOutput are token counts. input / output are USD per 1M tokens.
//
// maxOutput is deliberately below each model's true ceiling (128K on the
// Claude 5 family, 64K on Haiku 4.5). It sizes streaming requests and is
// subtracted from the context window when budgeting prompt size, so a value
// with real headroom matters more than the theoretical maximum — especially
// on models where thinking is on by default, since max_tokens caps thinking
// and response text together.
const MODELS = {
  // https://developers.openai.com/api/docs/models
  "gpt-6-astra": { context: 1_050_000, maxOutput: 32_000, input: 10.0, output: 50.0, label: "GPT-6 Astra" },
  "gpt-5.6-sol": { context: 1_050_000, maxOutput: 32_000, input: 4.0, output: 20.0, label: "GPT-5.6 Sol" },
  "gpt-5.6-terra": { context: 1_050_000, maxOutput: 32_000, input: 2.0, output: 12.0, label: "GPT-5.6 Terra" },
  "gpt-5.6-luna": { context: 1_050_000, maxOutput: 32_000, input: 0.2, output: 1.2, label: "GPT-5.6 Luna" },

  // Previous OpenAI option, retained for saved settings.
  "gpt-5.4": { context: 1_050_000, maxOutput: 32_000, input: 2.5, output: 15.0, label: "GPT-5.4" },
  "claude-opus-5": { context: 1_000_000, maxOutput: 64_000, input: 5.0, output: 25.0, label: "Opus" },
  "claude-sonnet-5": { context: 1_000_000, maxOutput: 64_000, input: 3.0, output: 15.0, label: "Sonnet" },
  "claude-haiku-4-5": { context: 200_000, maxOutput: 32_000, input: 1.0, output: 5.0, label: "Haiku" },

  // Superseded, kept so settings saved before the Claude 5 upgrade still
  // resolve to correct budgets instead of silently falling back to defaults.
  "claude-opus-4-8": { context: 1_000_000, maxOutput: 32_000, input: 5.0, output: 25.0, label: "Opus 4.8" },
  "claude-opus-4-7": { context: 1_000_000, maxOutput: 32_000, input: 5.0, output: 25.0, label: "Opus 4.7" },
  "claude-opus-4-6": { context: 1_000_000, maxOutput: 32_000, input: 5.0, output: 25.0, label: "Opus 4.6" },
  "claude-opus-4-5": { context: 1_000_000, maxOutput: 32_000, input: 5.0, output: 25.0, label: "Opus 4.5" },
  "claude-sonnet-4-6": { context: 1_000_000, maxOutput: 16_000, input: 3.0, output: 15.0, label: "Sonnet 4.6" },
};

export const DEFAULT_MODEL = "claude-opus-5";
export const OPENAI_MODEL = "gpt-5.6-terra";
export const AUTO_MODEL = "auto";
export const isOpenAIModel = (model) => typeof model === "string" && model.startsWith("gpt-");
export const providerLabel = (model) => model === AUTO_MODEL ? "automatic model routing" : isOpenAIModel(model) ? "OpenAI (ChatGPT)" : "Anthropic (Claude)";
export const alternateModel = (model) => isOpenAIModel(model) || model === AUTO_MODEL ? "claude-sonnet-5" : OPENAI_MODEL;
export const FAST_MODEL = "claude-haiku-4-5";

export function resolveAutoModel(model, { apiKey, openaiApiKey, task = "generation" } = {}) {
  if (model !== AUTO_MODEL) return model || DEFAULT_MODEL;
  if (openaiApiKey) return task === "fast" ? "gpt-5.6-luna" : OPENAI_MODEL;
  if (apiKey) return task === "fast" ? FAST_MODEL : "claude-sonnet-5";
  return OPENAI_MODEL;
}

// Unknown models fall back to the most conservative real model so we never
// over-fill a prompt or under-report a cost for something we don't recognize.
const FALLBACK = MODELS["claude-haiku-4-5"];

function spec(model) {
  if (model === AUTO_MODEL) return MODELS[OPENAI_MODEL];
  return MODELS[model] || FALLBACK;
}

// Shared model options for the report tab pickers.
export const MODEL_OPTIONS = [
  { id: "gpt-6-astra", label: "GPT-6 Astra", provider: "ChatGPT", sub: "Most capable · 1.05M" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "ChatGPT", sub: "Flagship · 1.05M" },
  { id: OPENAI_MODEL, label: "GPT-5.6 Terra", provider: "ChatGPT", sub: "Balanced · 1.05M" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "ChatGPT", sub: "Lowest cost · 1.05M" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "ChatGPT", sub: "Previous · 1.05M" },
  { id: "claude-haiku-4-5", label: "Haiku", provider: "Claude", sub: "Faster · 200k" },
  { id: "claude-sonnet-5", label: "Sonnet", provider: "Claude", sub: "Best value · 1M" },
  { id: "claude-opus-5", label: "Opus", provider: "Claude", sub: "Smartest · 1M" },
];

const dollars = (value) => value < 1 ? value.toFixed(2) : Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
export function modelRateLabel(model) {
  if (model === AUTO_MODEL) return "Varies by routed model";
  const p = spec(model);
  return `$${dollars(p.input)} in / $${dollars(p.output)} out per 1M`;
}

export function modelDisplayName(model) {
  if (model === AUTO_MODEL) return "Auto";
  return spec(model).label;
}

export function contextLimit(model) {
  return spec(model).context;
}

export function maxOutputTokens(model) {
  return spec(model).maxOutput;
}

// Char budget for note content: context minus max output minus template
// overhead, in tokens, times ~4 chars/token, with a 5% safety margin.
export function budgetChars(model, overheadTokens = 12_000) {
  const usableTokens = Math.floor((contextLimit(model) - maxOutputTokens(model) - overheadTokens) * 0.95);
  return Math.max(0, usableTokens * 4);
}

// The first text block of a response — NOT content[0].
//
// On models where thinking is enabled (on by default across the Claude 5
// family), content[0] is a thinking block and content[0].text is undefined,
// so index-based access silently yields empty output rather than failing.
export function firstTextBlock(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return "";
  for (const block of blocks) {
    if (block?.type === "text" && typeof block.text === "string") return block.text;
  }
  return "";
}

// Rough pre-flight estimate: ~4 chars/token plus template overhead.
// outputTokens is caller-supplied because expected output length varies by
// report type (a stakeholder map runs longer than a note summary).
export function estimateUsage(notes, model, outputTokens = 2500) {
  const chars = notes.reduce((s, n) => s + (n.content?.length || 0) + (n.title?.length || 0), 0);
  const inputTokens = Math.ceil(chars / 4) + 2500;
  const p = spec(model);
  const longContext = model === "gpt-5.4" && inputTokens > 272_000;
  const cost = (inputTokens / 1e6) * p.input * (longContext ? 2 : 1) + (outputTokens / 1e6) * p.output * (longContext ? 1.5 : 1);
  return { inputTokens, outputTokens, cost, label: p.label };
}

export function calcCost(usage, modelId) {
  const p = spec(modelId);
  const longContext = modelId === "gpt-5.4" && usage.input_tokens > 272_000;
  const cost =
    (usage.input_tokens / 1_000_000) * p.input * (longContext ? 2 : 1) +
    (usage.output_tokens / 1_000_000) * p.output * (longContext ? 1.5 : 1);
  return { cost, label: p.label, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
}

export function formatCost(c) {
  if (!c) return null;
  return `$${c.cost.toFixed(4)} · ${c.label} · ${c.input_tokens.toLocaleString()} in / ${c.output_tokens.toLocaleString()} out`;
}
