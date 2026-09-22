import { describe, expect, it } from "vitest";
import { isPdfFile } from "./slidePdf";

// Rendering needs a browser (pdf.js + canvas) and is exercised against the
// running app; what can be pinned down here is how a PDF is recognised.
describe("isPdfFile", () => {
  it("recognises a PDF by type or by extension, and nothing else", () => {
    expect(isPdfFile({ type: "application/pdf", name: "deck" })).toBe(true);
    // Some browsers hand over an empty type for a dragged file.
    expect(isPdfFile({ type: "", name: "Deck Export.PDF" })).toBe(true);
    expect(isPdfFile({ type: "image/png", name: "slide.png" })).toBe(false);
    expect(isPdfFile(null)).toBe(false);
  });
});
