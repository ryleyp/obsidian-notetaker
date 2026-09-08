import { describe, expect, it } from "vitest";
import { harvestNotes, harvestSfdcRow } from "./sfdcHarvest";

const NOTE_WITH_ENTRY = {
  date: "2026-08-20",
  title: "Acme EA Admin Sync",
  content: `# 2026-08-20 - Acme EA Admin Sync

## Meeting Notes

- Stuff [T1]

---

## SFDC Activity Entry

**Type:** Strategic Relationship Management
**Subtype:** Escalation / Risk Management
**EA/EP Number(s):** EA 12345

**Summary/Notes:**
Summary: Met with Dana (EA Admin) about the license server outage.
Outcomes: Root cause was an expired cert; Dana renewed it on the call.
Next steps: Send the cert-rotation runbook.

---

## Follow-Up Email

Hi Dana,
`,
};

describe("harvestSfdcRow", () => {
  it("turns a saved SFDC entry into a canonical row without touching a model", () => {
    const row = harvestSfdcRow(NOTE_WITH_ENTRY);
    expect(row).toMatchObject({
      eventDate: "2026-08-20",
      title: "Acme EA Admin Sync",
      type: "Strategic Relationship Management",
      subtype: "Escalation/Risk Management",
      agreement: "EA 12345",
      sourceTitle: "Acme EA Admin Sync",
      origin: "note",
    });
    expect(row.comments).toBe(
      "Summary: Met with Dana (EA Admin) about the license server outage. Outcomes: Root cause was an expired cert; Dana renewed it on the call. Next steps: Send the cert-rotation runbook."
    );
  });

  it("drops the Email prefix from thread titles and blanks 'None on file'", () => {
    const row = harvestSfdcRow({
      ...NOTE_WITH_ENTRY,
      title: "Email - License cleanup",
      content: NOTE_WITH_ENTRY.content.replace("EA 12345", "None on file"),
    });
    expect(row.title).toBe("License cleanup");
    expect(row.agreement).toBe("");
  });

  it("returns null for notes without a usable entry", () => {
    expect(harvestSfdcRow({ date: "2026-08-20", title: "Plain", content: "# Plain\n\n## Meeting Notes\n\n- x" })).toBeNull();
    expect(harvestSfdcRow({ date: "2026-08-20", title: "Empty", content: "## SFDC Activity Entry\n\n**Type:** \n" })).toBeNull();
  });
});

describe("harvestNotes", () => {
  it("separates harvested rows from notes Claude still needs", () => {
    const plain = { date: "2026-08-21", title: "Handwritten", content: "# Handwritten\n\nnotes" };
    const { rows, remaining } = harvestNotes([NOTE_WITH_ENTRY, plain]);
    expect(rows).toHaveLength(1);
    expect(remaining).toEqual([plain]);
  });
});
