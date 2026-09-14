import { describe, expect, it } from "vitest";
import { acceptActivityAlternative, compareActivityRows } from "./activityComparison";

const current = [{ eventDate: "2026-09-01", sourceTitle: "Admin Sync", title: "Old title", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Old comments", agreement: "EA 1", filed: true }];
const alternative = [{ eventDate: "2026-09-01", sourceTitle: "Admin Sync", title: "Clear title", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "Supported outcome", agreement: "" }];

describe("activity alternatives", () => {
  it("matches rows by date and source and reports changed fields", () => {
    const [item] = compareActivityRows(current, alternative);
    expect(item.changedFields).toEqual(["title", "comments"]);
  });

  it("accepts one field while preserving identity and filing metadata", () => {
    const [item] = compareActivityRows(current, alternative);
    expect(acceptActivityAlternative(current, alternative, item, "comments")[0]).toMatchObject({ title: "Old title", comments: "Supported outcome", agreement: "EA 1", filed: true });
  });
});
