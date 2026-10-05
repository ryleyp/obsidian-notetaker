import { describe, expect, it } from "vitest";
import {
  aliasesFromReplacements,
  buildSanitizePrompt,
  extractEmailEntities,
  mergeSensitiveEntities,
  parseEntityList,
} from "@/lib/privacy";

describe("aliasesFromReplacements", () => {
  it("returns only aliases, never original terms", () => {
    const aliases = aliasesFromReplacements([
      { original: "Acme", alias: "ORG_1" },
      { original: "Jane Doe", alias: "PERSON_1" },
    ]);

    expect(aliases).toEqual(["ORG_1", "PERSON_1"]);
  });
});

describe("buildSanitizePrompt", () => {
  it("includes aliases without leaking original known terms", () => {
    const prompt = buildSanitizePrompt("Met with ORG_1", ["ORG_1"]);

    expect(prompt).toContain("ORG_1");
    expect(prompt).not.toContain("Acme");
    expect(prompt).toContain("Placeholder aliases");
    expect(prompt).toContain("Email addresses");
  });
});

describe("email privacy", () => {
  it("extracts and deduplicates email addresses without an AI scan", () => {
    expect(extractEmailEntities("From: Dana.Example@acme.test\nCC: dana.example@ACME.test, ops+lab@acme.test"))
      .toEqual([
        { text: "Dana.Example@acme.test", type: "email" },
        { text: "ops+lab@acme.test", type: "email" },
      ]);
  });

  it("prefers the email type when merging duplicate detections", () => {
    expect(mergeSensitiveEntities(
      [{ text: "admin@acme.test", type: "email" }],
      [{ text: "admin@acme.test", type: "org" }, { text: "Dana", type: "person" }]
    )).toEqual([
      { text: "admin@acme.test", type: "email" },
      { text: "Dana", type: "person" },
    ]);
  });
});

describe("parseEntityList", () => {
  it("normalizes entities and filters placeholder aliases", () => {
    const entities = parseEntityList(
      JSON.stringify([
        { text: "ORG_1", type: "org" },
        { text: "PERSON_12", type: "person" },
        { text: "Jane Doe", type: "person" },
        { text: "Acme", type: "company" },
        { text: "jane@acme.test", type: "email" },
      ]),
      ["ORG_1"]
    );

    expect(entities).toEqual([
      { text: "Jane Doe", type: "person" },
      { text: "Acme", type: "org" },
      { text: "jane@acme.test", type: "email" },
    ]);
  });
});

describe("parseEntityList on an answer the model cut off", () => {
  const full = Array.from({ length: 30 }, (_, i) => ({ text: `Person ${i}`, type: "person" }));

  it("keeps every complete term when the array has no closing bracket", () => {
    const truncated = JSON.stringify(full).slice(0, 400);
    const parsed = parseEntityList(truncated);

    // The old parser returned nothing here, so the review card never appeared.
    expect(parsed.length).toBeGreaterThan(5);
    expect(parsed.every((item) => item.text.startsWith("Person "))).toBe(true);
    // The half-written object at the cut-off point is dropped, not guessed at.
    expect(parsed.at(-1).text).toMatch(/^Person \d+$/);
  });

  it("still reads a well-formed answer, with or without prose around it", () => {
    expect(parseEntityList(JSON.stringify(full))).toHaveLength(30);
    expect(parseEntityList(`Here you go:\n${JSON.stringify(full.slice(0, 2))}\nThat is all.`)).toHaveLength(2);
  });

  it("salvages a malformed array rather than throwing", () => {
    const broken = '[{"text":"Dana Whitfield","type":"person"},,{"text":"Acme","type":"org"}]';
    expect(parseEntityList(broken).map((e) => e.text)).toEqual(["Dana Whitfield", "Acme"]);
  });

  it("returns nothing for prose, an empty answer, or an empty array", () => {
    expect(parseEntityList("Nothing sensitive found.")).toEqual([]);
    expect(parseEntityList("")).toEqual([]);
    expect(parseEntityList("[]")).toEqual([]);
  });
});
