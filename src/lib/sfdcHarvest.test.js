import { describe, expect, it } from "vitest";
import {
  cleanActivityTitle,
  csmNameToRole,
  harvestNotes,
  harvestSfdcRow,
  isInternalCheckIn,
  normalizeAgreements,
} from "./sfdcHarvest";

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
**EA/EP Number(s):** EA-12345, EP 777

**Summary/Notes:**
Summary: Met with Dana (EA Admin) about the license server outage.
Outcomes: Root cause was an expired cert; Dana renewed it on the call.
Next steps: Ryley to send the cert-rotation runbook; Ryley's follow-up with IT.

---

## Follow-Up Email

Hi Dana,
`,
};

describe("harvestSfdcRow", () => {
  it("turns a saved SFDC entry into a canonical row without touching a model", () => {
    const row = harvestSfdcRow(NOTE_WITH_ENTRY, { ownerNames: ["Ryley"] });
    expect(row).toMatchObject({
      eventDate: "2026-08-20",
      title: "Acme EA Admin Sync",
      type: "Strategic Relationship Management",
      subtype: "Escalation/Risk Management",
      agreement: "EA 12345, EP 777",
      sourceTitle: "Acme EA Admin Sync",
      origin: "note",
      review: false,
    });
    expect(row.comments).toBe(
      "Summary: Met with Dana (EA Admin) about the license server outage. Outcomes: Root cause was an expired cert; Dana renewed it on the call. Next steps: CSM to send the cert-rotation runbook; CSM's follow-up with IT."
    );
  });

  it("cleans mail-style titles and blanks 'None on file'", () => {
    const row = harvestSfdcRow({
      ...NOTE_WITH_ENTRY,
      title: "Email - [EXTERNAL] RE- License cleanup (1)",
      content: NOTE_WITH_ENTRY.content.replace("EA-12345, EP 777", "None on file"),
    });
    expect(row.title).toBe("License cleanup");
    expect(row.agreement).toBe("");
  });

  it("flags rows whose comment carries a redaction mark", () => {
    const row = harvestSfdcRow({
      ...NOTE_WITH_ENTRY,
      content: NOTE_WITH_ENTRY.content.replace("Dana (EA Admin)", "Dana and the █████ team"),
    });
    expect(row.review).toBe(true);
    expect(row.reviewReason).toMatch(/another account/);
  });

  it("returns null for notes without a usable entry", () => {
    expect(harvestSfdcRow({ date: "2026-08-20", title: "Plain", content: "# Plain\n\n## Meeting Notes\n\n- x" })).toBeNull();
    expect(harvestSfdcRow({ date: "2026-08-20", title: "Empty", content: "## SFDC Activity Entry\n\n**Type:** \n" })).toBeNull();
  });
});

describe("title, agreement, and name helpers", () => {
  it("strips dates, email markers, reply prefixes, and duplicate suffixes", () => {
    expect(cleanActivityTitle("2026-07-15 L3 Test SW UG - NI Connect Field Report")).toBe("L3 Test SW UG - NI Connect Field Report");
    expect(cleanActivityTitle("Email - [EXTERNAL] Declined- Acme EA Admin Onboarding")).toBe("Acme EA Admin Onboarding");
    expect(cleanActivityTitle("In person RF Demo Day (1)")).toBe("In person RF Demo Day");
    expect(cleanActivityTitle("FW: RE: [EXTERNAL] Re- INVENTORY REQUEST")).toBe("INVENTORY REQUEST");
  });

  it("normalizes agreement number formatting", () => {
    expect(normalizeAgreements("EA-15552")).toBe("EA 15552");
    expect(normalizeAgreements("ea 15552 and EP#51828")).toBe("EA 15552, EP 51828");
    expect(normalizeAgreements("None on file")).toBe("");
  });

  it("replaces the CSM's name with the CSM role", () => {
    expect(csmNameToRole("Ryley to sync with Moira; Ryley's deck", ["Ryley"])).toBe("CSM to sync with Moira; CSM's deck");
    expect(csmNameToRole("Ryleyville stays", ["Ryley"])).toBe("Ryleyville stays");
  });

  it("recognizes internal check-ins by title", () => {
    expect(isInternalCheckIn({ title: "1x1 with Tiff" })).toBe(true);
    expect(isInternalCheckIn({ title: "CSM Team Meeting" })).toBe(true);
    expect(isInternalCheckIn({ title: "L3 Scorecard Feedback with Tiff" })).toBe(true);
    expect(isInternalCheckIn({ title: "L3H Monthly AM sync" })).toBe(false);
  });
});

describe("harvestNotes", () => {
  it("separates harvested rows, notes Claude still needs, and skipped notes", () => {
    const plain = { date: "2026-08-21", title: "Handwritten", content: "# Handwritten\n\nnotes" };
    const oneOnOne = { ...NOTE_WITH_ENTRY, date: "2026-08-22", title: "1x1 with Tiff" };
    const duplicate = { ...NOTE_WITH_ENTRY, date: "2026-08-19", title: "Acme EA Admin Sync (1)" };
    const { rows, remaining, skipped } = harvestNotes([NOTE_WITH_ENTRY, plain, oneOnOne, duplicate]);
    expect(rows.map((r) => r.title)).toEqual(["Acme EA Admin Sync"]);
    expect(remaining).toEqual([plain]);
    expect(skipped).toEqual([
      { title: "1x1 with Tiff", reason: "internal check-in" },
      { title: "Acme EA Admin Sync (1)", reason: 'duplicate of "Acme EA Admin Sync"' },
    ]);
  });

  it("keeps internal check-ins when asked to", () => {
    const oneOnOne = { ...NOTE_WITH_ENTRY, title: "1x1 with Tiff" };
    const { rows, skipped } = harvestNotes([oneOnOne], { skipInternalCheckIns: false });
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([]);
  });
});
