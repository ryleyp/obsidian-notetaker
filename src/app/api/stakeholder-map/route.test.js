import { describe, expect, it } from "vitest";
import { buildStakeholderMapPrompt } from "./route";

describe("buildStakeholderMapPrompt", () => {
  it("requires source-by-source stakeholder and site mapping", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "2026-07-10",
        title: "Planning Sync",
        content: "Jordan discussed the Dallas lab rollout.",
        source: "transcript",
        sourceLabel: "Acme Transcripts",
      },
    ], "2026-07-23", "Acme", []);

    expect(prompt).toContain("# Acme Customer & Site Mapping");
    expect(prompt).toContain("## Customer Stakeholders");
    expect(prompt).toContain("## Site / Lab / Location Map");
    expect(prompt).toContain("Every mapped person and every mapped site must list every provided source");
    expect(prompt).toContain("2026-07-10 - Planning Sync [Acme Transcripts]");
  });
});
