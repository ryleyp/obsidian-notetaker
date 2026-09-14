import { describe, expect, it } from "vitest";
import { applyImprovement, parseImprovement } from "./activityImprovement";

const row = { title: "Admin Sync", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Reviewed licensing.", eventDate: "2026-08-12", agreement: "EA 123", sourceTitle: "Acme Notes", origin: "note", filed: true, verify: "passed", suggestedType: "old" };
describe("applying activity refinements", () => {
  it("preserves identity metadata and clears obsolete verification and suggestions only on edited rows", () => {
    const next = applyImprovement([row, row], [{ index: 0, ...row, title: "Licensing Sync", comments: "Confirmed the licensing plan.", eventDate: "wrong", filed: false, agreement: "wrong" }]);
    expect(next[0]).toMatchObject({ title: "Licensing Sync", eventDate: row.eventDate, agreement: row.agreement, sourceTitle: row.sourceTitle, filed: true, origin: "generated", verify: "", suggestedType: "", review: true });
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
