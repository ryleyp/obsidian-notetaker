import { describe, expect, it } from "vitest";
import { buildPrompt } from "./route";
import { buildSourceBundle } from "@/lib/sourceBundle";

describe("buildPrompt", () => {
  it("includes user and site callouts before action items", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");

    expect(prompt).toContain("## User-Level Callouts");
    expect(prompt).toContain("## Site-Level Callouts");
    expect(prompt).toContain("specific customer users");
    expect(prompt).toContain("specific customer sites");
    expect(prompt.indexOf("## User-Level Callouts")).toBeLessThan(prompt.indexOf("## Action Items"));
    expect(prompt.indexOf("## Site-Level Callouts")).toBeLessThan(prompt.indexOf("## Action Items"));
  });

  it("keeps the required sections without adding outcomes", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");

    expect(prompt).toContain("## Executive Summary");
    expect(prompt).toContain("## Meeting Notes");
    expect(prompt).not.toContain("## Outcomes");
  });

  it("adds source citation instructions", () => {
    const prompt = buildPrompt(
      "Jordan discussed the Dallas lab rollout.",
      "Planning Sync",
      [],
      "Raw note: Priya owns the next step."
    );

    expect(prompt).toContain("[T1] Transcript");
    expect(prompt).toContain("[N1] Raw notes");
    expect(prompt).toContain("SOURCE CITATION RULES");
  });

  it("tells Claude how to reconcile overlapping recordings of one meeting", () => {
    const transcript = "Teams captured the opening and a decision.";
    const extendedTranscript = "Voice Memos captured the opening, the decision, and a follow-up.";
    const sourceBundle = buildSourceBundle({ transcript, extendedTranscript });
    const prompt = buildPrompt(transcript, "Planning Sync", [], "", { sourceBundle });

    expect(prompt).toContain("MULTIPLE TRANSCRIPTS OF THE SAME MEETING");
    expect(prompt).toContain("[T1] Primary transcript");
    expect(prompt).toContain("[T2] Extended transcript");
    expect(prompt).toContain("do not repeat a point, decision, or action item");
  });

  it("requests a separable follow-up email only when selected", () => {
    const withFollowUp = buildPrompt("Jordan discussed the rollout.", "Planning Sync", [], "", {
      followUp: { enabled: true, audience: "internal", tone: "technical" },
    });
    const withoutFollowUp = buildPrompt("Jordan discussed the rollout.", "Planning Sync");

    expect(withFollowUp).toContain("FOLLOW-UP EMAIL OUTPUT (required)");
    expect(withFollowUp).toContain("## Follow-Up Email Draft");
    expect(withFollowUp).toContain("Audience: internal");
    expect(withFollowUp).toContain("Tone: technical");
    expect(withoutFollowUp).not.toContain("## Follow-Up Email Draft");
  });

  it("treats an existing note as a secondary migration source", () => {
    const sourceBundle = buildSourceBundle({
      transcript: "Dana confirmed the Dallas rollout.",
      existingNote: "Dana is the EA admin. The old note used a legacy layout.",
    });
    const prompt = buildPrompt(
      "Dana confirmed the Dallas rollout.",
      "Planning Sync",
      [],
      "",
      { sourceBundle }
    );

    expect(prompt).toContain("[O1] Existing meeting note");
    expect(prompt).toContain("EXISTING NOTE MIGRATION");
    expect(prompt).toContain("The transcript is authoritative");
    expect(prompt).toContain("Use [O#]");
  });

  it("carries no note-template or recipe instruction", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");
    expect(prompt).not.toContain("TEMPLATE AND RECIPE");
    expect(prompt).not.toContain("Selected note template");
    expect(prompt).not.toContain("Selected recipe");
  });

  // Meeting Notes is deliberately uncapped so it can serve as the record of
  // the meeting. The SFDC Activity Entry cap is a Salesforce field limit, not
  // a style preference — exceeding it truncates in the CRM — so the two must
  // not be relaxed together.
  it("leaves Meeting Notes uncapped but keeps the Salesforce field limit", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");

    expect(prompt).toContain("must be at most 120 words and 800 characters or fewer");
    expect(prompt).not.toContain("Executive Summary and Meeting Notes sections together must be 120 words");
    expect(prompt).toMatch(/Provide complete, consolidated bulleted notes/);
  });

  // The note format deliberately excludes sentiment analysis: notes record
  // stated positions as facts, and consolidation keeps detail without repeats.
  it("consolidates without sentiment commentary", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");

    expect(prompt).not.toContain("## Sentiment & Vibe");
    expect(prompt).toContain("State each fact, decision, and detail exactly once");
    expect(prompt).toContain("Do not restate items already listed under Action Items");
  });

  it("tells migrations to drop old sentiment sections but keep their facts", () => {
    const sourceBundle = buildSourceBundle({
      transcript: "Dana confirmed the Dallas rollout.",
      existingNote: "## Sentiment & Vibe\n\nDana seemed frustrated about the timeline.",
    });
    const prompt = buildPrompt("Dana confirmed the Dallas rollout.", "Planning Sync", [], "", { sourceBundle });

    expect(prompt).toContain('Older notes may contain a "Sentiment & Vibe" section');
    expect(prompt).toContain("Drop it entirely");
  });

  // The SFDC entry is pasted into a Salesforce field that truncates. The
  // "write exhaustively" instruction for Meeting Notes must not bleed into it,
  // so the cap is stated both in the rules block and inline at the section.
  it("caps the SFDC entry inline and exempts it from the exhaustive instruction", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");

    expect(prompt).toContain("must be 120 words or fewer and 800 characters or fewer");
    expect(prompt).toContain("applies to Meeting Notes and NOT to this section");
    expect(prompt).toContain("must be at most 120 words and 800 characters or fewer");
  });
});

describe("buildPrompt CSM identity", () => {
  it("names the CSM and demands attributed first-person commitments when ownerNames are set", () => {
    const prompt = buildPrompt("I'll send the rollout summary tomorrow.", "Planning Sync", [], "", {
      ownerNames: ["Ryley", "Ry"],
    });
    expect(prompt).toContain("THE CSM (NOTE OWNER)");
    expect(prompt).toContain("known as: Ryley, Ry");
    expect(prompt).toContain('attribute every commitment this person makes to "Ryley"');
    expect(prompt).toContain("**Owner:** CS/CSM team");
  });

  it("omits the identity block when no ownerNames are configured", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");
    expect(prompt).not.toContain("THE CSM (NOTE OWNER)");
  });
});
