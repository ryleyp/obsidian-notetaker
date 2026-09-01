import { describe, expect, it } from "vitest";
import {
  normalizeTaskContent,
  parseTodoistProjectId,
  todoistConfigured,
  todoistLabelForFolder,
  todoistLabelForNote,
  todoistTaskFromItemLine,
} from "./todoist";

describe("parseTodoistProjectId", () => {
  it("extracts the id from a project URL", () => {
    expect(parseTodoistProjectId("https://app.todoist.com/app/project/work-tasks-6fwxr0729Mwh88Gj"))
      .toBe("6fwxr0729Mwh88Gj");
  });

  it("passes a bare id through", () => {
    expect(parseTodoistProjectId("6fwxr0729Mwh88Gj")).toBe("6fwxr0729Mwh88Gj");
  });

  it("returns empty for blank input", () => {
    expect(parseTodoistProjectId("")).toBe("");
    expect(parseTodoistProjectId("   ")).toBe("");
  });
});

describe("todoistLabelForFolder", () => {
  it("uses the last folder segment with spaces made label-safe", () => {
    expect(todoistLabelForFolder("Accounts/Acme Corp")).toBe("Acme-Corp");
    expect(todoistLabelForFolder("Acme")).toBe("Acme");
    expect(todoistLabelForFolder("")).toBe("");
  });
});

describe("todoistLabelForNote", () => {
  const accounts = [
    { name: "Acme Aerospace", aliases: ["acme"], todoistLabel: "acme aero" },
    { name: "Globex", aliases: ["globex"] },
  ];

  it("uses the account's configured tag when set, made label-safe", () => {
    expect(todoistLabelForNote("Acme Corp", accounts)).toBe("acme-aero");
  });

  it("falls back to the folder name when the account has no tag", () => {
    expect(todoistLabelForNote("Globex Notes", accounts)).toBe("Globex-Notes");
  });

  it("falls back to the folder name for unmatched folders", () => {
    expect(todoistLabelForNote("Random Folder", accounts)).toBe("Random-Folder");
  });
});

describe("todoistTaskFromItemLine", () => {
  it("parses content, due date, label, and source note", () => {
    const task = todoistTaskFromItemLine(
      "- [ ] Send SystemLink license summary — **Owner:** Ryley | **Due:** 2026-09-05",
      { noteTitle: "2026-09-01 - Acme Sync", label: "Acme" }
    );
    expect(task).toEqual({
      content: "Send SystemLink license summary",
      dueString: "2026-09-05",
      labels: ["Acme"],
      description: "From: 2026-09-01 - Acme Sync",
    });
  });

  it("omits the due date when it is TBD", () => {
    const task = todoistTaskFromItemLine("- [ ] Follow up on portal — **Owner:** CSM | **Due:** TBD");
    expect(task.content).toBe("Follow up on portal");
    expect(task.dueString).toBeUndefined();
    expect(task.labels).toEqual([]);
  });

  it("skips completed items", () => {
    expect(todoistTaskFromItemLine("- [x] Already done — **Owner:** Ryley | **Due:** TBD")).toBeNull();
  });

  it("handles plain bullets without owner metadata", () => {
    const task = todoistTaskFromItemLine("- Confirm training credits with Dana");
    expect(task.content).toBe("Confirm training credits with Dana");
    expect(task.dueString).toBeUndefined();
  });
});

describe("normalizeTaskContent", () => {
  it("ignores emphasis, case, spacing, and trailing punctuation", () => {
    expect(normalizeTaskContent("**Send  License summary.**")).toBe("send license summary");
    expect(normalizeTaskContent("send license summary")).toBe("send license summary");
    expect(normalizeTaskContent("")).toBe("");
  });
});

describe("todoistConfigured", () => {
  it("requires both a token and a resolvable project", () => {
    expect(todoistConfigured({ todoistApiToken: "tok", todoistProject: "6fwxr0729Mwh88Gj" })).toBe(true);
    expect(todoistConfigured({ todoistApiToken: "tok", todoistProject: "" })).toBe(false);
    expect(todoistConfigured({ todoistApiToken: "", todoistProject: "6fwxr0729Mwh88Gj" })).toBe(false);
    expect(todoistConfigured(undefined)).toBe(false);
  });
});
