import { describe, expect, it } from "vitest";
import { goalGroupsToMarkdown, harvestGoalContributions } from "./goalHarvest";

const goals = [
  { name: "Case studies", target: "4 completed" },
  { name: "Training credit utilization", target: "15%" },
  { name: "Customer references", target: "2" },
];

const note = (date, title, lines) => ({
  date,
  title,
  content: `# ${date} - ${title}\n\n## Goal Contributions\n\n${lines.join("\n")}\n\n---\n\n## SFDC Activity Entry\n`,
});

const notes = [
  note("2026-08-01", "Acme Sync", [
    "- **Goal:** Case studies | **Contribution:** Kicked off the SystemLink write-up | **Metric:** 1 of 4",
  ]),
  note("2026-09-01", "Acme Training", [
    "- **Goal:** Training credit utilization | **Contribution:** Scoped Core 1 across three sites | **Metric:** ~7,600 credits",
    "- **Goal:** Case studies | **Contribution:** Captured the deployment outcome",
  ]),
  { date: "2026-09-02", title: "Plain note", content: "# Plain\n\n## Meeting Notes\n\n- nothing relevant" },
];

describe("harvestGoalContributions", () => {
  it("groups contributions under each configured goal, newest first", () => {
    const { groups, stats } = harvestGoalContributions(notes, goals);
    const caseStudies = groups.find((g) => g.goal.name === "Case studies");

    expect(caseStudies.contributions.map((c) => c.date)).toEqual(["2026-09-01", "2026-08-01"]);
    expect(caseStudies.contributions[0]).toMatchObject({
      contribution: "Captured the deployment outcome",
      noteTitle: "Acme Training",
    });
    expect(stats).toMatchObject({
      notesScanned: 3,
      notesWithContributions: 2,
      contributions: 3,
      goalsWithEvidence: 2,
    });
  });

  it("keeps configured goals that have no evidence yet, and names them", () => {
    const { groups, stats } = harvestGoalContributions(notes, goals);
    const references = groups.find((g) => g.goal.name === "Customer references");
    expect(references.contributions).toEqual([]);
    expect(stats.goalsWithoutEvidence).toEqual(["Customer references"]);
  });

  it("keeps a contribution whose goal is no longer configured instead of dropping it", () => {
    const stray = note("2026-07-01", "Old cycle", ["- **Goal:** Retired metric | **Contribution:** Did the thing"]);
    const { groups, stats } = harvestGoalContributions([stray], goals);
    const extra = groups.find((g) => g.goal.name === "Retired metric");

    expect(extra.unconfigured).toBe(true);
    expect(extra.contributions).toHaveLength(1);
    expect(stats.unconfiguredGoals).toEqual(["Retired metric"]);
  });

  it("matches a goal written with slightly different wording in the note", () => {
    const loose = note("2026-09-03", "Sync", ["- **Goal:** Training credit | **Contribution:** Booked the sessions"]);
    const { groups } = harvestGoalContributions([loose], goals);
    expect(groups.find((g) => g.goal.name === "Training credit utilization").contributions).toHaveLength(1);
  });

  it("handles no notes and no goals", () => {
    expect(harvestGoalContributions([], goals).stats.contributions).toBe(0);
    expect(harvestGoalContributions(notes, []).stats.unconfiguredGoals).toHaveLength(2);
  });
});

describe("goalGroupsToMarkdown", () => {
  it("writes one traceable section per goal", () => {
    const { groups } = harvestGoalContributions(notes, goals);
    const md = goalGroupsToMarkdown(groups, { rangeLabel: "Aug 1 – Sep 30, 2026" });

    expect(md).toContain("# Performance Review Evidence");
    expect(md).toContain("*Aug 1 – Sep 30, 2026*");
    expect(md).toContain("## Case studies");
    expect(md).toContain("**Target:** 4 completed");
    expect(md).toContain("| Date | Contribution | Metric | Source Note |");
    expect(md).toContain("Captured the deployment outcome");
    expect(md).toContain("Acme Training");
    expect(md).toContain("No contributions recorded in this period.");
  });

  it("escapes pipes so a contribution cannot break the table", () => {
    const groups = [{ goal: { name: "G", target: "" }, contributions: [{ date: "2026-09-01", contribution: "A | B", metric: "", noteTitle: "N" }] }];
    const row = goalGroupsToMarkdown(groups).split("\n").find((l) => l.includes("A \\| B"));
    expect(row).toBeTruthy();
    const columns = (line) => (line.replace(/\\\|/g, "").match(/\|/g) || []).length;
    expect(columns(row)).toBe(5);
  });
});
