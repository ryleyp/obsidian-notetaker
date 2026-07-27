const PRICING = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, label: "Haiku" },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, label: "Sonnet" },
  "claude-opus-4-8": { input: 5.0, output: 25.0, label: "Opus" },
};

// Shared model options for report tab pickers.
export const MODEL_OPTIONS = [
  { id: "claude-haiku-4-5", label: "Haiku", sub: "Faster · 200k" },
  { id: "claude-sonnet-4-6", label: "Sonnet", sub: "Best value · 1M" },
  { id: "claude-opus-4-8", label: "Opus", sub: "Smartest · 1M" },
];

const MODEL_CONTEXT = {
  "claude-opus-4-8": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
};

export function contextLimit(model) {
  return MODEL_CONTEXT[model] || 200_000;
}

// Rough pre-flight estimate: ~4 chars/token plus template overhead.
export function estimateUsage(notes, model) {
  const chars = notes.reduce((s, n) => s + (n.content?.length || 0) + (n.title?.length || 0), 0);
  const inputTokens = Math.ceil(chars / 4) + 2500;
  const outputTokens = 2500;
  const p = PRICING[model] || PRICING["claude-sonnet-4-6"];
  const cost = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
  return { inputTokens, outputTokens, cost, label: p.label };
}

export function calcCost(usage, modelId) {
  const p = PRICING[modelId] || PRICING["claude-haiku-4-5"];
  const cost =
    (usage.input_tokens / 1_000_000) * p.input +
    (usage.output_tokens / 1_000_000) * p.output;
  return { cost, label: p.label, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens };
}

export function formatCost(c) {
  if (!c) return null;
  return `$${c.cost.toFixed(4)} · ${c.label} · ${c.input_tokens.toLocaleString()} in / ${c.output_tokens.toLocaleString()} out`;
}
