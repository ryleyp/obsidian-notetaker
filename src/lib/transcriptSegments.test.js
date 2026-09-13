import { describe, expect, it } from "vitest";
import {
  assembleTurns,
  formatSegmentsForPrompt,
  parseBoundaries,
  splitIntoSegments,
} from "./transcriptSegments";

const TRANSCRIPT = "Hello everyone, thanks for joining. Yeah, happy to be here. So where are we on the migration? We finished the Dallas site last week.";

describe("splitIntoSegments", () => {
  it("splits on sentence boundaries without losing a character", () => {
    const segments = splitIntoSegments(TRANSCRIPT, { minWords: 1 });
    expect(segments).toHaveLength(4);
    expect(segments.join("")).toBe(TRANSCRIPT);
  });

  it("folds short lines together so timestamped exports don't explode into tiny segments", () => {
    const timestamped = "10:23\nSo where are we on the migration?\n\n10:24\nWe finished Dallas last week.\n";
    const fine = splitIntoSegments(timestamped, { minWords: 1 });
    const coalesced = splitIntoSegments(timestamped);
    expect(coalesced.length).toBeLessThan(fine.length);
    expect(coalesced.join("")).toBe(timestamped);
    // A bare timestamp never stands alone as its own segment.
    expect(coalesced.some((s) => /^\s*\d{1,2}:\d{2}\s*$/.test(s))).toBe(false);
  });

  it("breaks punctuation-free dictation into bounded runs", () => {
    const rambling = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const segments = splitIntoSegments(rambling, { maxWords: 25 });
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.join("")).toBe(rambling);
    for (const segment of segments) {
      expect(segment.trim().split(/\s+/).length).toBeLessThanOrEqual(25);
    }
  });

  it("keeps decimals intact so a turn boundary can never cut a number in half", () => {
    const text = "We had 2.5 liters over a 3.5 year period. Next quarter looks better.";
    const segments = splitIntoSegments(text, { minWords: 1 });
    expect(segments.join("")).toBe(text);
    expect(segments).toHaveLength(2);
    expect(segments.every((s) => !/\d\.$/.test(s.trim()))).toBe(true);
  });

  it("preserves newlines and returns nothing for blank input", () => {
    const multiline = "First line.\n\nSecond line.\nThird.";
    expect(splitIntoSegments(multiline).join("")).toBe(multiline);
    expect(splitIntoSegments("   ")).toEqual([]);
    expect(splitIntoSegments(undefined)).toEqual([]);
  });
});

describe("formatSegmentsForPrompt", () => {
  it("numbers segments from 1", () => {
    expect(formatSegmentsForPrompt(["One. ", "Two."])).toBe("[1] One.\n[2] Two.");
  });
});

describe("parseBoundaries", () => {
  it("reads plain, ranged, and decorated lines", () => {
    const text = "1: Speaker 1\n4-8: Speaker 2\n**9:** Dana\n12. Speaker 1";
    expect(parseBoundaries(text, 20)).toEqual([
      { start: 0, label: "Speaker 1" },
      { start: 3, label: "Speaker 2" },
      { start: 8, label: "Dana" },
      { start: 11, label: "Speaker 1" },
    ]);
  });

  it("ignores commentary and out-of-range numbers", () => {
    const text = "Here is the segmentation:\n1: Speaker 1\n99: Speaker 2\nThat's my best guess.";
    expect(parseBoundaries(text, 5)).toEqual([{ start: 0, label: "Speaker 1" }]);
    expect(parseBoundaries("", 5)).toEqual([]);
  });
});

describe("assembleTurns", () => {
  const segments = ["A. ", "B. ", "C. ", "D."];

  it("rebuilds turns from boundary starts", () => {
    const turns = assembleTurns(segments, [
      { start: 0, label: "Speaker 1" },
      { start: 2, label: "Speaker 2" },
    ]);
    expect(turns).toEqual([
      { label: "Speaker 1", text: "A. B." },
      { label: "Speaker 2", text: "C. D." },
    ]);
  });

  it("keeps every segment when boundaries are out of order, duplicated, or start late", () => {
    const turns = assembleTurns(segments, [
      { start: 3, label: "Speaker 2" },
      { start: 1, label: "Speaker 1" },
      { start: 1, label: "Speaker 1" },
    ]);
    expect(turns.map((t) => t.text).join(" ")).toBe("A. B. C. D.");
  });

  it("merges consecutive turns with the same label", () => {
    const turns = assembleTurns(segments, [
      { start: 0, label: "Dana" },
      { start: 2, label: "Dana" },
    ]);
    expect(turns).toEqual([{ label: "Dana", text: "A. B. C. D." }]);
  });

  it("falls back to one turn when the model returned nothing usable", () => {
    expect(assembleTurns(segments, [])).toEqual([{ label: "Speaker 1", text: "A. B. C. D." }]);
    expect(assembleTurns([], [{ start: 0, label: "Speaker 1" }])).toEqual([]);
  });
});

describe("round trip", () => {
  it("emits every word of the transcript exactly once", () => {
    const segments = splitIntoSegments(TRANSCRIPT, { minWords: 1 });
    const boundaries = parseBoundaries("1: Speaker 1\n2: Speaker 2\n3: Speaker 1\n4: Speaker 2", segments.length);
    const turns = assembleTurns(segments, boundaries);
    expect(turns.map((t) => t.text).join(" ")).toBe(TRANSCRIPT);
  });
});
