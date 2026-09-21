import { describe, expect, it } from "vitest";
import { MAX_SLIDES, formatSlidesForArchive, slideMessageContent, validateSlidePayload } from "./slides";

const slide = (over = {}) => ({ id: "a", name: "deck-01.png", mediaType: "image/jpeg", data: "QUJD", ...over });

describe("validateSlidePayload", () => {
  it("accepts a normal batch", () => {
    expect(validateSlidePayload([slide(), slide({ id: "b" })])).toBe("");
  });

  it("refuses what cannot be read", () => {
    expect(validateSlidePayload([])).toMatch(/at least one/i);
    expect(validateSlidePayload(Array.from({ length: MAX_SLIDES + 1 }, (_, i) => slide({ id: String(i) })))).toMatch(/at most/i);
    expect(validateSlidePayload([slide({ data: "" })])).toMatch(/no image data/i);
    expect(validateSlidePayload([slide({ mediaType: "application/pdf" })])).toMatch(/not a supported image/i);
    expect(validateSlidePayload([slide({ data: "x".repeat(2_100_000) })])).toMatch(/too large/i);
  });
});

describe("slideMessageContent", () => {
  it("sends the image first, then a prompt that names the slide's position", () => {
    const content = slideMessageContent(slide(), 2, 5);
    expect(content[0]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } });
    expect(content[1].type).toBe("text");
    expect(content[1].text).toContain("Slide 3 of 5");
    expect(content[1].text).toContain("deck-01.png");
  });
});

describe("formatSlidesForArchive", () => {
  it("numbers slides by deck position and skips ones with nothing read", () => {
    const archive = formatSlidesForArchive([
      { name: "a.png", text: "# Roadmap\n- Q3: SystemLink 2026" },
      { name: "b.png", text: "   " },
      { name: "c.png", text: "Table" },
    ]);
    expect(archive).toContain("### Slide 1 — a.png");
    // Deck position, so it matches the note's [S3] citation.
    expect(archive).toContain("### Slide 3 — c.png");
    expect(archive).not.toContain("b.png");
  });

  it("is empty when nothing was read", () => {
    expect(formatSlidesForArchive([])).toBe("");
  });
});
