import { describe, expect, it } from "vitest";
import { consolidateFacts, isJunkName, nameKey } from "./factConsolidation";

const fact = (overrides) => ({
  type: "person", name: "Dana Whitfield", aliases: [], role: "", organization: "", site: "",
  relationship: "", evidence: "Ran the sync.", confidence: "medium", sourceId: "S1",
  sourceDate: "2026-08-01", sourceTitle: "Sync", sourceLabel: "", ...overrides,
});

describe("nameKey", () => {
  it("ignores word order, punctuation, and titles", () => {
    expect(nameKey("Whitfield, Dana")).toBe(nameKey("Dana Whitfield"));
    expect(nameKey("Dr. Dana Whitfield")).toBe(nameKey("Dana Whitfield"));
  });

  it("treats location words as non-identifying for sites only", () => {
    expect(nameKey("Dallas Lab", "site")).toBe(nameKey("Dallas", "site"));
    expect(nameKey("Dallas Lab", "person")).not.toBe(nameKey("Dallas", "person"));
  });

  it("keeps genuinely different names apart", () => {
    expect(nameKey("Dallas", "site")).not.toBe(nameKey("Dallas Fort Worth", "site"));
  });
});

describe("isJunkName", () => {
  it("rejects placeholders that identify nobody", () => {
    for (const junk of ["unknown", "N/A", "the team", "they", "TBD", "  ", "???"]) {
      expect(isJunkName(junk)).toBe(true);
    }
  });

  it("keeps real names", () => {
    expect(isJunkName("Dana Whitfield")).toBe(false);
    expect(isJunkName("Dallas")).toBe(false);
  });
});

describe("consolidateFacts", () => {
  it("merges spellings of one person and keeps every source and detail", () => {
    const { facts, merges } = consolidateFacts([
      fact({ name: "Dana Whitfield", role: "IT Admin Lead", evidence: "Ran the sync.", sourceDate: "2026-08-01", sourceTitle: "Aug sync" }),
      fact({ name: "Whitfield, Dana", site: "Dallas", evidence: "Owns licensing.", sourceDate: "2026-09-01", sourceTitle: "Sept sync" }),
    ]);

    expect(facts).toHaveLength(1);
    expect(facts[0].name).toBe("Dana Whitfield");
    expect(facts[0].role).toBe("IT Admin Lead");
    expect(facts[0].site).toBe("Dallas");
    expect(facts[0].evidence).toContain("Ran the sync.");
    expect(facts[0].evidence).toContain("Owns licensing.");
    expect(facts[0].mergedCount).toBe(2);
    expect(facts[0].sources).toHaveLength(2);
    // The newest mention supplies the headline source.
    expect(facts[0].sourceDate).toBe("2026-09-01");
    expect(merges[0]).toMatchObject({ type: "person", name: "Dana Whitfield", count: 2 });
  });

  it("folds a first name into the one full name that contains it", () => {
    const { facts } = consolidateFacts([
      fact({ name: "Dana Whitfield" }),
      fact({ name: "Dana", evidence: "Asked for the license count." }),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].name).toBe("Dana Whitfield");
    expect(facts[0].aliases).toContain("Dana");
  });

  it("refuses to fold an ambiguous first name onto either candidate", () => {
    const { facts } = consolidateFacts([
      fact({ name: "Dana Whitfield" }),
      fact({ name: "Dana Ortiz" }),
      fact({ name: "Dana", evidence: "Unclear which Dana." }),
    ]);
    expect(facts).toHaveLength(3);
  });

  it("merges through an alias even when the names never match directly", () => {
    const { facts } = consolidateFacts([
      fact({ name: "Daniela Whitfield", aliases: ["DW"] }),
      fact({ name: "DW", evidence: "Signed off." }),
    ]);
    expect(facts).toHaveLength(1);
    expect(facts[0].name).toBe("Daniela Whitfield");
  });

  it("consolidates site spellings but keeps distinct places apart", () => {
    const { facts } = consolidateFacts([
      fact({ type: "site", name: "Dallas" }),
      fact({ type: "site", name: "Dallas Lab", evidence: "Hosts the rack." }),
      fact({ type: "site", name: "Austin", evidence: "Second site." }),
    ]);
    expect(facts.map((f) => f.name).sort()).toEqual(["Austin", "Dallas Lab"]);
  });

  it("never merges across types", () => {
    const { facts } = consolidateFacts([
      fact({ type: "person", name: "Dallas" }),
      fact({ type: "site", name: "Dallas", evidence: "The site." }),
    ]);
    expect(facts).toHaveLength(2);
  });

  it("drops placeholder names and reports them", () => {
    const { facts, dropped } = consolidateFacts([
      fact({ name: "Dana Whitfield" }),
      fact({ name: "unknown", evidence: "Someone mentioned it." }),
      fact({ name: "the team", evidence: "Group chatter." }),
    ]);
    expect(facts).toHaveLength(1);
    expect(dropped.sort()).toEqual(["the team", "unknown"]);
  });

  it("leaves an already-clean list untouched and reports no merges", () => {
    const { facts, merges, dropped } = consolidateFacts([
      fact({ name: "Dana Whitfield" }),
      fact({ name: "Marcus Reed", evidence: "Education services." }),
    ]);
    expect(facts).toHaveLength(2);
    expect(merges).toEqual([]);
    expect(dropped).toEqual([]);
  });

  it("handles an empty list", () => {
    expect(consolidateFacts([])).toEqual({ facts: [], merges: [], dropped: [] });
  });
});
