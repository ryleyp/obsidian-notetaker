import { describe, expect, it } from "vitest";
import { findExactMeetingNote, titleFromTranscriptFilename } from "./transcriptFiles";

describe("titleFromTranscriptFilename", () => {
  it("preserves the exact filename while removing the Markdown extension", () => {
    expect(titleFromTranscriptFilename("2026-03-04 - Account Sync - Acme Aerospace.md"))
      .toBe("2026-03-04 - Account Sync - Acme Aerospace");
  });

  it("preserves punctuation, spacing, underscores, and additional dots", () => {
    expect(titleFromTranscriptFilename("  Account_Sync - Site 4.v2.TXT"))
      .toBe("  Account_Sync - Site 4.v2");
  });
});

describe("findExactMeetingNote", () => {
  it("finds only the note whose filename exactly matches the title", () => {
    const notes = [
      { filename: "2026-03-04 - Account Sync - Acme Aerospace (1).md", relativePath: "Acme/duplicate.md" },
      { filename: "2026-03-04 - Account Sync - Acme Aerospace.md", relativePath: "Acme/original.md" },
    ];

    expect(findExactMeetingNote(notes, "2026-03-04 - Account Sync - Acme Aerospace"))
      .toEqual(notes[1]);
  });

  it("does not fuzzy-match a similarly named note", () => {
    expect(findExactMeetingNote(
      [{ filename: "2026-03-04 - Account Sync - Acme Aerospace (1).md" }],
      "2026-03-04 - Account Sync - Acme Aerospace"
    )).toBeNull();
  });
});
