import { describe, it, expect } from "vitest";
import {
  lineContainsKeyword,
  getForbiddenKeywords,
  buildScrubReport,
  scrubWithExceptions,
  findAccountBleed,
  redactForbiddenTerms,
  countTermHits,
  assessNoteDominance,
} from "@/lib/scrub";

const ACCOUNTS = [
  { name: "Lockheed Martin", aliases: ["lockheed", "lmco"], keywords: ["MFC", "PAC-3"] },
  { name: "L3Harris", aliases: ["l3harris", "l3 harris"], keywords: ["WESCAM"] },
  { name: "Northrop Grumman", aliases: ["northrop", "ngc"], keywords: ["B-21"] },
  { name: "Internal", aliases: [], keywords: ["standup"] },
  { name: "Frontgrade", aliases: ["frontgrade"], keywords: [] },
];

function note(filename, content, extra = {}) {
  return { filename, title: filename.replace(".md", ""), date: "2026-06-01", content, ...extra };
}

describe("lineContainsKeyword", () => {
  it("matches whole words case-insensitively", () => {
    expect(lineContainsKeyword("Discussed ngc roadmap", ["NGC"])).toBe(true);
    expect(lineContainsKeyword("Discussed NGC roadmap", ["ngc"])).toBe(true);
  });

  it("does not match a keyword embedded inside a larger word", () => {
    expect(lineContainsKeyword("the engcomputer lab", ["ngc"])).toBe(false);
    expect(lineContainsKeyword("simfcx module", ["mfc"])).toBe(false);
  });

  it("matches keywords adjacent to punctuation", () => {
    expect(lineContainsKeyword("Update (NGC): slipped", ["NGC"])).toBe(true);
    expect(lineContainsKeyword("NGC, LM, and others", ["NGC"])).toBe(true);
    expect(lineContainsKeyword("priorities: B-21.", ["B-21"])).toBe(true);
  });

  it("handles keywords with regex special characters and non-word edges", () => {
    // "B-21" ends with a digit (word char) but contains a dash
    expect(lineContainsKeyword("B-21 program sync", ["B-21"])).toBe(true);
    // keyword ending in non-word char anchors only on the word side
    expect(lineContainsKeyword("uses C++ daily", ["C++"])).toBe(true);
  });

  it("ignores blank or whitespace-only keywords", () => {
    expect(lineContainsKeyword("anything at all", ["", "  "])).toBe(false);
  });
});

describe("getForbiddenKeywords", () => {
  it("collects keywords from all other accounts", () => {
    const kws = getForbiddenKeywords("L3Harris", ACCOUNTS);
    expect(kws).toContain("MFC");
    expect(kws).toContain("ngc");
    expect(kws).toContain("B-21");
  });

  it("excludes the current account's own keywords", () => {
    const kws = getForbiddenKeywords("L3Harris", ACCOUNTS);
    expect(kws).not.toContain("WESCAM");
  });

  it("excludes Internal keywords so internal terms are never scrubbed", () => {
    const kws = getForbiddenKeywords("L3Harris", ACCOUNTS);
    expect(kws).not.toContain("standup");
  });

  it("returns empty for missing account list", () => {
    expect(getForbiddenKeywords("L3Harris", undefined)).toEqual([]);
    expect(getForbiddenKeywords("L3Harris", [])).toEqual([]);
  });

  it("includes other accounts' names and aliases, not just keywords", () => {
    const kws = getForbiddenKeywords("Northrop Grumman", ACCOUNTS);
    expect(kws).toContain("L3Harris");
    expect(kws).toContain("l3 harris");
    expect(kws).toContain("Lockheed Martin");
    expect(kws).toContain("lockheed");
  });

  it("scrubs nothing for Internal reports (they legitimately span accounts)", () => {
    expect(getForbiddenKeywords("Internal", ACCOUNTS)).toEqual([]);
    expect(getForbiddenKeywords("", ACCOUNTS)).toEqual([]);
  });

  it("never forbids a term the current account also claims (alias collision)", () => {
    const shared = [
      { name: "Alpha", aliases: ["harris"], keywords: [] },
      { name: "Beta", aliases: ["harris", "beta"], keywords: [] },
    ];
    const kws = getForbiddenKeywords("Alpha", shared);
    expect(kws).not.toContain("harris");
    expect(kws).toContain("beta");
  });
});

describe("account name/alias bleed protection", () => {
  it("flags a line naming another account even with no keyword match", () => {
    const notes = [note("a.md", "NGC quarter update\nL3Harris asked about licensing terms\nAll set")];
    const report = buildScrubReport(notes, "Northrop Grumman", ACCOUNTS);
    expect(report).toHaveLength(1);
    expect(report[0].line).toContain("L3Harris");
  });

  it("scrubs lines mentioning another account's alias", () => {
    const notes = [note("a.md", "L3Harris keep\nlockheed folks joined the call\nkeep too")];
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("L3Harris keep\nkeep too");
  });

  it("does not scrub the current account's own name from its own report", () => {
    const notes = [note("a.md", "L3Harris renewal is on track")];
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("L3Harris renewal is on track");
  });
});

describe("countTermHits / assessNoteDominance", () => {
  it("counts whole-word hits across terms", () => {
    expect(countTermHits("NGC met NGC about ngc things", ["ngc"])).toBe(3);
    expect(countTermHits("engcomputer", ["ngc"])).toBe(0);
  });

  it("flags a note dominated by another account for auto-exclusion", () => {
    const n = note("a.md", "northrop sites reviewed\nNGC coverage plan\nB-21 milestones\nbrief l3harris aside");
    const dom = assessNoteDominance(n, "L3Harris", ACCOUNTS);
    expect(dom.account).toBe("Northrop Grumman");
    expect(dom.hits).toBeGreaterThan(dom.ownHits);
  });

  it("does not flag a note that is mostly about the current account", () => {
    const n = note("a.md", "l3harris renewal\nL3Harris WESCAM demo\none ngc mention\nl3 harris follow-up");
    expect(assessNoteDominance(n, "L3Harris", ACCOUNTS)).toBeNull();
  });

  it("never flags for Internal reports", () => {
    const n = note("a.md", "northrop northrop northrop");
    expect(assessNoteDominance(n, "Internal", ACCOUNTS)).toBeNull();
  });
});

describe("transcript scrub radius", () => {
  it("removes surrounding context lines around a mention inside a large anchored block", () => {
    const lines = [
      "l3harris kickoff discussion",   // 0 own — kept
      "general agenda review",         // 1 within radius of 3 — removed
      "budget context for the program",// 2 within radius of 3 — removed
      "northrop asked about licensing",// 3 forbidden — removed
      "they want the site expansion",  // 4 within radius — removed
      "timeline is next quarter",      // 5 within radius — removed
      "back to l3harris items",        // 6 own — kept
      "l3harris action items assigned",// 7 own — kept
    ].join("\n");
    const [scrubbed] = scrubWithExceptions([note("a.md", lines)], "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe(
      "l3harris kickoff discussion\nback to l3harris items\nl3harris action items assigned"
    );
  });

  it("does not apply the radius to small anchored paragraphs", () => {
    const content = "L3Harris keep\nlockheed folks joined the call\nkeep too";
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("L3Harris keep\nkeep too");
  });
});

describe("context-aware scrubbing (orphaned content)", () => {
  it("removes an entire heading section about another account, including lines with no forbidden term", () => {
    const content = [
      "# Northrop review",
      "- add Northridge to coverage",
      "- Space Park regional grouping",
      "# L3Harris review",
      "- l3harris renewal on track",
    ].join("\n");
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("# L3Harris review\n- l3harris renewal on track");
  });

  it("removes a whole paragraph about another account when the current account is never named", () => {
    const content = [
      "Discussed lockheed renewal timeline",
      "Follow up on unused training credits at Sunnyvale",
      "Schedule next-gen test system upgrade sync",
      "",
      "L3Harris WESCAM demo went well",
    ].join("\n");
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("\nL3Harris WESCAM demo went well");
  });

  it("keeps the rest of a paragraph that also names the current account", () => {
    const content = "L3Harris and lockheed joint supplier review\nAction item for the L3Harris team";
    const [scrubbed] = scrubWithExceptions([note("a.md", content)], "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("Action item for the L3Harris team");
  });

  it("scrub report lists every line the scrubber would remove (block agreement)", () => {
    const content = "Discussed lockheed renewal\nFollow up on Sunnyvale credits\nSchedule sync";
    const notes = [note("a.md", content)];
    const report = buildScrubReport(notes, "L3Harris", ACCOUNTS);
    expect(report.map((r) => r.id)).toEqual(["a.md__0", "a.md__1", "a.md__2"]);
    // Restoring everything must round-trip to the original.
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS, report.map((r) => r.id));
    expect(scrubbed.content).toBe(content);
  });
});

describe("redactForbiddenTerms", () => {
  it("replaces other-account names, aliases, and keywords case-insensitively", () => {
    const { text, count } = redactForbiddenTerms(
      "Met with L3Harris and LOCKHEED about MFC testing",
      "Northrop Grumman",
      ACCOUNTS
    );
    expect(text).toBe("Met with █████ and █████ about █████ testing");
    expect(count).toBe(3);
  });

  it("leaves the current account's own terms intact", () => {
    const { text, count } = redactForbiddenTerms("Northrop Grumman NGC update", "Northrop Grumman", ACCOUNTS);
    expect(text).toBe("Northrop Grumman NGC update");
    expect(count).toBe(0);
  });

  it("does not redact terms embedded inside larger words", () => {
    const { text } = redactForbiddenTerms("the engcomputer lab", "L3Harris", ACCOUNTS);
    expect(text).toBe("the engcomputer lab");
  });

  it("is a no-op for Internal reports", () => {
    const { text, count } = redactForbiddenTerms("L3Harris and lockheed", "Internal", ACCOUNTS);
    expect(text).toBe("L3Harris and lockheed");
    expect(count).toBe(0);
  });

  it("scrubWithExceptions redacts other-account terms from note titles", () => {
    const notes = [note("2026-04-01 - NGC and L3 Review.md", "safe content", { title: "NGC and L3Harris Review" })];
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS);
    expect(scrubbed.title).toBe("█████ and L3Harris Review");
  });
});

describe("findAccountBleed", () => {
  it("reports terms from other accounts found in output text", () => {
    const output = "| 2026-04-01 | Sync | ... | CSM met with L3Harris and lockheed teams |";
    const hits = findAccountBleed(output, "Northrop Grumman", ACCOUNTS);
    expect(hits.map((h) => h.account).sort()).toEqual(["L3Harris", "Lockheed Martin"]);
    expect(hits.find((h) => h.account === "L3Harris").terms).toContain("L3Harris");
  });

  it("returns empty when output only mentions the current account", () => {
    const output = "Northrop Grumman NGC northrop all good";
    expect(findAccountBleed(output, "Northrop Grumman", ACCOUNTS)).toEqual([]);
  });

  it("does not false-positive on words containing an alias", () => {
    const output = "the engcomputer lab expansion";
    expect(findAccountBleed(output, "L3Harris", ACCOUNTS)).toEqual([]);
  });

  it("returns empty for Internal or blank inputs", () => {
    expect(findAccountBleed("L3Harris stuff", "Internal", ACCOUNTS)).toEqual([]);
    expect(findAccountBleed("", "Northrop Grumman", ACCOUNTS)).toEqual([]);
  });
});

describe("buildScrubReport", () => {
  it("flags lines containing other accounts' keywords", () => {
    const notes = [note("2026-06-01 - L3 Sync.md", "L3Harris renewal on track\nNGC asked about licensing\nAll good")];
    const report = buildScrubReport(notes, "L3Harris", ACCOUNTS);
    expect(report).toHaveLength(1);
    expect(report[0].line).toBe("NGC asked about licensing");
    expect(report[0].id).toBe("2026-06-01 - L3 Sync.md__1");
  });

  it("does not flag the current account's own keywords", () => {
    const notes = [note("a.md", "WESCAM demo went well")];
    expect(buildScrubReport(notes, "L3Harris", ACCOUNTS)).toHaveLength(0);
  });

  it("skips blank lines even if surrounded by flagged content", () => {
    const notes = [note("a.md", "NGC item\n\nNGC item two")];
    const report = buildScrubReport(notes, "L3Harris", ACCOUNTS);
    expect(report.map((r) => r.id)).toEqual(["a.md__0", "a.md__2"]);
  });

  it("returns empty when no other account has keywords", () => {
    const notes = [note("a.md", "NGC everywhere")];
    expect(buildScrubReport(notes, "L3Harris", [{ name: "L3Harris", keywords: ["x"] }])).toEqual([]);
  });

  it("assigns stable per-note line IDs across multiple notes", () => {
    const notes = [note("a.md", "NGC one"), note("b.md", "L3Harris safe\nMFC two")];
    const report = buildScrubReport(notes, "L3Harris", ACCOUNTS);
    expect(report.map((r) => r.id)).toEqual(["a.md__0", "b.md__1"]);
  });
});

describe("scrubWithExceptions", () => {
  it("removes flagged lines from note content", () => {
    const notes = [note("a.md", "L3Harris keep this\nNGC secret line\nkeep this too")];
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS);
    expect(scrubbed.content).toBe("L3Harris keep this\nkeep this too");
  });

  it("preserves lines whose IDs were restored via checkbox", () => {
    const notes = [note("a.md", "L3Harris keep\nNGC restored line\nMFC removed line")];
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS, ["a.md__1"]);
    expect(scrubbed.content).toBe("L3Harris keep\nNGC restored line");
  });

  it("returns notes untouched when there are no forbidden keywords", () => {
    const notes = [note("a.md", "NGC everywhere")];
    const result = scrubWithExceptions(notes, "L3Harris", [{ name: "L3Harris", keywords: [] }]);
    expect(result[0].content).toBe("NGC everywhere");
  });

  it("does not let one note's restored ID leak into another note's line", () => {
    const notes = [note("a.md", "NGC line"), note("b.md", "NGC line")];
    const result = scrubWithExceptions(notes, "L3Harris", ACCOUNTS, ["a.md__0"]);
    expect(result[0].content).toBe("NGC line");
    expect(result[1].content).toBe("");
  });

  it("scrub report and scrubber agree on which lines are affected", () => {
    const content = "L3 all good\nNGC status: waiting\nBudget for B-21 grew\nplain line";
    const notes = [note("a.md", content)];
    const report = buildScrubReport(notes, "L3Harris", ACCOUNTS);
    const restoredAll = report.map((r) => r.id);
    // Restoring everything the report flagged must round-trip to the original.
    const [scrubbed] = scrubWithExceptions(notes, "L3Harris", ACCOUNTS, restoredAll);
    expect(scrubbed.content).toBe(content);
  });
});
