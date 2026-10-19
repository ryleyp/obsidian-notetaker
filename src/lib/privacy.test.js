import { describe, expect, it } from "vitest";
import {
  aliasesFromReplacements,
  buildSanitizePrompt,
  extractEmailEntities,
  extractLocalSensitiveEntities,
  extractKnownSensitiveEntities,
  knownPrivacyEntities,
  mergeSensitiveEntities,
  parseEntityList,
  privacyTermsFromReplacements,
} from "@/lib/privacy";

describe("aliasesFromReplacements", () => {
  it("returns only aliases, never original terms", () => {
    const aliases = aliasesFromReplacements([
      { original: "Acme", alias: "ORG_1" },
      { original: "Jane Doe", alias: "PERSON_1" },
    ]);

    expect(aliases).toEqual(["ORG_1", "PERSON_1"]);
  });

  it("builds outbound repair mappings for original and corrected spellings", () => {
    expect(privacyTermsFromReplacements([
      { original: "Danna", restored: "Dana", alias: "PRIVATE_AAAAAAAAAAAA", type: "person" },
    ])).toEqual([
      { text: "Danna", alias: "PRIVATE_AAAAAAAAAAAA", type: "person" },
      { text: "Dana", alias: "PRIVATE_AAAAAAAAAAAA", type: "person" },
    ]);
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

describe("local privacy detection", () => {
  it("finds common identifiers and secrets without an AI call", () => {
    const entities = extractLocalSensitiveEntities(`
From: Jane Doe <jane.doe@acme.example>
Jane Doe: Call me at (512) 555-0199.
Office: 123 Main Street
SSN: 123-45-6789
Server: 10.20.30.40
Portal: https://internal.acme.example/cases/42
Key: sk-ant-api03_abcdefghijklmnopqrstuv
Acme Aerospace LLC approved the work.
    `);

    expect(entities).toEqual(expect.arrayContaining([
      { text: "jane.doe@acme.example", type: "email" },
      { text: "(512) 555-0199", type: "phone" },
      { text: "123 Main Street", type: "address" },
      { text: "123-45-6789", type: "id" },
      { text: "10.20.30.40", type: "ip" },
      { text: "https://internal.acme.example/cases/42", type: "url" },
      { text: "sk-ant-api03_abcdefghijklmnopqrstuv", type: "secret" },
      { text: "Jane Doe", type: "person" },
      { text: "Acme Aerospace LLC", type: "org" },
    ]));
    expect(entities.filter((entity) => entity.type === "person")).toEqual([
      { text: "Jane Doe", type: "person" },
    ]);
  });

  it("ignores invalid IPs and public product names used as speakers", () => {
    const entities = extractLocalSensitiveEntities("SystemLink: online at 999.2.3.4");
    expect(entities).toEqual([]);
  });

  it("derives a company token from non-public email domains", () => {
    expect(extractLocalSensitiveEntities("jane@northwind.com joined the Northwind review")).toEqual(expect.arrayContaining([
      { text: "jane@northwind.com", type: "email" },
      { text: "northwind", type: "org" },
    ]));
    expect(extractLocalSensitiveEntities("jane@gmail.com")).not.toContainEqual({ text: "gmail", type: "org" });
  });
});

describe("configured sensitive terms", () => {
  it("finds only configured names that are present", () => {
    const configured = knownPrivacyEntities({
      accounts: [{ name: "Northwind Aerospace", aliases: ["northwind", "nwa"] }],
      ownerNames: ["Ryley Priddy"],
    });
    expect(extractKnownSensitiveEntities("Ryley Priddy met the Northwind team.", configured)).toEqual([
      { text: "northwind", type: "org" },
      { text: "Ryley Priddy", type: "person" },
    ]);
  });
});

describe("adversarial privacy formats", () => {
  it("handles Unicode names and Last, First speaker labels", () => {
    expect(extractLocalSensitiveEntities("Dubois, Élodie: I approved it.")).toContainEqual({
      text: "Dubois, Élodie",
      type: "person",
    });
  });

  it("finds URLs inside Markdown and secrets split across a line", () => {
    const entities = extractLocalSensitiveEntities("[case](https://private.example/case/42)\nkey: sk-ant-api03_ABCD\nEFGHIJKLMNOPQRSTUV");
    expect(entities).toEqual(expect.arrayContaining([
      { text: "https://private.example/case/42", type: "url" },
      { text: "sk-ant-api03_ABCD\nEFGHIJKLMNOPQRSTUV", type: "secret" },
    ]));
  });

  it("matches configured names case-insensitively when generic NER cannot", () => {
    expect(extractKnownSensitiveEntities("follow up with ryley priddy", [{ text: "Ryley Priddy", type: "person" }]))
      .toEqual([{ text: "Ryley Priddy", type: "person" }]);
  });
});

describe("parseEntityList", () => {
  it("normalizes entities and filters placeholder aliases", () => {
    const entities = parseEntityList(
      JSON.stringify([
        { text: "ORG_1", type: "org" },
        { text: "PERSON_12", type: "person" },
        { text: "PRIVATE_A1B2C3D4E5F6", type: "person" },
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
