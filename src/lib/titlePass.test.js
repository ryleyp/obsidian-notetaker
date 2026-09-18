import { describe, expect, it } from "vitest";
import { applyImprovedTitles, parseTitleProposals, rowsNeedingTitles } from "@/lib/titlePass";

const rows = [
  { title: "Acme Dallas Visit", improvedTitle: "", comments: "Summary: x." },
  { title: "Licensing Sync", improvedTitle: "Acme Aerospace Licensing Sync - True-Up Ownership", comments: "Summary: y." },
  { title: "RE: license question", improvedTitle: "", comments: "Summary: z." },
];

describe("title pass", () => {
  it("targets only rows without an improved title", () => {
    expect(rowsNeedingTitles(rows).map((t) => t.index)).toEqual([0, 2]);
  });

  it("accepts titles for the rows that were sent and drops the rest", () => {
    const sent = rowsNeedingTitles(rows).map(({ index, row }) => ({ index, ...row }));
    const reply = JSON.stringify({ titles: [
      { index: 0, title: "  Acme Aerospace Dallas Lab Visit -  SystemLink Rack Review " },
      { index: 1, title: "Not asked for" },
      { index: 2, title: "" },
      { index: 0, title: "Duplicate" },
      { index: 9, title: "Out of range" },
      { index: 2, title: "t".repeat(201) },
    ] });
    expect(parseTitleProposals(reply, sent)).toEqual([{ index: 0, title: "Acme Aerospace Dallas Lab Visit - SystemLink Rack Review" }]);
  });

  it("tolerates fences and garbage without throwing", () => {
    expect(parseTitleProposals("```json\n{\"titles\":[{\"index\":0,\"title\":\"A fine title here\"}]}\n```", [{ index: 0 }])).toHaveLength(1);
    expect(parseTitleProposals("not json", [{ index: 0 }])).toEqual([]);
  });

  it("fills empty improved titles and never overwrites an existing one", () => {
    const next = applyImprovedTitles(rows, [{ index: 0, title: "Acme Dallas Lab Visit - Rack Review" }, { index: 1, title: "Should not land" }]);
    expect(next[0].improvedTitle).toBe("Acme Dallas Lab Visit - Rack Review");
    expect(next[0].title).toBe("Acme Dallas Visit");
    expect(next[1].improvedTitle).toBe("Acme Aerospace Licensing Sync - True-Up Ownership");
    expect(next[2]).toBe(rows[2]);
  });
});
