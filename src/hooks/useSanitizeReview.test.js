import { describe, expect, it } from "vitest";
import { decoratePrivacyEntities } from "./useSanitizeReview";

describe("decoratePrivacyEntities", () => {
  it("adds the first source and a short context snippet to a finding", () => {
    const [finding] = decoratePrivacyEntities(
      [{ text: "Northwind", type: "org" }],
      [
        { label: "Meeting title", text: "Quarterly planning" },
        { label: "Slide 2 filename", text: "Northwind rollout plan.pdf" },
      ]
    );

    expect(finding).toMatchObject({
      text: "Northwind",
      type: "org",
      source: "Slide 2 filename",
    });
    expect(finding.context).toContain("Northwind rollout plan.pdf");
  });

  it("does not alter a finding when its source cannot be located", () => {
    expect(decoratePrivacyEntities(
      [{ text: "Dana", type: "person" }],
      [{ label: "Transcript", text: "Speaker 1 joined" }]
    )).toEqual([{ text: "Dana", type: "person" }]);
  });
});
