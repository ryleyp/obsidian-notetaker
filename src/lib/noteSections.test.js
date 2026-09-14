import { describe, expect, it } from "vitest";
import { changedNoteSections, replaceNoteSection } from "./noteSections";

describe("note section alternatives", () => {
  const current = "# Meeting\n\n## Summary\nOld summary.\n\n## Actions\n- Keep this.\n";
  const alternative = "# Meeting\n\n## Summary\nClearer summary.\n\n## Actions\n- Keep this.\n";

  it("identifies only changed sections", () => {
    expect(changedNoteSections(current, alternative).map((section) => section.key)).toEqual(["summary"]);
  });

  it("accepts one section without replacing the rest of the note", () => {
    expect(replaceNoteSection(current, alternative, "summary")).toBe("# Meeting\n\n## Summary\nClearer summary.\n\n## Actions\n- Keep this.\n");
  });
});
