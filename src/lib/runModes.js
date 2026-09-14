export const RUN_MODES = [
  { id: "quick", label: "Quick", description: "Generate once with the selected model.", multiplier: 1 },
  { id: "second-opinion", label: "Second opinion", description: "Generate once, then have the other provider review it.", multiplier: 2 },
  { id: "compare", label: "Compare both", description: "Run independent Claude and ChatGPT drafts from the same sources.", multiplier: 2 },
  { id: "flagged", label: "Review flagged", description: "Generate once, then check only uncertain report items.", multiplier: 1.25 },
];

export function runMode(id) {
  return RUN_MODES.find((mode) => mode.id === id) || RUN_MODES[0];
}
