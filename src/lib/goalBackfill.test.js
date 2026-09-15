import { describe, expect, it } from "vitest";
import {
  buildGoalSection,
  chunk,
  goalEvidenceExcerpt,
  hasGoalSection,
  insertGoalSection,
  parseBackfillVerdicts,
} from "./goalBackfill";
import { parseGoalContributions } from "./goals";

const goals = [
  { name: "Case studies", target: "4 completed" },
  { name: "Training credit utilization", target: "15%" },
];

const olderNote = `# 2026-03-04 - Acme Sync

## Executive Summary

Scoped training across three sites.

## Meeting Notes

- Agreed on Core 1 and Core 2.

---

## SFDC Activity Entry

**Type:** Entitlement Awareness & Promotion
`;

describe("hasGoalSection", () => {
  it("recognises a note that already carries the section", () => {
    expect(hasGoalSection(olderNote)).toBe(false);
    expect(hasGoalSection("## Goal Contributions\n\nNothing noted.\n")).toBe(true);
    // A mention inside prose is not a section heading.
    expect(hasGoalSection("- talked about Goal Contributions")).toBe(false);
  });
});

describe("goalEvidenceExcerpt", () => {
  it("keeps the reviewed write-up and leaves the transcript out", () => {
    const withTranscript = `${olderNote}\n## Transcript\n\nlots of raw speech\n`;
    const excerpt = goalEvidenceExcerpt(withTranscript);
    expect(excerpt).toContain("Scoped training across three sites.");
    expect(excerpt).toContain("Core 1 and Core 2");
    expect(excerpt).not.toContain("lots of raw speech");
  });

  it("falls back to the head of a note with no known headings", () => {
    expect(goalEvidenceExcerpt("just some loose text")).toBe("just some loose text");
  });
});

describe("insertGoalSection", () => {
  it("writes the section above the SFDC entry, readable by the harvester", () => {
    const updated = insertGoalSection(olderNote, [
      { goal: "Case studies", contribution: "Captured deployment outcomes", metric: "1 of 4" },
    ]);
    expect(updated.indexOf("## Goal Contributions")).toBeLessThan(updated.indexOf("## SFDC Activity Entry"));
    expect(updated).toContain("## Meeting Notes");
    expect(updated).toContain("**Type:** Entitlement Awareness & Promotion");
    expect(parseGoalContributions(updated)).toEqual([
      { goal: "Case studies", contribution: "Captured deployment outcomes", metric: "1 of 4" },
    ]);
    // The rule that introduced the SFDC heading still introduces it.
    expect(updated).toContain("---\n\n## SFDC Activity Entry");
  });

  it("appends to a note with no SFDC entry", () => {
    const updated = insertGoalSection("# Note\n\n## Meeting Notes\n\n- thing\n", []);
    expect(updated.trimEnd().endsWith("Nothing noted.")).toBe(true);
    expect(parseGoalContributions(updated)).toEqual([]);
  });

  it("refuses to touch a note that already has the section, or an empty one", () => {
    expect(insertGoalSection("## Goal Contributions\n\nNothing noted.\n", [])).toBeNull();
    expect(insertGoalSection("   ", [])).toBeNull();
  });
});

describe("buildGoalSection", () => {
  it("records nothing noted rather than an empty section", () => {
    expect(buildGoalSection([])).toContain("Nothing noted.");
    expect(buildGoalSection([{ goal: "Case studies", contribution: "  " }])).toContain("Nothing noted.");
  });
});

describe("parseBackfillVerdicts", () => {
  const notes = [{ relativePath: "Acme/a.md" }, { relativePath: "Acme/b.md" }];

  it("keeps proposals that name a configured goal", () => {
    const { byNote, dropped } = parseBackfillVerdicts(
      JSON.stringify([
        { id: 0, goal: "Case studies", contribution: "Kicked off the write-up", metric: "1 of 4" },
        { id: 1, goal: "Training credit", contribution: "Scoped Core 1" },
      ]),
      notes,
      goals
    );
    expect(byNote.get("Acme/a.md")).toEqual([
      { goal: "Case studies", contribution: "Kicked off the write-up", metric: "1 of 4" },
    ]);
    // Partial wording resolves to the configured goal's exact name.
    expect(byNote.get("Acme/b.md")).toEqual([
      { goal: "Training credit utilization", contribution: "Scoped Core 1", metric: "" },
    ]);
    expect(dropped).toBe(0);
  });

  it("drops invented goals, unknown notes, and empty contributions", () => {
    const { byNote, dropped } = parseBackfillVerdicts(
      JSON.stringify([
        { id: 0, goal: "Thought leadership", contribution: "Spoke at an event" },
        { id: 9, goal: "Case studies", contribution: "Something" },
        { id: 1, goal: "Case studies", contribution: "" },
      ]),
      notes,
      goals
    );
    expect(byNote.size).toBe(0);
    expect(dropped).toBe(3);
  });

  it("reports an unreadable answer instead of throwing", () => {
    expect(parseBackfillVerdicts("sorry, I cannot", notes, goals).parseFailed).toBe(true);
    expect(parseBackfillVerdicts('{"id":0}', notes, goals).parseFailed).toBe(true);
  });

  it("strips a fenced code block around the JSON", () => {
    const fenced = '```json\n[{"id":0,"goal":"Case studies","contribution":"Drafted it"}]\n```';
    expect(parseBackfillVerdicts(fenced, notes, goals).byNote.size).toBe(1);
  });
});

describe("chunk", () => {
  it("splits into batches without losing anything", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});
