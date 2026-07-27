const PRICING = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, label: "Haiku" },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, label: "Sonnet" },
};

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
