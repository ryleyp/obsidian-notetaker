import { describe, expect, it } from "vitest";
import { harvestSfdcRow } from "@/lib/sfdcHarvest";

const entry = (titleLines) => `# 2026-09-02 - Email - RE: license question

## SFDC Activity Entry

${titleLines}
**Type:** Strategic Relationship Management
**Subtype:** EA Admin Sync
**EA/EP Number(s):** EA 15552
**Reportable:** Yes

**Summary/Notes:**
Summary: Dana Voss, IT Admin Lead, asked about the license server move. CSM mapped the dependency.
Outcomes: Move sequenced after the true-up.
Next steps: CSM to confirm the cutover date.
`;

describe("harvested Recommended Title", () => {
  it("lands in improvedTitle, with the note's own name as the title", () => {
    const row = harvestSfdcRow({ date: "2026-09-02", title: "2026-09-02 - Email - RE: license question", content: entry("**Recommended Title:** Acme Aerospace EA Admin Sync - License Server Move\n") });
    expect(row.title).toBe("license question");
    expect(row.improvedTitle).toBe("Acme Aerospace EA Admin Sync - License Server Move");
  });

  it("keeps an older entry's Activity Title as the title and leaves improvedTitle for the title pass", () => {
    const row = harvestSfdcRow({ date: "2026-09-02", title: "2026-09-02 - Email - RE: license question", content: entry("**Activity Title:** License question") });
    expect(row.title).toBe("License question");
    expect(row.improvedTitle).toBe("");
  });
});
