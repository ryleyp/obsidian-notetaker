import { describe, expect, it } from "vitest";
import {
  cleanActivityTitle,
  csmNameToRole,
  fixNoteEntry,
  harvestNotes,
  harvestSfdcRow,
  isInternalCheckIn,
  lintNoteEntry,
  normalizeAgreements,
  reportableField,
} from "./sfdcHarvest";
import { parseGoalContributions } from "./goals";

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

const NOTE_WITH_NEW_FIELDS = {
  date: "2026-09-02",
  title: "2026-09-02 - Email - RE: license question",
  content: `# 2026-09-02 - Email - RE: license question

## SFDC Activity Entry

**Activity Title:** Acme Aerospace EA Admin Sync - License Server
**Type:** Strategic Relationship Management
**Subtype:** EA Admin Sync
**EA/EP Number(s):** EA 15552
**Reportable:** Yes

**Summary/Notes:**
Summary: Dana Whitfield, IT Admin Lead, asked about the license server move [T1].
Contribution: CSM mapped the dependency and advised on sequencing.
Outcomes: None stated.
Next steps: CSM to confirm the server hostname with IT.
`,
};

describe("harvest with the note-time title, reportable flag, and lint", () => {
  it("prefers the entry's own Salesforce title over the file name", () => {
    const row = harvestSfdcRow(NOTE_WITH_NEW_FIELDS);
    expect(row.title).toBe("Acme Aerospace EA Admin Sync - License Server");
    expect(row.sourceTitle).toBe(NOTE_WITH_NEW_FIELDS.title);
  });

  it("applies the safe fixes and reports the rest", () => {
    const row = harvestSfdcRow(NOTE_WITH_NEW_FIELDS);
    // Marker stripped, empty outcome fragment stripped, real next step kept.
    expect(row.comments).toBe("Summary: Dana Whitfield, IT Admin Lead, asked about the license server move. Contribution: CSM mapped the dependency and advised on sequencing. Next steps: CSM to confirm the server hostname with IT.");
    expect(row.lint).toEqual([]);
    expect(row.review).toBe(false);
  });

  it("marks hard problems for review with the reason", () => {
    const row = harvestSfdcRow({
      ...NOTE_WITH_NEW_FIELDS,
      content: NOTE_WITH_NEW_FIELDS.content.replace("Dana Whitfield, IT Admin Lead, asked", "I asked Dana " + "and then ".repeat(60)),
    });
    expect(row.review).toBe(true);
    expect(row.lint.map((i) => i.code)).toEqual(expect.arrayContaining(["over-limit", "first-person"]));
    expect(row.reviewReason).toContain("first person");
  });

  it("reads the reportable flag, defaulting to yes for older notes", () => {
    expect(reportableField("**Reportable:** No — manager 1:1")).toEqual({ reportable: false, reason: "manager 1:1" });
    expect(reportableField("**Reportable:** Yes")).toEqual({ reportable: true, reason: "" });
    expect(reportableField("**Type:** Other")).toEqual({ reportable: true, reason: "" });
  });

  it("keeps non-reportable notes out of the report unless asked", () => {
    const internal = {
      ...NOTE_WITH_NEW_FIELDS,
      title: "Weekly sync with manager",
      content: NOTE_WITH_NEW_FIELDS.content.replace("**Reportable:** Yes", "**Reportable:** No — internal sync, no decision"),
    };
    const { rows, skipped } = harvestNotes([internal]);
    expect(rows).toEqual([]);
    expect(skipped).toEqual([{ title: "Weekly sync with manager", reason: "not reportable — internal sync, no decision" }]);
    expect(harvestNotes([internal], { skipInternalCheckIns: false }).rows).toHaveLength(1);
  });
});

describe("note-level entry check", () => {
  it("lints the entry inside a note and fixes only the safe parts", () => {
    const check = lintNoteEntry(NOTE_WITH_NEW_FIELDS.content, { ownerNames: ["Ryley"] });
    expect(check.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["citations", "no-outcome"]));
    expect(check.fixable).toBe(2);

    const { content, applied } = fixNoteEntry(NOTE_WITH_NEW_FIELDS.content, { ownerNames: ["Ryley"] });
    expect(applied).toEqual(expect.arrayContaining(["citations", "no-outcome"]));
    expect(content).toContain("asked about the license server move.\nContribution: CSM mapped the dependency and advised on sequencing.\nNext steps: CSM to confirm");
    expect(content).not.toContain("[T1]");
    expect(content).not.toContain("Outcomes: None stated");
    // Everything outside the block is untouched.
    expect(content).toContain("**Activity Title:** Acme Aerospace EA Admin Sync - License Server");
    expect(content.startsWith("# 2026-09-02 - Email - RE: license question")).toBe(true);
    expect(lintNoteEntry(content).issues).toEqual([]);
  });

  it("returns nothing for a note without an entry and leaves it unchanged", () => {
    expect(lintNoteEntry("# Plain\n\n## Meeting Notes\n\n- x")).toBeNull();
    expect(fixNoteEntry("# Plain").content).toBe("# Plain");
  });

  it("does not disturb the goal contributions section beside the entry", () => {
    const withGoals = NOTE_WITH_NEW_FIELDS.content.replace("## SFDC Activity Entry", "## Goal Contributions\n\n- **Goal:** Case studies | **Contribution:** Kicked it off\n\n---\n\n## SFDC Activity Entry");
    const { content } = fixNoteEntry(withGoals);
    expect(parseGoalContributions(content)).toHaveLength(1);
  });
});
