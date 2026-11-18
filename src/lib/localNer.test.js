import { describe, expect, it } from "vitest";
import { extractLocalNerEntities } from "./localNer";
import { applyReplacements, assignAliases } from "./sanitize";

const texts = (input) => extractLocalNerEntities(input).map((entity) => entity.text);
// Only what the proper-noun pass added, apart from the engine's typed passes.
const guessedNames = (input) => extractLocalNerEntities(input)
  .filter((entity) => entity.type === "name")
  .map((entity) => entity.text);

// What the model would receive once every detected term is replaced.
function anonymized(input) {
  const replacements = assignAliases(extractLocalNerEntities(input), [])
    .map((entity) => ({ original: entity.text, alias: entity.alias }));
  return applyReplacements(input, replacements);
}

describe("local named-entity recognition", () => {
  it("finds people, organizations, and places without a network service", () => {
    const entities = extractLocalNerEntities("Mary met Dr. John Smith from Google Inc in Paris.");
    expect(entities).toEqual(expect.arrayContaining([
      { text: "Mary", type: "person" },
      { text: "Dr. John Smith", type: "person" },
      { text: "Google Inc", type: "org" },
      { text: "Paris", type: "location" },
    ]));
  });

  it("does not classify supported public product names as private entities", () => {
    expect(extractLocalNerEntities("NI demonstrated LabVIEW and SystemLink.")).toEqual([]);
  });
});

describe("names the engine's word list does not know", () => {
  it("catches an uncommon full name in the middle of a sentence", () => {
    expect(extractLocalNerEntities("We met with Priya Natarajan on Monday about TestStand licensing."))
      .toEqual([{ text: "Priya Natarajan", type: "name" }]);
  });

  it("catches an uncommon full name that opens a sentence", () => {
    expect(texts("Priya Natarajan will send the quote.")).toContain("Priya Natarajan");
    expect(anonymized("Priya Natarajan will send the quote.")).not.toMatch(/Priya|Natarajan/);
  });

  it("catches a first name and a surname mentioned separately", () => {
    expect(texts("I talked to Priya about the quote and Natarajan agreed."))
      .toEqual(expect.arrayContaining(["Priya", "Natarajan"]));
  });

  it("catches an unfamiliar company and a single unfamiliar surname", () => {
    const found = texts("So Okonkwo is the new admin at Halvorsen Dynamics.");
    expect(found).toEqual(expect.arrayContaining(["Okonkwo", "Halvorsen Dynamics"]));
  });

  it("also flags a name's parts when one appears alone, so no mention is left behind", () => {
    const input = "We reviewed the plan with Priya Natarajan. Priya said the rollout is on track.";
    expect(texts(input)).toEqual(expect.arrayContaining(["Priya Natarajan", "Priya"]));
    expect(anonymized(input)).not.toMatch(/Priya|Natarajan/);
  });

  it("flags a known first name even when it opens a sentence", () => {
    expect(anonymized("Jordan, can you send the license file?")).not.toContain("Jordan");
  });

  it("treats a word after a speaker label as a sentence start, not as a name", () => {
    const found = texts("Dana Whitfield: Thanks for joining. Basically we need the license file.");
    expect(found).not.toContain("Thanks");
    expect(found).not.toContain("Basically");
  });

  it("rebuilds a hyphenated name exactly as written, so the replacement finds it", () => {
    const input = "The rigs moved to Wright-Halvorsen last quarter, and Okafor-Lindqvist signed off.";
    expect(texts(input)).toEqual(expect.arrayContaining(["Wright-Halvorsen", "Okafor-Lindqvist"]));
    expect(anonymized(input)).not.toMatch(/Wright|Halvorsen|Okafor|Lindqvist/);
  });

  it("treats names joined by a slash or a comma as separate terms", () => {
    const input = "We split the work between the Okonkwo/Kowalczyk teams, then Brightwater, Halvorsen and others.";
    expect(texts(input)).toEqual(expect.arrayContaining(["Okonkwo", "Kowalczyk", "Brightwater", "Halvorsen"]));
    expect(anonymized(input)).not.toMatch(/Okonkwo|Kowalczyk|Brightwater|Halvorsen/);
  });

  it("keeps a possessive name as the name itself", () => {
    expect(texts("We looked at Okonkwo's test stand.")).toContain("Okonkwo");
  });

  it("leaves no part of a name behind across a realistic exchange", () => {
    const input = [
      "Dana Whitfield: Thanks for joining. Wojciech from Brightwater mentioned the VeriStand issue.",
      "Tamsin Okafor: I can follow up with Kowalczyk, and Brightwater's admin too.",
      "Dana Whitfield: Great. Tamsin, please loop in Wojciech.",
    ].join("\n");
    expect(anonymized(input)).not.toMatch(/Wojciech|Brightwater|Tamsin|Okafor|Kowalczyk|Whitfield/);
  });
});

describe("capitalized words that are not names", () => {
  it("does not flag ordinary sentence openers", () => {
    expect(extractLocalNerEntities("Thanks for the update. So the plan is to ship next week. Yeah, that works.")).toEqual([]);
  });

  it("does not flag months, weekdays, or the pronoun I", () => {
    expect(extractLocalNerEntities("I think we ship in March, and I'll confirm on Monday.")).toEqual([]);
  });

  it("leaves public product, tool, and program names readable", () => {
    const found = texts("We covered the Enterprise Agreement, the Proficiency Plan, and Python support in Teams.");
    expect(found).toEqual([]);
  });

  it("does not judge an all-capitals acronym", () => {
    expect(guessedNames("We reviewed the roadmap for the HIL rigs and the FAE notes.")).toEqual([]);
  });

  it("never offers an existing alias for anonymizing again", () => {
    expect(texts("We met with PRIVATE_0123456789AB and Person_2 about the rollout.")).toEqual([]);
  });

  it("breaks a long capitalized heading into its unfamiliar words instead of one giant term", () => {
    const found = guessedNames("The deck was titled Quarterly Review For Halvorsen Dynamics Test Engineering Group Leaders.");
    expect(found.every((text) => text.split(" ").length === 1)).toBe(true);
    expect(found).toContain("Halvorsen");
  });
});
