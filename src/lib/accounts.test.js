import { describe, it, expect } from "vitest";
import {
  DEFAULT_ACCOUNTS,
  detectAccount,
  matchVaultFolder,
  textHasAlias,
} from "@/lib/accounts";

describe("textHasAlias", () => {
  it("matches an alias as a whole word, case-insensitively", () => {
    expect(textHasAlias("Met with NGC today", "ngc")).toBe(true);
    expect(textHasAlias("northrop grumman call", "northrop")).toBe(true);
  });

  it("does not match an alias inside a larger word", () => {
    expect(textHasAlias("the engcomputer lab", "ngc")).toBe(false);
  });

  it("returns false for blank alias or text", () => {
    expect(textHasAlias("anything", "")).toBe(false);
    expect(textHasAlias("", "ngc")).toBe(false);
  });
});

describe("detectAccount", () => {
  it("detects an account from the folder name", () => {
    const res = detectAccount("3. Northrop");
    expect(res.name).toBe("Northrop Grumman");
    expect(res.archiveFolder).toBe("NGC Transcripts");
    expect(res.aliases).toContain("northrop");
  });

  it("falls back to Internal when nothing matches", () => {
    const res = detectAccount("Weekly Syncs");
    expect(res.name).toBe("Internal");
    expect(res.archiveFolder).toBe("Internal Transcripts");
    expect(res.aliases).toEqual([]);
  });

  it("uses a custom account list when provided", () => {
    const custom = [{ name: "Boeing", archiveFolder: "BA Transcripts", aliases: ["boeing"] }];
    expect(detectAccount("Boeing notes", custom).archiveFolder).toBe("BA Transcripts");
    // Default accounts are ignored when a custom list is supplied.
    expect(detectAccount("Northrop", custom).name).toBe("Internal");
  });

  it("falls back to defaults for an empty account list", () => {
    expect(detectAccount("Lockheed", []).name).toBe("Lockheed Martin");
  });
});

describe("matchVaultFolder", () => {
  const folders = [
    { name: "1. Lockheed", path: "1. Lockheed" },
    { name: "3. Northrop", path: "3. Northrop" },
    { name: "Internal", path: "Internal" },
  ];

  it("routes text mentioning an account to its folder", () => {
    expect(matchVaultFolder("Sync with the Northrop team", folders)).toBe("3. Northrop");
    expect(matchVaultFolder("NGC roadmap review", folders)).toBe("3. Northrop");
  });

  it("returns null when no account alias appears", () => {
    expect(matchVaultFolder("internal planning chat", folders)).toBeNull();
  });

  it("returns null when the matching folder is absent", () => {
    expect(matchVaultFolder("Frontgrade kickoff", folders)).toBeNull();
  });
});

describe("DEFAULT_ACCOUNTS", () => {
  it("every default account has a name, archive folder, and aliases", () => {
    for (const a of DEFAULT_ACCOUNTS) {
      expect(a.name).toBeTruthy();
      expect(a.archiveFolder).toBeTruthy();
      expect(a.aliases.length).toBeGreaterThan(0);
    }
  });
});
