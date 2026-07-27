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
});
