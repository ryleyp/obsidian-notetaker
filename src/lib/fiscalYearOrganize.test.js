import { describe, expect, it } from "vitest";
import { groupMovesByAccount, isRollupName, planFiscalYearMoves } from "./fiscalYearOrganize";

const plan = (paths, options) => planFiscalYearMoves(paths, { currentFolder: "FY2026", ...options });

describe("planFiscalYearMoves", () => {
  it("files each dated note under its account by the date in its name", () => {
    const { moves } = plan([
      "1. Acme/2026-09-08 - Acme Sync.md",
      "1. Acme/2026-10-02 - Acme Kickoff.md",
      "2. Beacon/2025-11-14 - Beacon Review.md",
    ]);
    expect(moves).toEqual([
      expect.objectContaining({ to: "1. Acme/FY2026/2026-09-08 - Acme Sync.md", account: "1. Acme", fiscalYear: "FY2026" }),
      expect.objectContaining({ to: "1. Acme/FY2027/2026-10-02 - Acme Kickoff.md", fiscalYear: "FY2027" }),
      expect.objectContaining({ to: "2. Beacon/FY2026/2025-11-14 - Beacon Review.md", fiscalYear: "FY2026" }),
    ]);
  });

  it("leaves undated notes, vault-root files, and already-filed notes alone", () => {
    const { moves, skipped } = plan([
      "1. Acme/Contact Notes.md",
      "Inbox.md",
      "1. Acme/FY2026/2026-09-08 - Acme Sync.md",
    ]);
    expect(moves).toEqual([]);
    expect(skipped).toEqual([
      { relativePath: "1. Acme/Contact Notes.md", reason: "undated" },
      { relativePath: "Inbox.md", reason: "root" },
      { relativePath: "1. Acme/FY2026/2026-09-08 - Acme Sync.md", reason: "already-filed" },
    ]);
  });

  it("keeps any sub-structure an account already has", () => {
    const { moves } = plan(["1. Acme/Site Visits/2026-03-04 - Austin.md"]);
    expect(moves[0].to).toBe("1. Acme/Site Visits/FY2026/2026-03-04 - Austin.md");
    expect(moves[0].account).toBe("1. Acme");
  });

  it("moves the undated rollups into the open year only when asked", () => {
    const paths = ["1. Acme/Customer Facts & Callouts.md", "1. Acme/Customer Site Mapping.md"];
    expect(plan(paths).moves).toEqual([]);
    expect(plan(paths).skipped.map((s) => s.reason)).toEqual(["rollup", "rollup"]);

    const { moves } = plan(paths, { includeRollups: true });
    expect(moves.map((m) => m.to)).toEqual([
      "1. Acme/FY2026/Customer Facts & Callouts.md",
      "1. Acme/FY2026/Customer Site Mapping.md",
    ]);
    expect(moves.every((m) => m.rollup)).toBe(true);
  });

  it("reads Windows-style separators and ignores non-Markdown files", () => {
    const { moves } = plan(["1. Acme\\2026-09-08 - Acme Sync.md", "1. Acme/attachment.png"]);
    expect(moves).toHaveLength(1);
    expect(moves[0].to).toBe("1. Acme/FY2026/2026-09-08 - Acme Sync.md");
  });
});

describe("isRollupName", () => {
  it("knows the app's own per-account rollups", () => {
    expect(isRollupName("Customer Facts & Callouts.md")).toBe(true);
    expect(isRollupName("Customer Site Mapping 2026-09-14.md")).toBe(true);
    expect(isRollupName("2026-09-08 - Acme Sync.md")).toBe(false);
  });
});

describe("groupMovesByAccount", () => {
  it("counts notes per account and year, in order", () => {
    const { moves } = plan([
      "1. Acme/2026-10-02 - Kickoff.md",
      "1. Acme/2026-09-08 - Sync.md",
      "1. Acme/2026-08-01 - Review.md",
      "2. Beacon/2026-09-09 - Sync.md",
    ]);
    expect(groupMovesByAccount(moves)).toEqual([
      { account: "1. Acme", total: 3, years: [{ fiscalYear: "FY2026", count: 2 }, { fiscalYear: "FY2027", count: 1 }] },
      { account: "2. Beacon", total: 1, years: [{ fiscalYear: "FY2026", count: 1 }] },
    ]);
  });
});
