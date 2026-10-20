import { describe, expect, it } from "vitest";
import { buildThreadScanText } from "./threadScan";
import { extractLocalSensitiveEntities } from "./privacy";

const base = { title: "Sync", thread: "Can you confirm the count?", context: "", ownerNames: [] };

describe("buildThreadScanText", () => {
  // An updated thread sends its previous note as a source. A link saved in
  // that note must reach the Privacy Review scan instead of being found for the
  // first time by the outbound boundary after the user approved the review.
  it("includes the existing note so its links are reviewed", () => {
    const text = buildThreadScanText({
      ...base,
      existingNote: "# Old note\n\nSource: https://example.test/share/abc123",
    });
    expect(text).toContain("https://example.test/share/abc123");
    expect(extractLocalSensitiveEntities(text).some((entity) => entity.type === "url")).toBe(true);
  });

  it("leaves the existing note out when none is sent", () => {
    const text = buildThreadScanText({ ...base, existingNote: "" });
    expect(text).not.toContain("Old note");
    expect(extractLocalSensitiveEntities(text).some((entity) => entity.type === "url")).toBe(false);
  });

  it("applies saved corrections and replacements to every input, existing note included", () => {
    const text = buildThreadScanText({
      ...base,
      participants: "Marlo (admin)",
      existingNote: "Marlo owns the rollout and Riley follows up.",
      corrections: [{ find: "Riley", replace: "Ryley" }],
      replacements: [{ original: "Marlo", alias: "PRIVATE_A1", restored: "Marlowe" }],
    });
    expect(text).not.toContain("Marlo");
    expect(text).toContain("PRIVATE_A1 (admin)");
    expect(text).toContain("PRIVATE_A1 owns the rollout and Ryley follows up.");
  });

  it("tolerates missing optional fields", () => {
    expect(buildThreadScanText({ title: "T", thread: "x" })).toBe("T\n\nx");
  });
});
