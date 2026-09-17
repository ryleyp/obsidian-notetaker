import { describe, expect, it } from "vitest";
import {
  cleanActivityTitle,
  duplicateSourceNotes,
  csmNameToRole,
  describeIssues,
  fixActivityRow,
  lintActivityRow,
  lintSummary,
  wordCount,
} from "./activityLint";

const good = {
  eventDate: "2026-08-12",
  title: "Acme Aerospace EA Admin Sync - License Server Outage",
  type: "Strategic Relationship Management",
  subtype: "EA Admin Sync",
  comments: "Summary: Dana Whitfield, IT Admin Lead, raised the license server outage blocking the Dallas lab; CSM escalated to R&D and mapped the certificate dependency. Outcomes: Root cause was an expired certificate, renewed on the call. Next steps: CSM to send the rotation runbook.",
  agreement: "EA 15552",
};

const codes = (row, options) => lintActivityRow(row, options).map((i) => i.code);

describe("lintActivityRow", () => {
  it("passes a clean row", () => {
    expect(lintActivityRow(good)).toEqual([]);
  });

  it("catches what Salesforce itself rejects", () => {
    expect(codes({ ...good, comments: "x ".repeat(121) })).toContain("over-limit");
    expect(codes({ ...good, comments: "y".repeat(801) })).toContain("over-limit");
    expect(codes({ ...good, eventDate: "Aug 12" })).toContain("date");
    expect(codes({ ...good, subtype: "Escalation / Risk Management" })).toContain("taxonomy");
    expect(codes({ ...good, title: "t".repeat(201) })).toContain("title-length");
    expect(codes({ ...good, comments: "" })).toContain("empty-comment");
  });

  it("catches what makes a row read wrong to someone else", () => {
    expect(codes({ ...good, comments: "I met with Dana and we agreed on the plan." })).toContain("first-person");
    expect(codes({ ...good, comments: "Ryley met with Dana." }, { ownerNames: ["Ryley"] })).toContain("csm-name");
    expect(codes({ ...good, comments: "Reviewed the plan [T1] with Dana [N2]." })).toContain("citations");
    expect(codes({ ...good, comments: "CSM attended the FAE-led demo of TestStand." })).toContain("passive-attendance");
    expect(codes({ ...good, comments: "Agreed to leverage the EA and circle back on synergies." })).toContain("jargon");
    expect(codes({ ...good, comments: "Session with [Name] at the [Region] site." })).toContain("placeholder");
    expect(codes({ ...good, comments: "Summary: Met Dana. Outcomes: None stated. Next steps: None." })).toContain("no-outcome");
    expect(codes({ ...good, comments: "Dana and the █████ team met." })).toContain("redacted");
  });

  it("does not mistake ordinary words for first person or placeholders", () => {
    expect(codes({ ...good, comments: "Dana asked about US export controls and the [x] option in NI Package Manager." })).not.toContain("first-person");
    expect(codes({ ...good, comments: "Attendees: TBD. Region: AMER. Outcome: adoption momentum.", type: "User Groups", subtype: "User Group" })).not.toContain("placeholder");
  });

  it("expects the user-group comment format only on user-group rows", () => {
    const ug = { ...good, type: "User Groups", subtype: "Demo Days" };
    expect(codes(ug)).toContain("group-format");
    expect(codes({ ...ug, comments: "RF User Group — Region: AMER, Attendees: 22. FAE demoed InstrumentStudio. Outcome: adoption momentum." })).not.toContain("group-format");
    expect(codes(good)).not.toContain("group-format");
  });

  it("flags a missing agreement only when the account has one on file", () => {
    expect(codes({ ...good, agreement: "" })).not.toContain("missing-agreement");
    expect(codes({ ...good, agreement: "" }, { agreementsOnFile: true })).toContain("missing-agreement");
  });

  it("lists hard issues before soft ones", () => {
    const issues = lintActivityRow({ ...good, comments: "I reviewed the plan [T1] " + "x ".repeat(120) });
    expect(issues[0].severity).toBe("hard");
    expect(issues[issues.length - 1].severity).toBe("soft");
  });
});

describe("fixActivityRow", () => {
  it("applies only the fixes that cannot change meaning", () => {
    const { row, applied } = fixActivityRow({
      ...good,
      title: "2026-08-12 - Email - RE: Acme EA Admin Sync (1)",
      comments: "Summary: Ryley met Dana [T1]   about the cert and coordinated the fix. Outcomes: None stated. Next steps: None.",
    }, { ownerNames: ["Ryley"] });
    // With both empty fragments gone, a lone "Summary:" label labels nothing.
    expect(row.comments).toBe("CSM met Dana about the cert and coordinated the fix.");
    expect(row.title).toBe("Acme EA Admin Sync");
    expect(applied).toEqual(expect.arrayContaining(["citations", "csm-name", "no-outcome", "title-noise"]));
  });

  it("leaves judgement calls alone", () => {
    const long = { ...good, comments: "I " + "word ".repeat(130) };
    const { row } = fixActivityRow(long);
    expect(row.comments.startsWith("I ")).toBe(true);
    expect(lintActivityRow(row).map((i) => i.code)).toEqual(expect.arrayContaining(["over-limit", "first-person"]));
  });

  it("keeps the labels when the outcome is real", () => {
    const { row } = fixActivityRow({ ...good, comments: "Summary: Met Dana and advised on the cert. Outcomes: Cert renewed. Next steps: None." });
    expect(row.comments).toBe("Summary: Met Dana and advised on the cert. Outcomes: Cert renewed.");
  });

  it("reports no change for a clean row", () => {
    expect(fixActivityRow(good).changed).toBe(false);
  });
});

describe("helpers", () => {
  it("does not offer to fix a row already filed in Salesforce", () => {
    const dirty = { ...good, comments: good.comments + " [T1]" };
    expect(lintSummary([dirty]).fixable).toBe(1);
    // Still reported, just not offered as a bulk fix.
    const filed = lintSummary([{ ...dirty, filed: true }]);
    expect(filed.fixable).toBe(0);
    expect(filed.soft).toBe(1);
  });

  it("summarises issues across rows", () => {
    const rows = [good, { ...good, comments: good.comments + " [T1]" }, { ...good, eventDate: "" }];
    expect(lintSummary(rows)).toEqual({ hard: 1, soft: 1, fixable: 1, rowsWithIssues: 2 });
  });

  it("describes issues for a prompt", () => {
    const text = describeIssues(lintActivityRow({ ...good, comments: good.comments.replace("Dana Whitfield, IT Admin Lead, raised", "I raised") }));
    expect(text).toContain("MUST FIX");
    expect(text).toContain("first person");
  });

  it("keeps the title and name helpers working", () => {
    expect(cleanActivityTitle("FW: RE: [EXTERNAL] Re- INVENTORY REQUEST")).toBe("INVENTORY REQUEST");
    expect(csmNameToRole("Ryley to sync; Ryley's deck", ["Ryley"])).toBe("CSM to sync; CSM's deck");
    expect(wordCount("  a  b c ")).toBe(3);
  });
});

describe("the reporting standard the account team reviews against", () => {
  it("wants the three labelled parts", () => {
    expect(codes({ ...good, comments: "Met Dana about the outage and fixed it." })).toContain("structure");
    expect(codes(good)).not.toContain("structure");
  });

  it("nudges when nothing says what the CSM did", () => {
    const silent = { ...good, comments: "Summary: Met Dana Whitfield, IT Admin Lead. Outcomes: Cert renewed. Next steps: None." };
    expect(codes(silent)).toContain("no-contribution");
    // The work belongs in the Summary now, not behind its own label.
    expect(codes(good)).not.toContain("no-contribution");
  });

  it("still reads an entry written while the format carried a Contribution label", () => {
    const older = { ...good, comments: "Summary: Dana Whitfield, IT Admin Lead, raised the outage. Contribution: CSM escalated to R&D. Outcomes: Cert renewed. Next steps: None." };
    expect(codes(older)).not.toContain("structure");
    expect(codes(older)).not.toContain("no-contribution");
  });

  it("flags revenue causation the source almost never supports", () => {
    expect(codes({ ...good, comments: good.comments + " The session drove renewal of the agreement." })).toContain("revenue-claim");
    expect(codes(good)).not.toContain("revenue-claim");
  });

  it("wants somebody named or given a role", () => {
    const anonymous = { ...good, comments: "Summary: Reviewed the outage with the customer and escalated it. Outcomes: Resolved. Next steps: None." };
    expect(codes(anonymous)).toContain("no-participants");
    expect(codes(good)).not.toContain("no-participants");
  });

  it("wants a title that carries the purpose, not just the meeting", () => {
    expect(codes({ ...good, title: "Sponsor sync" })).toContain("weak-title");
    expect(codes({ ...good, title: "Sync" })).toContain("weak-title");
    expect(codes(good)).not.toContain("weak-title");
  });

  it("asks whether \"Other\" was really the best category", () => {
    expect(codes({ ...good, type: "Other", subtype: "Other" })).toContain("other-category");
    expect(codes(good)).not.toContain("other-category");
  });
});

describe("status accuracy", () => {
  const today = new Date("2026-09-17T12:00:00");
  const at = (row) => lintActivityRow(row, { today }).map((i) => i.code);

  it("catches a record still planned after its date", () => {
    expect(at({ ...good, status: "Planned", eventDate: "2026-08-12" })).toContain("stale-planned");
    expect(at({ ...good, status: "Planned", eventDate: "2026-11-01", comments: "Summary: QBR with Dana Whitfield, IT Admin Lead, booked; CSM coordinated the agenda. Outcomes: None stated. Next steps: None." })).not.toContain("stale-planned");
    expect(at({ ...good, status: "Completed" })).not.toContain("stale-planned");
  });

  it("refuses an outcome on something that has not happened", () => {
    expect(at({ ...good, status: "Planned", eventDate: "2026-11-01" })).toContain("planned-with-outcome");
  });

  it("wants a reason on a canceled record", () => {
    expect(at({ ...good, status: "Canceled" })).toContain("canceled-no-reason");
    expect(at({ ...good, status: "Canceled", comments: good.comments + " The session was postponed to October." })).not.toContain("canceled-no-reason");
  });

  it("wants the final attendance once an event has happened", () => {
    const group = { ...good, type: "User Groups", subtype: "Demo Days", eventDate: "2026-08-12",
      comments: "Summary: RF User Group — Region: AMER, Attendees: TBD. FAE demoed InstrumentStudio; CSM coordinated the session. Outcomes: Exposure across the RF community." };
    expect(at(group)).toContain("attendance-tbd");
    expect(at({ ...group, eventDate: "2026-11-02", status: "Planned" })).not.toContain("attendance-tbd");
  });
});

describe("one activity per source note", () => {
  const fromNote = (title, sourceTitle) => ({ ...good, title, sourceTitle });

  it("finds the notes that more than one row cites", () => {
    const rows = [
      fromNote("Acme Admin Sync - Licensing", "2026-08-12 - Acme Sync"),
      fromNote("Acme Admin Sync - Escalation", "2026-08-12 - Acme Sync"),
      fromNote("Acme RF User Group", "2026-08-20 - RF UG"),
      { ...good, sourceTitle: "" },
      { ...good, sourceTitle: "" },
    ];
    // Spacing and case do not make two citations different; a missing source
    // is not a duplicate of another missing source.
    expect(duplicateSourceNotes(rows)).toEqual(new Set(["2026-08-12 - acme sync"]));
  });

  it("flags every row that shares a source note", () => {
    const rows = [
      fromNote("Acme Admin Sync - Licensing", "2026-08-12 - Acme Sync"),
      fromNote("Acme Admin Sync - Escalation", "2026-08-12  -  ACME SYNC"),
      fromNote("Acme RF User Group - August", "2026-08-20 - RF UG"),
    ];
    const duplicateSources = duplicateSourceNotes(rows);
    expect(lintActivityRow(rows[0], { duplicateSources }).map((i) => i.code)).toContain("split-note");
    expect(lintActivityRow(rows[1], { duplicateSources }).map((i) => i.code)).toContain("split-note");
    expect(lintActivityRow(rows[2], { duplicateSources }).map((i) => i.code)).not.toContain("split-note");
  });

  it("says nothing when every note produced one activity", () => {
    const rows = [fromNote("Acme Admin Sync - License Server", "a"), fromNote("Acme RF User Group - August", "b")];
    const duplicateSources = duplicateSourceNotes(rows);
    expect(duplicateSources.size).toBe(0);
    expect(lintActivityRow(rows[0], { duplicateSources })).toEqual([]);
  });
});
