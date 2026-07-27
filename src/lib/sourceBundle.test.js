import { describe, expect, it } from "vitest";
import { buildSourceBundle, extractReferencedSourceIds, formatSourceBundleForPrompt } from "./sourceBundle";

describe("sourceBundle", () => {
  it("creates stable transcript and raw-note source IDs", () => {
    const bundle = buildSourceBundle({
      transcript: "Jordan confirmed the Dallas lab rollout.\n\nPriya owns the license cleanup.",
      rawNotes: "Dana sounded worried about the timeline.",
    });

    expect(bundle.transcriptSources[0].id).toBe("T1");
    expect(bundle.rawNoteSources[0].id).toBe("N1");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[T1] Transcript");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[N1] Raw notes");
  });

  it("extracts referenced IDs in source order", () => {
    expect(extractReferencedSourceIds("Point one [T2] [N1]. Point two [T1].")).toEqual(["T1", "T2", "N1"]);
  });
});
