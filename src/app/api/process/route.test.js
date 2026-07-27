import { describe, expect, it } from "vitest";
import { buildPrompt } from "./route";

describe("buildPrompt", () => {
  it("includes user and site callouts before action items", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");

    expect(prompt).toContain("## User-Level Callouts");
    expect(prompt).toContain("## Site-Level Callouts");
    expect(prompt).toContain("specific customer users");
    expect(prompt).toContain("specific customer sites");
    expect(prompt.indexOf("## User-Level Callouts")).toBeLessThan(prompt.indexOf("## Action Items"));
    expect(prompt.indexOf("## Site-Level Callouts")).toBeLessThan(prompt.indexOf("## Action Items"));
  });

  it("caps the existing summary and notes sections without adding outcomes", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");

    expect(prompt).toContain("Executive Summary and Meeting Notes sections together must be 120 words or fewer");
    expect(prompt).toContain("This section and Executive Summary together must be 120 words or fewer");
    expect(prompt).not.toContain("## Outcomes");
  });

  it("adds source citation and workflow instructions", () => {
    const prompt = buildPrompt(
      "Jordan discussed the Dallas lab rollout.",
      "Planning Sync",
      [],
      "Raw note: Priya owns the next step.",
      {
        noteTemplateId: "technical-deep-dive",
        recipeId: "adoption-blockers",
        customTemplateInstructions: "Add implementation risks.",
      }
    );

    expect(prompt).toContain("[T1] Transcript");
    expect(prompt).toContain("[N1] Raw notes");
    expect(prompt).toContain("SOURCE CITATION RULES");
    expect(prompt).toContain("Selected note template: Technical deep dive");
    expect(prompt).toContain("Selected recipe: Adoption blockers");
    expect(prompt).toContain("Add implementation risks.");
  });
});
