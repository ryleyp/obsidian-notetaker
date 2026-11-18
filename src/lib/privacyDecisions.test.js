import { describe, expect, it } from "vitest";
import {
  applyRememberedDecisions,
  decisionsFromConfig,
  normalizePrivacyDecisions,
  planPrivacyReview,
  recordPrivacyDecisions,
  removePrivacyDecision,
} from "@/lib/privacyDecisions";
import { applyReplacements, reverseReplacements } from "@/lib/sanitize";

const person = (text) => ({ text, type: "person" });
const org = (text) => ({ text, type: "org" });

describe("applyRememberedDecisions", () => {
  it("only sends terms with no remembered decision to review", () => {
    const result = applyRememberedDecisions(
      [person("Dana Whitfield"), org("Monday"), person("Jordan Reyes")],
      [
        { text: "Dana Whitfield", type: "person", decision: "anonymize" },
        { text: "monday", type: "org", decision: "ignore" },
      ]
    );

    expect(result.auto.map((item) => item.text)).toEqual(["Dana Whitfield"]);
    expect(result.ignored.map((item) => item.text)).toEqual(["Monday"]);
    expect(result.review.map((item) => item.text)).toEqual(["Jordan Reyes"]);
  });

  it("never honors a remembered ignore for a deterministic identifier", () => {
    const result = applyRememberedDecisions(
      [{ text: "dana@acme.example", type: "email" }],
      [{ text: "dana@acme.example", type: "email", decision: "ignore" }]
    );

    expect(result.ignored).toEqual([]);
    expect(result.review).toHaveLength(1);
  });

  it("sends a configured account name back to review even if it was ignored earlier", () => {
    const result = applyRememberedDecisions(
      [org("Acme")],
      [{ text: "Acme", type: "org", decision: "ignore" }],
      { protectedTexts: new Set(["acme"]) }
    );

    expect(result.ignored).toEqual([]);
    expect(result.review.map((item) => item.text)).toEqual(["Acme"]);
  });

  it("carries a remembered spelling fix onto the auto-anonymized term", () => {
    const result = applyRememberedDecisions(
      [person("Marlo")],
      [{ text: "Marlo", type: "person", decision: "anonymize", restored: "Marlowe" }]
    );

    expect(result.auto).toEqual([{ text: "Marlo", type: "person", restored: "Marlowe" }]);
  });
});

describe("planPrivacyReview", () => {
  const decisions = [
    { text: "Dana Whitfield", type: "person", decision: "anonymize" },
    { text: "Monday", type: "org", decision: "ignore" },
  ];

  it("returns nothing to review when every term was decided before", () => {
    const plan = planPrivacyReview([person("Dana Whitfield"), org("Monday")], { decisions });

    expect(plan.review).toEqual([]);
    expect(plan.remembered).toEqual({ anonymized: 1, ignored: 1 });
    expect(plan.autoReplacements).toEqual([
      { original: "Dana Whitfield", alias: expect.stringMatching(/^PRIVATE_[0-9A-F]{12}$/), restored: "Dana Whitfield", type: "person" },
    ]);
  });

  it("mints a different alias on every run, so no pseudonym is stable across requests", () => {
    const first = planPrivacyReview([person("Dana Whitfield")], { decisions });
    const second = planPrivacyReview([person("Dana Whitfield")], { decisions });

    expect(first.autoReplacements[0].alias).not.toBe(second.autoReplacements[0].alias);
  });

  it("never reuses a saved alias or an auto alias for a row sent to review", () => {
    const savedReplacements = [{ original: "Acme", alias: "PRIVATE_AAAAAAAAAAAA" }];
    const plan = planPrivacyReview([person("Dana Whitfield"), person("Jordan Reyes")], { decisions, savedReplacements });
    const aliases = [savedReplacements[0].alias, plan.autoReplacements[0].alias, plan.review[0].alias];

    expect(new Set(aliases).size).toBe(3);
  });

  it("anonymizes and restores a remembered term end to end", () => {
    const plan = planPrivacyReview([person("Dana Whitfield")], { decisions });
    const sent = applyReplacements("Dana Whitfield asked about Monday.", plan.autoReplacements);

    expect(sent).not.toContain("Dana");
    expect(sent).toContain("Monday");
    expect(reverseReplacements(sent, plan.autoReplacements)).toBe("Dana Whitfield asked about Monday.");
  });

  it("keeps a configured account name on the card instead of ignoring it", () => {
    const plan = planPrivacyReview([org("Acme")], {
      decisions: [{ text: "Acme", type: "org", decision: "ignore" }],
      knownEntities: [{ text: "Acme", type: "org" }],
    });

    expect(plan.review.map((item) => item.text)).toEqual(["Acme"]);
    expect(plan.remembered.ignored).toBe(0);
  });
});

describe("recordPrivacyDecisions", () => {
  it("remembers a checked row as anonymize and an unchecked guess as ignore", () => {
    expect(recordPrivacyDecisions([], [
      { text: "Dana Whitfield", type: "person", enabled: true, restored: "Dana Whitfield" },
      { text: "Monday", type: "org", enabled: false, restored: "Monday" },
    ])).toEqual([
      { text: "Dana Whitfield", type: "person", decision: "anonymize" },
      { text: "Monday", type: "org", decision: "ignore" },
    ]);
  });

  it("remembers an unchecked capitalized term the local pass could not classify", () => {
    expect(recordPrivacyDecisions([], [
      { text: "Rollout Sync", type: "name", enabled: false },
      { text: "Priya Natarajan", type: "name", enabled: true },
    ])).toEqual([
      { text: "Rollout Sync", type: "name", decision: "ignore" },
      { text: "Priya Natarajan", type: "name", decision: "anonymize" },
    ]);
  });

  it("does not remember an unchecked email, phone number, or other deterministic match", () => {
    expect(recordPrivacyDecisions([], [
      { text: "dana@acme.example", type: "email", enabled: false },
      { text: "512-555-0100", type: "phone", enabled: false },
    ])).toEqual([]);
  });

  it("does not remember an unchecked account or owner name as not sensitive", () => {
    expect(recordPrivacyDecisions([], [
      { text: "Acme", type: "org", enabled: false },
    ], { knownEntities: [{ text: "acme", type: "org" }] })).toEqual([]);
  });

  it("skips a row saved to the permanent replacement list", () => {
    expect(recordPrivacyDecisions([], [
      { text: "Dana Whitfield", type: "person", enabled: true, saveToList: true },
    ])).toEqual([]);
  });

  it("keeps a spelling fix with the anonymize decision", () => {
    expect(recordPrivacyDecisions([], [
      { text: "Marlo", type: "person", enabled: true, restored: "Marlowe" },
    ])).toEqual([{ text: "Marlo", type: "person", decision: "anonymize", restored: "Marlowe" }]);
  });

  it("lets a newer decision replace an older one for the same term", () => {
    const result = recordPrivacyDecisions(
      [{ text: "Jordan", type: "location", decision: "ignore" }],
      [{ text: "jordan", type: "person", enabled: true }]
    );

    expect(result).toEqual([{ text: "jordan", type: "person", decision: "anonymize" }]);
  });
});

describe("stored decision lists", () => {
  it("drops malformed entries and ignore decisions that are not allowed", () => {
    expect(normalizePrivacyDecisions([
      null,
      { text: " ", decision: "ignore" },
      { text: "Dana", type: "person", decision: "maybe" },
      { text: "dana@acme.example", type: "email", decision: "ignore" },
      { text: "Monday", type: "org", decision: "ignore" },
    ])).toEqual([{ text: "Monday", type: "org", decision: "ignore" }]);
  });

  it("removes one decision by term, ignoring case", () => {
    expect(removePrivacyDecision(
      [{ text: "Monday", type: "org", decision: "ignore" }, { text: "Dana", type: "person", decision: "anonymize" }],
      "monday"
    )).toEqual([{ text: "Dana", type: "person", decision: "anonymize" }]);
  });

  it("lets the glossary file replace the browser copy, so a removed decision stays removed", () => {
    const local = [{ text: "Monday", type: "org", decision: "ignore" }, { text: "Jordan", type: "location", decision: "ignore" }];
    const file = [{ text: "Monday", type: "org", decision: "ignore" }];

    expect(decisionsFromConfig(local, file)).toEqual(file);
    expect(decisionsFromConfig(local, [])).toEqual([]);
  });

  it("keeps the browser copy when the glossary file has no decision list yet", () => {
    const local = [{ text: "Monday", type: "org", decision: "ignore" }];

    expect(decisionsFromConfig(local, undefined)).toEqual(local);
  });
});
