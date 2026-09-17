import { describe, expect, it } from "vitest";
import { reviewActivityPortfolio } from "./activityPortfolio";

const row = (over = {}) => ({
  eventDate: "2026-08-12",
  title: "Acme EA Admin Sync - License Server",
  type: "Strategic Relationship Management",
  subtype: "EA Admin Sync",
  agreement: "EA 15552",
  comments: "Summary: x. Contribution: CSM escalated. Outcomes: y. Next steps: None.",
  ...over,
});

const codes = (rows, options) => reviewActivityPortfolio(rows, options).findings.map((f) => f.code);

// Six rows spread across three types and three months: a healthy shape.
const healthy = [
  row({ eventDate: "2026-07-05", title: "Acme RF User Group - July", type: "User Groups", subtype: "User Group" }),
  row({ eventDate: "2026-07-20", title: "Acme Admin Sync - Licensing" }),
  row({ eventDate: "2026-08-04", title: "Acme Case Study - SystemLink", type: "Value Realization & Success Stories", subtype: "Case Study" }),
  row({ eventDate: "2026-08-18", title: "Acme Admin Sync - Server Move" }),
  row({ eventDate: "2026-09-02", title: "Acme Training Plan - Core 1", type: "Entitlement Awareness & Promotion", subtype: "Training/Support Plans" }),
  row({ eventDate: "2026-09-10", title: "Acme Sponsor Sync - Adoption" }),
];

describe("reviewActivityPortfolio", () => {
  it("says nothing about a healthy report", () => {
    expect(codes(healthy, { rangeStart: "2026-07-01", rangeEnd: "2026-09-14" })).toEqual([]);
  });

  it("counts the mix", () => {
    const { stats } = reviewActivityPortfolio(healthy);
    expect(stats.total).toBe(6);
    expect(stats.customerFacing).toBe(6);
    expect(stats.byType[0].count).toBe(3);
  });

  it("flags a report that is mostly internal meetings", () => {
    const internal = Array.from({ length: 4 }, (_, i) =>
      row({ eventDate: `2026-08-0${i + 1}`, title: `Acme Interlock ${i}`, type: "Internal Alignment & Collaboration", subtype: "Account Planning" }));
    expect(codes([...internal, row()])).toContain("internal-heavy");
  });

  it("flags concentration in one category", () => {
    const same = Array.from({ length: 5 }, (_, i) => row({ eventDate: `2026-08-0${i + 1}`, title: `Acme Sync ${i}` }));
    expect(codes([...same, row({ type: "User Groups", subtype: "User Group", title: "Acme UG" })])).toContain("concentrated");
  });

  it("flags repeated \"Other\" as a taxonomy gap", () => {
    const others = [row({ type: "Other", subtype: "Other", title: "Acme Misc 1" }), row({ type: "Other", subtype: "Other", title: "Acme Misc 2" })];
    expect(codes([...others, ...healthy.slice(0, 3)])).toContain("other-heavy");
  });

  it("catches same-day duplicate titles but not a recurring sync", () => {
    const dupes = [row(), row()];
    expect(codes(dupes)).toContain("duplicates");
    // The same monthly sync on two different dates is two real occurrences.
    expect(codes([row({ eventDate: "2026-07-12" }), row({ eventDate: "2026-08-12" })])).not.toContain("duplicates");
  });

  it("flags inconsistent agreement identifiers and invalid classifications", () => {
    expect(codes([row(), row({ title: "Acme Other Sync", agreement: "" })])).toContain("missing-agreement");
    expect(codes([row({ subtype: "Invented" })])).toContain("unclassified");
    // Every row missing it is a different problem (none on file), not fragmentation.
    expect(codes([row({ agreement: "" }), row({ title: "b", agreement: "" })])).not.toContain("missing-agreement");
  });

  it("finds a long quiet stretch inside the reporting range", () => {
    const sparse = [row({ eventDate: "2026-07-02" }), row({ eventDate: "2026-09-10", title: "Acme Later Sync" })];
    expect(codes(sparse, { rangeStart: "2026-07-01", rangeEnd: "2026-09-14" })).toContain("coverage-gap");
  });

  it("handles an empty report", () => {
    expect(reviewActivityPortfolio([])).toEqual({ findings: [], stats: { total: 0, internal: 0, customerFacing: 0, other: 0, byType: [] } });
  });
});
