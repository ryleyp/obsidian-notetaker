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
