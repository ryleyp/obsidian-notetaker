import { describe, expect, it } from "vitest";
import { buildStakeholderMapPrompt } from "./route";

describe("buildStakeholderMapPrompt", () => {
  it("requires source-by-source stakeholder and site mapping", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "2026-07-10",
        title: "Planning Sync",
        content: "Jordan discussed the Dallas lab rollout.",
        source: "obsidian",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", []);

    expect(prompt).toContain("# Acme Customer & Site Mapping");
    expect(prompt).toContain("## Customer Stakeholders");
    expect(prompt).toContain("## Site / Lab / Location Map");
    expect(prompt).toContain("Analyze the provided Obsidian meeting notes");
    expect(prompt).toContain("Every mapped person and every mapped site must list every provided source");
    expect(prompt).toContain("2026-07-10 - Planning Sync");
    expect(prompt).not.toContain("notes and transcripts");
    expect(prompt).not.toContain("transcripts, and cross-folder notes");
  });

  it("labels all-history maps without quarterly wording", () => {
    const prompt = buildStakeholderMapPrompt([
      {
        date: "",
        title: "Undated Contact Notes",
        content: "Dana owns the lab.",
        source: "obsidian",
        sourceLabel: "Acme",
      },
    ], "2026-07-23", "Acme", [], "all");

    expect(prompt).toContain("Analyze the provided Obsidian meeting notes from all available history");
    expect(prompt).toContain("# Acme Customer & Site Mapping - All Available History");
    expect(prompt).toContain("- **Date range:** All Available History");
    expect(prompt).toContain("### undated - Undated Contact Notes");
    expect(prompt).toContain("No stakeholder or site details noted in the provided source set.");
    expect(prompt).not.toContain("this quarter");
  });
});
