import { describe, expect, it } from "vitest";
import { isFiled, markFiled } from "@/lib/filedRows";

const filed = { eventDate: "2026-09-05", title: "Dallas Lab Visit - SystemLink Rack Review", improvedTitle: "", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Summary: x.", sourceTitle: "Acme Dallas Visit" };

describe("filed rows", () => {
  it("matches by title, by improved title, and by source note on the same day", () => {
    const map = markFiled({}, filed, true);
    expect(isFiled(map, { eventDate: "2026-09-05", title: "Dallas Lab Visit - SystemLink Rack Review" })).toBe(true);
    // A regenerated report titles the same note differently; the source note is what identifies it.
    expect(isFiled(map, { eventDate: "2026-09-05", title: "Acme Dallas Visit", improvedTitle: "Acme Aerospace Dallas Lab Visit", sourceTitle: "acme dallas visit" })).toBe(true);
    // The improved title is also what an older report may carry in its Title column.
    expect(isFiled(map, { eventDate: "2026-09-05", title: "Other", improvedTitle: "Dallas Lab Visit - SystemLink Rack Review" })).toBe(true);
    expect(isFiled(map, { eventDate: "2026-09-06", title: "Acme Dallas Visit", sourceTitle: "Acme Dallas Visit" })).toBe(false);
    expect(isFiled(map, { eventDate: "2026-09-05", title: "Something else" })).toBe(false);
  });

  it("unticking removes the entry however it matched", () => {
    const map = markFiled({}, filed, true);
    const cleared = markFiled(map, { eventDate: "2026-09-05", title: "Acme Dallas Visit", sourceTitle: "Acme Dallas Visit" }, false);
    expect(isFiled(cleared, filed)).toBe(false);
  });
});
