import { describe, expect, it } from "vitest";
import { parseResponseNeeded } from "./emailFollowUp";

describe("parseResponseNeeded", () => {
  it("parses a Yes verdict with its reason", () => {
    const note = "## Thread Summary\n\n- Bullet [E1]\n\n**Response needed:** Yes — Dana asked for the license count [E2]\n\n---";
    expect(parseResponseNeeded(note)).toEqual({
      needed: true,
      reason: "Dana asked for the license count",
    });
  });

  it("parses a No verdict", () => {
    const note = "**Response needed:** No\n";
    expect(parseResponseNeeded(note)).toEqual({ needed: false, reason: "" });
  });

  it("returns null when the note has no verdict", () => {
    expect(parseResponseNeeded("## Thread Summary\n\n- Bullet")).toEqual({ needed: null, reason: "" });
    expect(parseResponseNeeded("")).toEqual({ needed: null, reason: "" });
  });
});
