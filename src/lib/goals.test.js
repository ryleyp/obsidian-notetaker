import { describe, expect, it } from "vitest";
import {
  formatContributionLine,
  formatGoalsForPrompt,
  goalsToText,
  matchGoal,
  parseGoalContributions,
  parseGoalsText,
} from "./goals";

describe("parseGoalsText", () => {
  it("reads goals pasted with the separators people actually use", () => {
    expect(parseGoalsText([
      "Training credit utilization — 15% by year end",
      "- Case studies: 4 completed",
      "3. Account growth - 7% above baseline",
      "Customer references",
    ])).toEqual([
      { name: "Training credit utilization", target: "15% by year end" },
      { name: "Case studies", target: "4 completed" },
      { name: "Account growth", target: "7% above baseline" },
      { name: "Customer references", target: "" },
    ]);
  });

  it("accepts an array or a single block of text", () => {
    const text = "Case studies: 4\nGrowth: 7%";
    expect(parseGoalsText(text)).toHaveLength(2);
  });

  it("reads a pasted Markdown table and skips its header and rules", () => {
    const table = [
      "| Goal | Target |",
      "| --- | --- |",
      "| Case studies | 4 completed |",
      "| Growth | 7% |",
    ].join("\n");
    expect(parseGoalsText(table)).toEqual([
      { name: "Case studies", target: "4 completed" },
      { name: "Growth", target: "7%" },
    ]);
  });

  it("keeps hyphenated names intact and drops blanks and duplicates", () => {
    expect(parseGoalsText("Go-to-market adoption\n\nGo-to-market adoption\n   \n---")).toEqual([
      { name: "Go-to-market adoption", target: "" },
    ]);
  });

  it("round-trips through goalsToText", () => {
    const goals = [{ name: "Case studies", target: "4 completed" }, { name: "References", target: "" }];
    expect(parseGoalsText(goalsToText(goals))).toEqual(goals);
  });
});

describe("matchGoal", () => {
  const goals = [
    { name: "Case study completion", target: "4" },
    { name: "Training credit utilization", target: "15%" },
    { name: "Account growth", target: "7%" },
  ];

  it("matches exactly and through partial wording", () => {
    expect(matchGoal("Case study completion", goals)?.name).toBe("Case study completion");
    expect(matchGoal("case studies", goals)).toBeNull(); // "studies" != "study"
    expect(matchGoal("Training credit", goals)?.name).toBe("Training credit utilization");
  });

  it("refuses an ambiguous or unknown goal rather than guessing", () => {
    const ambiguous = [{ name: "Growth" }, { name: "Growth plan" }];
    expect(matchGoal("Growth", ambiguous)?.name).toBe("Growth");
    expect(matchGoal("Grow", ambiguous)).toBeNull();
    expect(matchGoal("Something else", goals)).toBeNull();
    expect(matchGoal("", goals)).toBeNull();
  });
});

describe("formatGoalsForPrompt", () => {
  it("lists goals with their targets, and stays empty when none are set", () => {
    expect(formatGoalsForPrompt([{ name: "Case studies", target: "4" }, { name: "References", target: "" }]))
      .toBe("- Case studies (target: 4)\n- References");
    expect(formatGoalsForPrompt([])).toBe("");
    expect(formatGoalsForPrompt([{ name: "  " }])).toBe("");
  });
});

describe("goal contribution lines", () => {
  const note = `# 2026-08-20 - Acme Sync

## Meeting Notes

- Stuff

---

## ${"Goal Contributions"}

- **Goal:** Case studies | **Contribution:** Kicked off the SystemLink case study with Acme | **Metric:** 1 of 4
- **Goal:** Training credit utilization | **Contribution:** Scoped LabVIEW Core 1 across three sites

---

## SFDC Activity Entry

**Type:** Strategic Relationship Management
`;

  it("reads contributions out of a saved note", () => {
    expect(parseGoalContributions(note)).toEqual([
      { goal: "Case studies", contribution: "Kicked off the SystemLink case study with Acme", metric: "1 of 4" },
      { goal: "Training credit utilization", contribution: "Scoped LabVIEW Core 1 across three sites", metric: "" },
    ]);
  });

  it("returns nothing for notes without the section or with none recorded", () => {
    expect(parseGoalContributions("# Note\n\n## Meeting Notes\n\n- x")).toEqual([]);
    expect(parseGoalContributions("## Goal Contributions\n\nNothing noted.\n")).toEqual([]);
    expect(parseGoalContributions("")).toEqual([]);
  });

  it("formats a line the parser can read back", () => {
    const line = formatContributionLine({ goal: "Case studies", contribution: "Drafted the write-up", metric: "2 of 4" });
    expect(parseGoalContributions(`## Goal Contributions\n\n${line}\n`)).toEqual([
      { goal: "Case studies", contribution: "Drafted the write-up", metric: "2 of 4" },
    ]);
  });
});
