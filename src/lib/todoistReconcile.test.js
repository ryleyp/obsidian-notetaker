import { describe, expect, it } from "vitest";
import {
  completedItemLines,
  completionEvidence,
  dropTasksAlreadyInProject,
  mergeProposals,
  parseCompletionVerdicts,
  tasksForLabel,
  tasksTickedOffByNote,
} from "./todoistReconcile";

const task = (id, content, labels = ["acme"]) => ({ id, content, labels });

describe("dropTasksAlreadyInProject", () => {
  it("skips what the project already has, whatever the formatting", () => {
    const { tasks, skipped } = dropTasksAlreadyInProject(
      [{ content: "**Send** the cert rotation runbook." }, { content: "Book the Q4 review" }],
      ["Send the cert rotation runbook"]
    );
    expect(tasks.map((t) => t.content)).toEqual(["Book the Q4 review"]);
    expect(skipped).toHaveLength(1);
  });

  it("does not file the same item twice from one note", () => {
    // Action Items and Next Steps often carry the same commitment.
    const { tasks, skipped } = dropTasksAlreadyInProject(
      [{ content: "Send the runbook" }, { content: "send the runbook." }, { content: "Book the review" }],
      []
    );
    expect(tasks.map((t) => t.content)).toEqual(["Send the runbook", "Book the review"]);
    expect(skipped).toHaveLength(1);
  });

  it("keeps everything when the project is empty, and ignores blank content", () => {
    expect(dropTasksAlreadyInProject([{ content: "A real task" }], []).tasks).toHaveLength(1);
    expect(dropTasksAlreadyInProject([{ content: "   " }], []).tasks).toEqual([]);
  });
});

describe("completedItemLines", () => {
  it("reads the items a note has already ticked off", () => {
    const note = `## Action Items

- [x] Send the cert rotation runbook — **Owner:** CSM | **Due:** 2026-09-20
- [ ] Book the Q4 review — **Owner:** CSM
- [X] Confirm the server hostname
`;
    expect(completedItemLines(note)).toEqual(["Send the cert rotation runbook", "Confirm the server hostname"]);
  });

  it("returns nothing for a note with no checked items", () => {
    expect(completedItemLines("- [ ] Still open")).toEqual([]);
    expect(completedItemLines("")).toEqual([]);
  });
});

describe("tasksForLabel", () => {
  it("scopes to one account so a note never touches another's tasks", () => {
    const tasks = [task(1, "a", ["acme"]), task(2, "b", ["beacon"]), task(3, "c", [])];
    expect(tasksForLabel(tasks, "acme").map((t) => t.id)).toEqual([1]);
    expect(tasksForLabel(tasks, "ACME").map((t) => t.id)).toEqual([1]);
    // No label means no scoping is possible, so nothing is filtered out.
    expect(tasksForLabel(tasks, "")).toHaveLength(3);
  });
});

describe("tasksTickedOffByNote", () => {
  const tasks = [task(1, "Send the cert rotation runbook"), task(2, "Book the Q4 review")];

  it("proposes exactly the tasks the note ticks off", () => {
    const note = "- [x] Send the cert rotation runbook — **Owner:** CSM\n- [ ] Book the Q4 review";
    expect(tasksTickedOffByNote(tasks, note)).toEqual([
      { id: "1", content: "Send the cert rotation runbook", reason: "Ticked off in this note", evidence: "", certain: true },
    ]);
  });

  it("will not match on a resemblance", () => {
    expect(tasksTickedOffByNote(tasks, "- [x] Send a runbook of some kind")).toEqual([]);
    expect(tasksTickedOffByNote(tasks, "- [ ] Send the cert rotation runbook")).toEqual([]);
  });
});

describe("parseCompletionVerdicts", () => {
  const tasks = [task(1, "Send the cert rotation runbook"), task(2, "Book the Q4 review")];

  it("keeps verdicts that name a real task and quote the note", () => {
    const text = [
      '{"id":"1","done":true,"reason":"Runbook was sent on the call","evidence":"CSM sent the rotation runbook during the sync"}',
      "Here is my analysis:",
      '{"id":"2","done":false,"reason":"Still outstanding","evidence":"not mentioned"}',
    ].join("\n");
    expect(parseCompletionVerdicts(text, tasks)).toEqual([
      { id: "1", content: "Send the cert rotation runbook", reason: "Runbook was sent on the call", evidence: "CSM sent the rotation runbook during the sync", certain: false },
    ]);
  });

  it("drops a verdict with no evidence, an unknown task, or a repeat", () => {
    const text = [
      '{"id":"1","done":true,"reason":"trust me","evidence":""}',
      '{"id":"99","done":true,"reason":"x","evidence":"y"}',
      '{"id":"2","done":true,"reason":"a","evidence":"booked for October"}',
      '{"id":"2","done":true,"reason":"b","evidence":"booked again"}',
    ].join("\n");
    expect(parseCompletionVerdicts(text, tasks).map((v) => v.id)).toEqual(["2"]);
  });

  it("survives prose or an empty answer", () => {
    expect(parseCompletionVerdicts("Nothing looks complete.", tasks)).toEqual([]);
    expect(parseCompletionVerdicts("", tasks)).toEqual([]);
  });
});

describe("completionEvidence", () => {
  it("sends the sections where completion shows up, not the whole note", () => {
    const note = `# Title

## Executive Summary

Dana confirmed the cert was renewed.

## Transcript

lots of raw speech

## Action Items

- [x] Send the runbook
`;
    const evidence = completionEvidence(note);
    expect(evidence).toContain("Dana confirmed the cert was renewed.");
    expect(evidence).toContain("- [x] Send the runbook");
    expect(evidence).not.toContain("lots of raw speech");
  });

  it("falls back to the note itself and respects the cap", () => {
    expect(completionEvidence("just loose text")).toBe("just loose text");
    expect(completionEvidence("x".repeat(9000), 100)).toHaveLength(100);
  });
});

describe("mergeProposals", () => {
  it("puts the certain ones first and never proposes a task twice", () => {
    const certain = [{ id: "1", certain: true }];
    const suggested = [{ id: "1", certain: false }, { id: "2", certain: false }];
    expect(mergeProposals(certain, suggested).map((p) => p.id)).toEqual(["1", "2"]);
    expect(mergeProposals(certain, suggested)[0].certain).toBe(true);
  });
});
