import { describe, expect, it } from "vitest";
import { mergeFileConfigIntoSettings, mergeReplacements } from "@/lib/settings";

describe("mergeReplacements", () => {
  it("keeps local replacements when the config file has none", () => {
    expect(mergeReplacements([{ original: "Riley", alias: "PERSON_1" }], [])).toEqual([
      { original: "Riley", alias: "PERSON_1" },
    ]);
  });

  it("updates matching replacements from the config file", () => {
    expect(mergeReplacements(
      [{ original: "Riley", alias: "PERSON_1", restored: "Riley" }],
      [{ original: "Riley", alias: "PERSON_2", restored: "Ryley" }]
    )).toEqual([
      { original: "Riley", alias: "PERSON_2", restored: "Ryley" },
    ]);
  });
});

describe("mergeFileConfigIntoSettings", () => {
  it("lets the glossary file's remembered privacy choices replace the browser copy", () => {
    const settings = {
      replacements: [],
      corrections: [],
      accounts: [],
      privacyDecisions: [
        { text: "Monday", type: "org", decision: "ignore" },
        { text: "Jordan", type: "location", decision: "ignore" },
      ],
    };
    const fileDecisions = [{ text: "Monday", type: "org", decision: "ignore" }];

    expect(mergeFileConfigIntoSettings(settings, { privacyDecisions: fileDecisions }).privacyDecisions)
      .toEqual(fileDecisions);
  });

  it("keeps browser-saved privacy choices when the glossary file predates them", () => {
    const settings = {
      replacements: [],
      corrections: [],
      accounts: [],
      privacyDecisions: [{ text: "Dana Whitfield", type: "person", decision: "anonymize" }],
    };

    expect(mergeFileConfigIntoSettings(settings, { corrections: [] }).privacyDecisions)
      .toEqual(settings.privacyDecisions);
  });

  it("takes the owner's names and pronouns from the config file, and keeps the local ones when it has none", () => {
    const settings = { replacements: [], corrections: [], accounts: [], ownerNames: ["Jordan"], ownerPronouns: "she/her" };

    expect(mergeFileConfigIntoSettings(settings, { ownerNames: ["Avery"], ownerPronouns: "they/them" }))
      .toMatchObject({ ownerNames: ["Avery"], ownerPronouns: "they/them" });
    expect(mergeFileConfigIntoSettings(settings, { corrections: [] }))
      .toMatchObject({ ownerNames: ["Jordan"], ownerPronouns: "she/her" });
  });

  it("does not erase browser-saved common corrections when file config is empty", () => {
    const settings = {
      replacements: [],
      corrections: [{ find: "Riley", replace: "Ryley" }],
      accounts: [{ name: "Acme", aliases: ["acme"] }],
    };

    expect(mergeFileConfigIntoSettings(settings, { corrections: [], replacements: [] })).toEqual(settings);
  });

  it("imports config corrections while preserving existing browser corrections", () => {
    const settings = {
      replacements: [],
      corrections: [{ find: "in tools", replace: "NI tools" }],
      accounts: [],
    };

    expect(mergeFileConfigIntoSettings(settings, {
      corrections: [{ find: "Riley", replace: "Ryley" }],
    }).corrections).toEqual([
      { find: "in tools", replace: "NI tools" },
      { find: "Riley", replace: "Ryley" },
    ]);
  });
});
