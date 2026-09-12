import { describe, expect, it } from "vitest";
import { savedReplacementsInSources, termProvenance, withProvenance } from "./mappingNames";

const folderNote = { source: "obsidian", title: "Acme sync", content: "Met Shah at the northern lab; Vernon presented." };
const crossNote = { source: "cross-vault", sourceLabel: "2. Globex", title: "Globex sync", content: "Priyan owns the Globex SystemLink rollout." };

describe("termProvenance", () => {
  it("matches whole words only", () => {
    expect(termProvenance([folderNote], "Hern")).toBe("");
    expect(termProvenance([folderNote], "Shah")).toBe("folder");
    expect(termProvenance([folderNote], "Vern")).toBe("");
  });

  it("distinguishes the selected folder from other sources", () => {
    expect(termProvenance([folderNote, crossNote], "Priyan")).toBe("elsewhere");
    expect(termProvenance([folderNote, crossNote], "Vernon")).toBe("folder");
    expect(termProvenance([{ title: "legacy note", content: "Shah" }], "Shah")).toBe("folder");
  });
});

describe("savedReplacementsInSources", () => {
  const replacements = [
    { original: "Shah", alias: "PERSON_5", restored: "Shaw" },
    { original: "Priyan", alias: "PERSON_4", restored: "Pri" },
    { original: "Hern", alias: "PERSON_9", restored: "Hern" },
    { original: "Globex SystemLink", alias: "ORG_1", restored: "Globex SystemLink" },
  ];

  it("keeps only terms actually present, tagged by where they were found", () => {
    const items = savedReplacementsInSources([folderNote, crossNote], replacements);
    expect(items.map((i) => [i.text, i.foundIn, i.type])).toEqual([
      ["Shah", "folder", "person"],
      ["Priyan", "elsewhere", "person"],
      ["Globex SystemLink", "elsewhere", "org"],
    ]);
  });

  it("matches on the restored spelling too", () => {
    const items = savedReplacementsInSources([{ source: "obsidian", content: "Shaw joined" }], replacements);
    expect(items.map((i) => i.text)).toEqual(["Shah"]);
  });
});

describe("withProvenance", () => {
  it("tags detected names, defaulting to elsewhere when unmatched", () => {
    const tagged = withProvenance([{ text: "Vernon" }, { text: "Priyan" }, { text: "Nobody" }], [folderNote, crossNote]);
    expect(tagged.map((t) => t.foundIn)).toEqual(["folder", "elsewhere", "elsewhere"]);
  });
});
