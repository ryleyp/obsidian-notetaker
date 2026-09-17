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

// Six rows across three types and three months, several named contacts and a
// director in the mix: the shape a coverage review should pass silently.
const withPerson = (over, person) => row({
  comments: `Summary: ${person} raised it. Contribution: CSM escalated. Outcomes: Confirmed.`,
  ...over,
});
const healthy = [
  withPerson({ eventDate: "2026-07-05", title: "Acme RF User Group - July", type: "User Groups", subtype: "User Group" }, "Avery Stone, lab manager,"),
  withPerson({ eventDate: "2026-07-20", title: "Acme Admin Sync - Licensing" }, "Dana Whitfield, the admin,"),
  withPerson({ eventDate: "2026-08-04", title: "Acme Case Study - SystemLink", type: "Value Realization & Success Stories", subtype: "Case Study" }, "Jordan Blake, engineering director,"),
  withPerson({ eventDate: "2026-08-18", title: "Acme Admin Sync - Server Move" }, "Dana Whitfield"),
  withPerson({ eventDate: "2026-09-02", title: "Acme Training Plan - Core 1", type: "Entitlement Awareness & Promotion", subtype: "Training/Support Plans" }, "Sam Porter"),
  withPerson({ eventDate: "2026-09-10", title: "Acme Sponsor Sync - Adoption" }, "Jordan Blake"),
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
    expect(reviewActivityPortfolio([])).toEqual({ findings: [], stats: { total: 0, internal: 0, customerFacing: 0, other: 0, byType: [], stalePlanned: 0 } });
  });
});

describe("status hygiene and stakeholder depth", () => {
  const today = new Date("2026-09-17T12:00:00");
  const withNames = (over = {}, name = "Dana Whitfield", role = "IT Admin Lead") =>
    row({ comments: `Summary: ${name}, ${role}, raised it. Contribution: CSM advised. Outcomes: Done.`, ...over });

  it("flags records left in Planned after their date", () => {
    const rows = [row({ status: "Planned", eventDate: "2026-08-01" }), row({ title: "b", eventDate: "2026-08-02" })];
    const { findings, stats } = reviewActivityPortfolio(rows, { today });
    expect(findings.map((f) => f.code)).toContain("stale-planned");
    expect(stats.stalePlanned).toBe(1);
    // A future commitment is not stale.
    expect(codes([row({ status: "Planned", eventDate: "2026-11-01" })], { today })).not.toContain("stale-planned");
  });

  it("flags an account resting on one contact, and one with none named", () => {
    const oneContact = Array.from({ length: 5 }, (_, i) => withNames({ title: `Acme Sync ${i}`, eventDate: `2026-08-0${i + 1}` }));
    expect(codes(oneContact, { today })).toContain("single-contact");

    const twoContacts = [...oneContact.slice(0, 3), withNames({ title: "Acme Sponsor Sync", eventDate: "2026-08-06" }, "Priya Raghavan", "Engineering Director")];
    expect(codes([...twoContacts, withNames({ title: "Acme UG", eventDate: "2026-08-07" }, "Avery Stone", "Lab Manager")], { today })).not.toContain("single-contact");

    const anonymous = Array.from({ length: 5 }, (_, i) => row({ title: `Acme Sync ${i}`, eventDate: `2026-08-0${i + 1}`, comments: "Summary: Reviewed it. Contribution: CSM advised. Outcomes: Done." }));
    expect(codes(anonymous, { today })).toContain("no-contacts");
  });

  it("flags a report logged entirely below sponsor level", () => {
    const adminOnly = Array.from({ length: 5 }, (_, i) => withNames({ title: `Acme Admin Sync ${i}`, eventDate: `2026-08-0${i + 1}` }, `Contact ${i}`.replace(/\d/, "Person"), "IT Admin Lead"));
    expect(codes(adminOnly, { today })).toContain("no-senior-stakeholder");

    const withSponsor = [...adminOnly.slice(0, 4), withNames({ title: "Acme Sponsor Sync", eventDate: "2026-08-09" }, "Priya Raghavan", "Engineering Director")];
    expect(codes(withSponsor, { today })).not.toContain("no-senior-stakeholder");
  });

  it("stays quiet about depth on a short report", () => {
    expect(codes([withNames(), withNames({ title: "b", eventDate: "2026-08-13" })], { today })).not.toContain("single-contact");
  });
});
