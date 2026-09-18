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
    expect(prompt).toContain('Attribute a commitment to "Ryley" ONLY when the evidence shows the CSM said it');
    expect(prompt).toContain("NOT necessarily a speaker");
    expect(prompt).toContain("**Owner:** CS/CSM team");
  });

  it("omits the identity block when no ownerNames are configured", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");
    expect(prompt).not.toContain("THE CSM (NOTE OWNER)");
  });
});

describe("buildPrompt meeting-lead context", () => {
  it("treats the CSM's context as authoritative for who led and the CSM's role", () => {
    const prompt = buildPrompt("Speaker 1: I'll send the deck.", "Demo", [], "Jordan (FAE) ran the demo; I only observed.", {
      ownerNames: ["Ryley"],
    });
    expect(prompt).toContain("WHO LED / THE CSM'S ROLE");
    expect(prompt).toContain("AUTHORITATIVE");
    expect(prompt).toContain("Jordan (FAE) ran the demo; I only observed.");
    expect(prompt).toContain("do NOT mention that");
    expect(prompt).toContain("Never write that the CSM observed");
  });
});

describe("buildPrompt goal contributions", () => {
  const goals = [{ name: "Case studies", target: "4 completed" }, { name: "Account growth", target: "7%" }];

  it("asks for contributions only against the configured goals", () => {
    const prompt = buildPrompt("We kicked off the case study.", "Sync", [], "", { goals });
    expect(prompt).toContain("## Goal Contributions");
    expect(prompt).toContain("- Case studies (target: 4 completed)");
    expect(prompt).toContain("- Account growth (target: 7%)");
    expect(prompt).toContain("Never invent a goal that is not listed");
    expect(prompt).toContain("Nothing noted.");
    // The section sits before the Salesforce entry, which stays unchanged.
    expect(prompt.indexOf("## Goal Contributions")).toBeLessThan(prompt.indexOf("## SFDC Activity Entry"));
  });

  it("omits the section entirely when no goals are configured", () => {
    const prompt = buildPrompt("We kicked off the case study.", "Sync");
    expect(prompt).not.toContain("Goal Contributions");
  });
});

describe("buildPrompt SFDC entry postability", () => {
  it("asks for a Salesforce title and a reportable verdict, and classifies with the full guidance", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");
    expect(prompt).toContain("**Activity Title:**");
    expect(prompt).toContain("**Reportable:**");
    expect(prompt).toContain("ACTIVITY TITLE");
    expect(prompt).toContain("CLASSIFICATION PROCESS");
    expect(prompt).toContain("IMPORTANT DEFINITION — EA Admin");
    // The real filed examples travel with the taxonomy now.
    expect(prompt).toContain("Example: \"Beacon Systems RF User Group");
  });

  it("states the postability check the entry must pass", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync");
    expect(prompt).toContain("POSTABILITY CHECK");
    expect(prompt).toContain("No \"I\", \"we\", \"our\", \"my\"");
    expect(prompt).toContain("No \"CSM attended / observed / listened\"");
    expect(prompt).toContain("Region: [X], Attendees: [# or TBD]");
  });
});

describe("buildPrompt health scorecard sessions", () => {
  it("adds the scorecard layer for a health review, between Meeting Notes and the callouts", () => {
    const prompt = buildPrompt("We set adoption to yellow and agreed the pilot commitment.", "Acme CS Health Review");

    expect(prompt).toContain("## Health Ratings Captured");
    expect(prompt).toContain("## Scorecard Feedback");
    expect(prompt).toContain("## Led Versus Relayed");
    expect(prompt).toContain("## Commitments For Next Review");
    expect(prompt.indexOf("## Meeting Notes")).toBeLessThan(prompt.indexOf("## Health Ratings Captured"));
    expect(prompt.indexOf("## Health Ratings Captured")).toBeLessThan(
      prompt.indexOf("## Things NI SW Customer Success Should Take Note Of")
    );
  });

  it("leaves an ordinary meeting note untouched", () => {
    const prompt = buildPrompt("Jordan discussed the Dallas lab rollout.", "Planning Sync");
    expect(prompt).not.toContain("## Health Ratings Captured");
    expect(prompt).not.toContain("Scorecard Feedback");
  });

  it("detects the session from the CSM's own context when the title says nothing", () => {
    const prompt = buildPrompt(
      "Jordan walked through the numbers.",
      "Catch up",
      [],
      "Scorecard review with leadership: overall health and the adoption rating."
    );
    expect(prompt).toContain("## Health Ratings Captured");
  });

  it("tailors the sections to the kind of session", () => {
    const coaching = buildPrompt("We reworded the adoption cell.", "1x1 - scorecard feedback");
    expect(coaching).toContain("## Scorecard Feedback");
    expect(coaching).not.toContain("## Leadership Questions Asked");
  });

  it("states the CSM's pronouns when they are configured", () => {
    const prompt = buildPrompt("Jordan discussed the rollout.", "Planning Sync", [], "", {
      ownerNames: ["Ryley"],
      ownerPronouns: "she/her",
    });
    expect(prompt).toContain("The CSM's pronouns are she/her");
    expect(buildPrompt("Jordan discussed the rollout.", "Planning Sync", [], "", { ownerNames: ["Ryley"] }))
      .not.toContain("pronouns are");
  });
});
