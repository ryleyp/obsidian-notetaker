import { describe, expect, it } from "vitest";
import {
  HEALTH_PILLARS,
  detectHealthSession,
  disallowedPronouns,
  healthSessionPrompt,
  healthSessionSections,
  lintHealthNote,
  requiredHealthSections,
} from "./healthSession";

describe("detectHealthSession", () => {
  it("recognises a named leadership review from the title alone", () => {
    const result = detectHealthSession({ title: "Acme CS Health Review", transcript: "ordinary discussion" });
    expect(result.isHealthSession).toBe(true);
    expect(result.type).toBe("leadership_review");
  });

  it("separates a pre-sync from the review it prepares for", () => {
    expect(detectHealthSession({ title: "Pre-Sync for the Acme Quarterly Review" }).type).toBe("am_presync");
  });

  it("treats a manager 1x1 working the scorecard as coaching", () => {
    expect(detectHealthSession({ title: "1x1 - scorecard feedback" }).type).toBe("coaching");
  });

  it("recognises a cross-account roll-up", () => {
    expect(detectHealthSession({ title: "CSM team meeting - health scoring across accounts" }).type).toBe("portfolio_rollup");
  });

  it("leaves an ordinary meeting alone", () => {
    const result = detectHealthSession({ title: "Weekly sync", transcript: "We talked about the yellow cable and the red label." });
    expect(result.isHealthSession).toBe(false);
    expect(healthSessionPrompt(result)).toBe("");
  });

  it("needs several scorecard phrases before claiming an untitled meeting", () => {
    expect(detectHealthSession({ title: "Weekly sync", transcript: "the scorecard is due" }).isHealthSession).toBe(false);
    const rich = detectHealthSession({
      title: "Weekly sync",
      transcript: "the scorecard is due, we set the overall health, and the pillar stays yellow",
    });
    expect(rich.isHealthSession).toBe(true);
    expect(rich.type).toBe("mixed");
  });

  it("reads the CSM's own context, not just the transcript", () => {
    const result = detectHealthSession({ title: "Catch up", context: "Health scorecard review with leadership for the quarter" });
    expect(result.isHealthSession).toBe(true);
  });
});

describe("healthSessionPrompt", () => {
  it("asks for every section the session type carries, and names all pillars", () => {
    const prompt = healthSessionPrompt({ isHealthSession: true, type: "leadership_review" });
    for (const section of healthSessionSections("leadership_review")) {
      expect(prompt).toContain(section.heading);
    }
    for (const pillar of HEALTH_PILLARS) {
      expect(prompt).toContain(pillar);
    }
    expect(prompt).toContain("Not discussed");
  });

  it("gives a coaching session the feedback sections and not the leadership ones", () => {
    const prompt = healthSessionPrompt({ isHealthSession: true, type: "coaching" });
    expect(prompt).toContain("Scorecard Feedback");
    expect(prompt).not.toContain("Leadership Questions Asked");
  });

  it("accepts a bare type id", () => {
    expect(healthSessionPrompt("mixed")).toContain("Verify Before Use");
  });

  it("asks a meeting that only touched health scoring for the ratings, not the full layer", () => {
    const prompt = healthSessionPrompt("mixed");
    expect(prompt).toContain("Health Ratings Captured");
    expect(prompt).not.toContain("Support Asks Raised");
  });

  it("only holds a saved note to the sections that kind of session must carry", () => {
    expect(requiredHealthSections("mixed")).toEqual([]);
    expect(requiredHealthSections("leadership_review").map((section) => section.id)).toContain("commitments");
  });
});

const RATINGS = `## Health Ratings Captured

| Pillar | Colour | Said By | Changed On Call | Reason Given | Data Source Cited | Green If | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Overall | Yellow | Manager | Green to Yellow | Flat adoption | Telemetry | All pillars green | Agreed |
${HEALTH_PILLARS.map((pillar) => `| ${pillar} | Yellow | Manager | No | Stated reason | Telemetry | Criteria | Agreed |`).join("\n")}
`;

describe("lintHealthNote", () => {
  it("passes a complete note", () => {
    const note = `# Review\n\n## Meeting Notes\n\n- something\n\n${RATINGS}\n## Verify Before Use\n\n- nothing outstanding\n`;
    expect(lintHealthNote(note, { type: "mixed" })).toEqual([]);
  });

  it("names the sections a session type is missing", () => {
    const issues = lintHealthNote("# Review\n\n## Meeting Notes\n\n- something\n", { type: "leadership_review" });
    const missing = issues.find((issue) => issue.code === "missing-section");
    expect(missing.severity).toBe("hard");
    expect(missing.message).toContain("Health Ratings Captured");
  });

  it("catches a pillar left out of the ratings table", () => {
    const note = `## Health Ratings Captured\n\n| Pillar | Colour |\n| --- | --- |\n| Adoption | Yellow |\n\n## Verify Before Use\n\n- none\n`;
    const codes = lintHealthNote(note, { type: "mixed" }).map((issue) => issue.code);
    expect(codes).toContain("pillar-missing");
  });

  it("catches a ratings row with no colour, but accepts Not discussed", () => {
    const rows = HEALTH_PILLARS.map((pillar) => `| ${pillar} | ${pillar === "Renewal" ? "" : "Yellow"} | reason |`).join("\n");
    const note = `## Health Ratings Captured\n\n| Pillar | Colour | Reason |\n| --- | --- | --- |\n${rows}\n\n## Verify Before Use\n\n- none\n`;
    expect(lintHealthNote(note, { type: "mixed" }).map((i) => i.code)).toContain("rating-no-colour");

    const discussed = note.replace("| Renewal |  | reason |", "| Renewal | Not discussed | reason |");
    expect(lintHealthNote(discussed, { type: "mixed" }).map((i) => i.code)).not.toContain("rating-no-colour");
  });

  it("flags Amber as a rating but allows it inside a quotation", () => {
    const base = `## Health Ratings Captured\n\n${RATINGS.split("\n").slice(2).join("\n")}\n## Verify Before Use\n\n- none\n`;
    expect(lintHealthNote(`${base}\n- The pillar moved to Amber.\n`, { type: "mixed" }).map((i) => i.code)).toContain("colour-word");
    expect(lintHealthNote(`${base}\n- Reason given: "let's call it amber for now".\n`, { type: "mixed" }).map((i) => i.code)).not.toContain("colour-word");
  });

  it("catches the note owner merged with another speaker", () => {
    const note = `## Verify Before Use\n\n- Meeting led by Avery (Morgan), covering the quarter.\n`;
    const issue = lintHealthNote(note, { type: "mixed", ownerNames: ["Avery"] }).find((i) => i.code === "owner-merged");
    expect(issue.severity).toBe("hard");
  });

  it("accepts the owner's own alias in parentheses", () => {
    const note = `## Verify Before Use\n\n- Notes taken by Avery (Ave).\n`;
    expect(lintHealthNote(note, { type: "mixed", ownerNames: ["Avery", "Ave"] }).map((i) => i.code)).not.toContain("owner-merged");
  });

  it("catches a pronoun that contradicts the configured pronouns", () => {
    const note = `## Verify Before Use\n\n- Avery said he would follow up with the site lead.\n`;
    const issues = lintHealthNote(note, { type: "mixed", ownerNames: ["Avery"], ownerPronouns: "she/her" });
    expect(issues.map((i) => i.code)).toContain("owner-pronoun");
    expect(issues.find((i) => i.code === "owner-pronoun").message).toContain('"he"');
    expect(lintHealthNote(note, { type: "mixed", ownerNames: ["Avery"], ownerPronouns: "he/him" }).map((i) => i.code)).not.toContain("owner-pronoun");
    expect(lintHealthNote(note, { type: "mixed", ownerNames: ["Avery"] }).map((i) => i.code)).not.toContain("owner-pronoun");
  });

  it("does not read someone else's pronoun as the note owner's", () => {
    const options = { type: "mixed", ownerNames: ["Avery"], ownerPronouns: "she/her" };
    // "him" is the person Avery is emailing; "them" is the set of reviews.
    expect(lintHealthNote(`## Verify Before Use\n\n- The SSM is Jordan Blake; Avery to email him this week.\n`, options).map((i) => i.code))
      .not.toContain("owner-pronoun");
    expect(lintHealthNote(`## Verify Before Use\n\n- Avery completed the reviews and is calibrating them.\n`, options).map((i) => i.code))
      .not.toContain("owner-pronoun");
    // The pronoun before the name belongs to whoever was named earlier.
    expect(lintHealthNote(`## Verify Before Use\n\n- His plan went to Avery for review.\n`, options).map((i) => i.code))
      .not.toContain("owner-pronoun");
  });

  it("catches an unrestored pseudonymization alias", () => {
    const note = `## Verify Before Use\n\n- PERSON_4 owns the pilot.\n`;
    expect(lintHealthNote(note, { type: "mixed" }).map((i) => i.code)).toContain("alias-token");
  });

  it("catches a person listed twice in the callouts", () => {
    const note = `## User-Level Callouts\n\n- **Avery** — CSM: owns the plan.\n- **Avery (Ave)** — CSM: also listed here.\n\n## Verify Before Use\n\n- none\n`;
    expect(lintHealthNote(note, { type: "mixed" }).map((i) => i.code)).toContain("duplicate-callout");
  });

  it("catches a usage claim with no source", () => {
    const note = `## Usage And Data Claims\n\n| Claim | Source | Period |\n| --- | --- | --- |\n| Usage flat | | since last year |\n\n## Verify Before Use\n\n- none\n`;
    expect(lintHealthNote(note, { type: "mixed" }).map((i) => i.code)).toContain("unsourced-claim");

    const sourced = note.replace("| Usage flat | | since last year |", "| Usage flat | Telemetry | since last year |");
    expect(lintHealthNote(sourced, { type: "mixed" }).map((i) => i.code)).not.toContain("unsourced-claim");
  });

  it("catches a commitment with no completion test", () => {
    const note = `## Commitments For Next Review\n\n- [ ] Rebuild the site map — **Owner:** CSM | **Due:** Q4\n\n## Verify Before Use\n\n- none\n`;
    expect(lintHealthNote(note, { type: "mixed" }).map((i) => i.code)).toContain("commitment-fields");
  });

  it("catches another customer named outside the cross-account section", () => {
    const note = `## Meeting Notes\n\n- Beacon Systems used the same model.\n\n## Cross-Account References\n\n- **Cardinal Defense:** ran the same pilot.\n\n## Verify Before Use\n\n- none\n`;
    const options = { type: "leadership_review", otherAccounts: ["Beacon Systems", "Cardinal Defense"] };
    const codes = lintHealthNote(note, options).map((i) => i.code);
    expect(codes).toContain("cross-account");
    const issue = lintHealthNote(note, options).find((i) => i.code === "cross-account");
    expect(issue.message).toContain("Beacon Systems");
    expect(issue.message).not.toContain("Cardinal Defense");
  });

  it("catches generator litter", () => {
    const note = `## Verify Before Use\n\n- The renewal is open-.\n`;
    expect(lintHealthNote(note, { type: "mixed" }).map((i) => i.code)).toContain("stray-punctuation");
  });

  it("leaves a roll-up alone about naming several accounts", () => {
    const note = `## Meeting Notes\n\n- Beacon Systems is steady.\n\n## Verify Before Use\n\n- none\n`;
    expect(lintHealthNote(note, { type: "portfolio_rollup", otherAccounts: ["Beacon Systems"] }).map((i) => i.code))
      .not.toContain("cross-account");
  });

  it("returns nothing for an empty note", () => {
    expect(lintHealthNote("", { type: "leadership_review" })).toEqual([]);
  });
});

describe("disallowedPronouns", () => {
  it("returns the pronouns that would be wrong", () => {
    expect(disallowedPronouns("she/her")).toContain("he");
    expect(disallowedPronouns("she/her")).not.toContain("her");
    expect(disallowedPronouns("they/them")).toContain("she");
    expect(disallowedPronouns("")).toEqual([]);
  });

  it("leaves object pronouns and the generic plural alone", () => {
    expect(disallowedPronouns("she/her")).not.toContain("him");
    expect(disallowedPronouns("she/her")).not.toContain("them");
    expect(disallowedPronouns("he/him")).not.toContain("they");
  });
});
