import { describe, expect, it } from "vitest";
import {
  cleanActivityTitle,
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
  comments: "Summary: Dana Whitfield, IT Admin Lead, raised the license server outage blocking the Dallas lab. Contribution: CSM escalated to R&D and mapped the certificate dependency. Outcomes: Root cause was an expired certificate, renewed on the call. Next steps: CSM to send the rotation runbook.",
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
      comments: "Summary: Ryley met Dana [T1]   about the cert. Contribution: CSM coordinated the fix. Outcomes: None stated. Next steps: None.",
    }, { ownerNames: ["Ryley"] });
    expect(row.comments).toBe("Summary: CSM met Dana about the cert. Contribution: CSM coordinated the fix.");
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
    const { row } = fixActivityRow({ ...good, comments: "Summary: Met Dana. Contribution: CSM advised on the cert. Outcomes: Cert renewed. Next steps: None." });
    expect(row.comments).toBe("Summary: Met Dana. Contribution: CSM advised on the cert. Outcomes: Cert renewed.");
  });

  it("reports no change for a clean row", () => {
    expect(fixActivityRow(good).changed).toBe(false);
  });
});

describe("helpers", () => {
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
  it("wants the four labelled parts", () => {
    expect(codes({ ...good, comments: "Met Dana about the outage and fixed it." })).toContain("structure");
    expect(codes(good)).not.toContain("structure");
  });

  it("wants the CSM's own contribution, named with a real verb", () => {
    const noContribution = { ...good, comments: "Summary: Met Dana. Outcomes: Cert renewed. Next steps: None." };
    expect(codes(noContribution)).toContain("no-contribution");

    const weak = { ...good, comments: "Summary: Met Dana. Contribution: CSM was in the meeting. Outcomes: Cert renewed. Next steps: None." };
    expect(codes(weak)).toContain("weak-contribution");

    // An honest "none" is a valid contribution line, not a defect.
    const honest = { ...good, comments: "Summary: FAE demoed to the RF team. Contribution: None beyond attendance. Outcomes: Exposure across the RF community. Next steps: None." };
    expect(codes(honest)).not.toContain("weak-contribution");
    expect(codes(good)).not.toContain("no-contribution");
  });

  it("flags revenue causation the source almost never supports", () => {
    expect(codes({ ...good, comments: good.comments + " The session drove renewal of the agreement." })).toContain("revenue-claim");
    expect(codes(good)).not.toContain("revenue-claim");
  });

  it("wants somebody named or given a role", () => {
    const anonymous = { ...good, comments: "Summary: Reviewed the outage with the customer. Contribution: CSM escalated it. Outcomes: Resolved. Next steps: None." };
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
