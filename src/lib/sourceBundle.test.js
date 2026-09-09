import { describe, expect, it } from "vitest";
import {
  stripCitationMarkers,
  buildSourceBundle,
  extractReferencedSourceIds,
  formatSourceBundleForPrompt,
  formatTranscriptArchive,
} from "./sourceBundle";

describe("sourceBundle", () => {
  it("creates stable transcript and raw-note source IDs", () => {
    const bundle = buildSourceBundle({
      transcript: "Jordan confirmed the Dallas lab rollout.\n\nPriya owns the license cleanup.",
      rawNotes: "Dana sounded worried about the timeline.",
      emailThread: "From: Sam\nSubject: License cleanup\n\nDecision: use the shared portal.",
      existingNote: "Old note with a manually recorded attendee title.",
    });

    expect(bundle.transcriptSources[0].id).toBe("T1");
    expect(bundle.rawNoteSources[0].id).toBe("N1");
    expect(bundle.emailSources[0].id).toBe("E1");
    expect(bundle.existingNoteSources[0].id).toBe("O1");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[T1] Transcript");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[N1] Raw notes");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[E1] Email thread");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[O1] Existing meeting note");
  });

  it("extracts referenced IDs in source order", () => {
    expect(extractReferencedSourceIds("Point one [T2] [E1] [N1]. Point two [T1] [O1].")).toEqual(["T1", "T2", "N1", "E1", "O1"]);
  });

  it("keeps two recordings of one meeting as separately labeled transcript sources", () => {
    const bundle = buildSourceBundle({
      transcript: "Teams captured the opening discussion.",
      extendedTranscript: "Voice Memos captured the opening discussion and the follow-up decision.",
      rawNotes: "The follow-up matters.",
    });

    expect(bundle.transcriptSources).toEqual([
      expect.objectContaining({ id: "T1", label: "Primary transcript" }),
      expect.objectContaining({ id: "T2", label: "Extended transcript" }),
    ]);
    expect(bundle.rawNoteSources[0].id).toBe("N1");
    expect(formatSourceBundleForPrompt(bundle)).toContain("[T2] Extended transcript");
  });

  it("formats both recordings clearly when they are archived", () => {
    expect(formatTranscriptArchive("Teams text", "Voice Memo text")).toBe(
      "## Primary transcript\n\nTeams text\n\n---\n\n## Extended transcript\n\nVoice Memo text"
    );
    expect(formatTranscriptArchive("Only one", "")).toBe("Only one");
  });
});

describe("stripCitationMarkers", () => {
  it("removes single and chained markers and the space before them", () => {
    expect(stripCitationMarkers("- Dana approved the rollout. [T1]")).toBe("- Dana approved the rollout.");
    expect(stripCitationMarkers("- Budget is 40 seats [T2] [N1]\n- Next sync Friday [E1][O1]")).toBe(
      "- Budget is 40 seats\n- Next sync Friday"
    );
  });

  it("leaves non-citation brackets and checkboxes alone", () => {
    const text = "- [ ] Send runbook — **Owner:** Ryley | **Due:** TBD\n- [x] Done [link](http://x)";
    expect(stripCitationMarkers(text)).toBe(text);
    expect(stripCitationMarkers("")).toBe("");
  });
});
