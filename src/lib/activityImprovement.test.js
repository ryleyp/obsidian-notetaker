import { describe, expect, it } from "vitest";
import { applyImprovement, fitSourcesToBudget, improvementFingerprint, parseImprovement, pendingFields } from "./activityImprovement";

const row = { title: "Admin Sync", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Reviewed licensing.", eventDate: "2026-08-12", agreement: "EA 123", sourceTitle: "Acme Notes", origin: "note", filed: true, verify: "passed", suggestedType: "old" };
describe("applying activity refinements", () => {
  it("preserves identity metadata and clears obsolete verification and suggestions only on edited rows", () => {
    const next = applyImprovement([row, row], [{ index: 0, ...row, title: "Licensing Sync", comments: "Confirmed the licensing plan.", eventDate: "wrong", filed: false, agreement: "wrong" }]);
    expect(next[0]).toMatchObject({ title: "Admin Sync", improvedTitle: "Licensing Sync", eventDate: row.eventDate, agreement: row.agreement, sourceTitle: row.sourceTitle, filed: true, origin: "generated", verify: "", suggestedType: "", review: true });
    expect(next[1]).toBe(row);
    expect(row.title).toBe("Admin Sync");
  });
  it("accepts conversational replies without table changes", () => {
    expect(parseImprovement('{"message":"Which outcome should I emphasize?","changes":[]}', [row]).changes).toEqual([]);
  });
  it("drops unchanged proposals", () => {
    expect(parseImprovement(JSON.stringify({ message: "Already concise.", changes: [{ index: 0, ...row }] }), [row]).changes).toEqual([]);
  });
});

describe("improved titles stay beside the original", () => {
  it("drops a proposal whose title only repeats the row's improved title", () => {
    const rows = [{ title: "Acme Dallas Visit", improvedTitle: "Acme Aerospace Dallas Lab Visit - SystemLink Review", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Summary: x." }];
    const same = JSON.stringify({ message: "ok", changes: [{ index: 0, title: "Acme Aerospace Dallas Lab Visit - SystemLink Review", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Summary: x." }] });
    expect(parseImprovement(same, rows).changes).toEqual([]);
    const better = JSON.stringify({ message: "ok", changes: [{ index: 0, title: "Acme Aerospace Dallas Lab Visit - SystemLink Rack Review", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Summary: x." }] });
    expect(parseImprovement(better, rows).changes).toHaveLength(1);
  });

  it("does not record an improvedTitle when the proposal keeps the same title", () => {
    const next = applyImprovement([row], [{ index: 0, ...row, comments: "Tighter." }]);
    expect(next[0].title).toBe("Admin Sync");
    expect(next[0].improvedTitle).toBe("");
    expect(next[0].comments).toBe("Tighter.");
  });

  it("keeps an earlier improvedTitle when a later field-only apply passes the original title back", () => {
    const withTitle = applyImprovement([row], [{ index: 0, ...row, title: "Licensing Sync" }]);
    const next = applyImprovement(withTitle, [{ index: 0, ...withTitle[0], title: row.title, comments: "Tighter." }]);
    expect(next[0].improvedTitle).toBe("Licensing Sync");
  });

  it("treats a title as taken once it sits in improvedTitle", () => {
    const change = { index: 0, ...row, title: "Licensing Sync", comments: "Tighter." };
    expect(pendingFields(change, row)).toEqual(["title", "comments"]);
    const applied = applyImprovement([row], [change])[0];
    expect(pendingFields(change, applied)).toEqual([]);
  });

  it("ignores decorations when deciding whether a proposal is stale", () => {
    const a = improvementFingerprint([row]);
    const b = improvementFingerprint([{ ...row, filed: false, verify: "", lint: [{ code: "x" }], agreement: "changed" }]);
    const c = improvementFingerprint([{ ...row, comments: "edited" }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("fitSourcesToBudget", () => {
  const source = (date, size) => ({ date, title: `${date} - Note`, content: "x".repeat(size) });

  it("keeps everything when it fits", () => {
    const sources = [source("2026-01-05", 50), source("2026-02-05", 50)];
    expect(fitSourcesToBudget(sources, 100_000)).toEqual({ kept: sources, dropped: 0 });
  });

  it("drops the oldest notes first and keeps the caller's order", () => {
    const sources = [source("2026-01-05", 400), source("2026-03-05", 400), source("2026-02-05", 400)];
    // Room for two of the three notes, whichever two.
    const budget = JSON.stringify(sources.slice(0, 2)).length;
    const { kept, dropped } = fitSourcesToBudget(sources, budget);
    expect(dropped).toBe(1);
    expect(kept.map((s) => s.date)).toEqual(["2026-03-05", "2026-02-05"]);
  });

  it("drops everything rather than overflowing when nothing fits", () => {
    const sources = [source("2026-01-05", 400)];
    expect(fitSourcesToBudget(sources, 10)).toEqual({ kept: [], dropped: 1 });
    expect(fitSourcesToBudget(sources, 0)).toEqual({ kept: [], dropped: 1 });
    expect(fitSourcesToBudget(sources, -5)).toEqual({ kept: [], dropped: 1 });
  });

  it("never returns more than the budget allows", () => {
    const sources = Array.from({ length: 40 }, (_, i) => source(`2026-01-${String(i + 1).padStart(2, "0")}`, 500));
    const { kept } = fitSourcesToBudget(sources, 5_000);
    expect(JSON.stringify(kept).length).toBeLessThanOrEqual(5_000);
  });

  it("handles an empty list", () => {
    expect(fitSourcesToBudget([], 1000)).toEqual({ kept: [], dropped: 0 });
  });
});
