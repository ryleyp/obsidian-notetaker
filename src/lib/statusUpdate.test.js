import { describe, expect, it } from "vitest";
import {
  buildStatusUpdatePrompt,
  checkStatusUpdate,
  parseStatusUpdate,
  recentStatusNotes,
  shareableStatusText,
  statusNoteExcerpt,
  STATUS_WINDOW_DAYS,
} from "./statusUpdate";

const TODAY = new Date("2026-10-07T12:00:00");
const ACCOUNT = "Acme Aerospace";

// A clean draft in the approved shape, used as the baseline every check is
// measured against.
const GOOD = {
  status: `${ACCOUNT}: 2026-10-07 - At MFC, the SL Pro pilot is underway and the team was briefed by the BDM on SystemLink Server moving to limited support. Unclassified programs continue their SLE migration, and classified programs plan to move once the pilot wraps. At RMS, the SLS to SLE migration is progressing and classified sites will follow whichever path MFC lands on.`,
  risk: "The classified migration will not finish by the October 2027 deadline, so bridge licenses need to be added to the EA ahead of the February 2027 renewal.",
  nextStep: "Reconvene with MFC in early November to review the assessment and get the support kickoff scheduled.",
  otherRisks: ["Pilot slips past October", "Second division delays its assessment"],
};

const check = (over = {}, options = {}) =>
  checkStatusUpdate({ ...GOOD, ...over }, { account: ACCOUNT, today: "2026-10-07", accountTerms: ["Acme", "Aerospace", "MFC", "RMS"], ...options });

const codes = (over, options) => check(over, options).flags.map((f) => f.id);

describe("recentStatusNotes", () => {
  const note = (date, title) => ({ date, title, content: "body" });

  it("keeps the window's notes, newest first, and counts what fell outside", () => {
    const { notes, older } = recentStatusNotes(
      [note("2026-05-01", "old"), note("2026-10-06", "newest"), note("2026-09-20", "recent"), note("", "undated")],
      { today: TODAY }
    );
    expect(notes.map((n) => n.title)).toEqual(["newest", "recent"]);
    expect(older).toBe(2);
  });

  it("reaches back a trailing quarter, so the current one is included", () => {
    expect(STATUS_WINDOW_DAYS).toBe(90);
    // Just inside the quarter, and just outside it.
    expect(recentStatusNotes([note("2026-07-10", "edge")], { today: TODAY }).notes).toHaveLength(1);
    expect(recentStatusNotes([note("2026-07-05", "past")], { today: TODAY }).notes).toHaveLength(0);
  });
});

describe("statusNoteExcerpt", () => {
  it("reads the sections a status update draws from, and not the transcript", () => {
    const content = `# Note

## Executive Summary

Migration is underway.

## Transcript

raw speech nobody should quote

## Next Steps

Review in November.
`;
    const excerpt = statusNoteExcerpt(content);
    expect(excerpt).toContain("Migration is underway.");
    expect(excerpt).toContain("Review in November.");
    expect(excerpt).not.toContain("raw speech");
  });
});

describe("buildStatusUpdatePrompt", () => {
  const prompt = (over = {}) => buildStatusUpdatePrompt({
    account: ACCOUNT, today: "2026-10-07", productFocus: "SystemLink",
    notes: [{ date: "2026-10-06", title: "Sync", content: "## Executive Summary\n\nPilot underway." }],
    ...over,
  });

  it("asks for the three parts and carries the rules the drafts kept breaking", () => {
    const text = prompt();
    expect(text).toContain(`starts with "${ACCOUNT}: 2026-10-07 - "`);
    expect(text).toContain('A line starting with "Risk: "');
    expect(text).toContain('A line starting with "Next step: "');
    expect(text).toContain("Never use em dashes");
    expect(text).toContain("Do not name individuals");
    expect(text).toContain("Other risks considered:");
    expect(text).toContain("Pilot underway.");
  });

  it("drops the parts the CSM turned off, and renumbers what is left", () => {
    const text = prompt({ includeRisk: false });
    expect(text).toContain("Write exactly 2 parts");
    expect(text).not.toContain('A line starting with "Risk: "');
    expect(text).toContain('2. A line starting with "Next step: "');
    expect(prompt({ includeRisk: false, includeNextStep: false })).toContain("Write exactly 1 part ");
  });

  it("passes a prior approved update through to be refreshed", () => {
    expect(prompt({ priorUpdate: "Last month's wording." })).toContain("Last month's wording.");
    expect(prompt()).toContain("Prior approved update (refresh this if present): none");
  });
});

describe("parseStatusUpdate", () => {
  it("splits the three parts and keeps the private list apart", () => {
    const raw = `${GOOD.status}

Risk: ${GOOD.risk}

Next step: ${GOOD.nextStep}

---

Other risks considered:
- Pilot slips past October
- Second division delays its assessment`;
    expect(parseStatusUpdate(raw)).toEqual(GOOD);
  });

  it("copes with a draft that has no risk, no next step, or no private list", () => {
    const parsed = parseStatusUpdate("Acme: 2026-10-07 - Just the paragraph.");
    expect(parsed).toEqual({ status: "Acme: 2026-10-07 - Just the paragraph.", risk: "", nextStep: "", otherRisks: [] });
  });
});

describe("shareableStatusText", () => {
  it("is the three parts and never the private list", () => {
    const text = shareableStatusText(GOOD);
    expect(text).toContain(`Risk: ${GOOD.risk}`);
    expect(text).toContain(`Next step: ${GOOD.nextStep}`);
    expect(text).not.toContain("Other risks");
    expect(text).not.toContain("Pilot slips past October");
  });
});

describe("post-draft checks", () => {
  it("passes a clean draft", () => {
    expect(check().flags).toEqual([]);
  });

  it("D1 repairs dashes the spec bans", () => {
    const { fixed, flags } = check({ risk: "The migration slips — bridge licenses are needed." });
    expect(fixed.risk).toBe("The migration slips, bridge licenses are needed.");
    expect(flags.map((f) => f.id)).not.toContain("D1");
  });

  it("D2 repairs a missing or malformed header", () => {
    expect(check({ status: "At MFC the pilot is underway. It continues. It wraps in November." }).fixed.status)
      .toBe(`${ACCOUNT}: 2026-10-07 - At MFC the pilot is underway. It continues. It wraps in November.`);
    // An existing header is not doubled up.
    expect(check().fixed.status.startsWith(`${ACCOUNT}: 2026-10-07 - At MFC`)).toBe(true);
  });

  it("D3 flags a paragraph outside three to five sentences", () => {
    expect(codes({ status: `${ACCOUNT}: 2026-10-07 - One sentence only.` })).toContain("D3");
    expect(codes()).not.toContain("D3");
  });

  it("D4 flags a risk or next step that runs to two sentences", () => {
    expect(codes({ risk: "It will slip. Bridge licenses are needed." })).toContain("D4");
    expect(codes()).not.toContain("D4");
  });

  it("D5 flags an individual named instead of a role", () => {
    expect(codes({ risk: "Dana Whitfield will not finish the migration by the deadline." })).toContain("D5");
    expect(codes({ risk: "The BDM will not finish the migration by the deadline." }, { knownNames: ["Dana Whitfield"] })).not.toContain("D5");
    // Account and product wording is not a person.
    expect(codes()).not.toContain("D5");
  });

  it("D6 flags money, pricing, and counts", () => {
    expect(codes({ risk: "The renewal adds $40,000 to the agreement." })).toContain("D6");
    expect(codes({ risk: "They need 400 credits before the deadline." })).toContain("D6");
    expect(codes({ risk: "Pricing is per node for the classified sites." })).toContain("D6");
    expect(codes()).not.toContain("D6");
  });

  it("D7 flags hedging instead of a plain outcome", () => {
    expect(codes({ nextStep: "Worth confirming whether the pilot wraps in November." })).toContain("D7");
    expect(codes()).not.toContain("D7");
  });

  it("D8 flags the same point made twice", () => {
    const repeated = "bridge licenses need to be added";
    expect(codes({
      status: `${ACCOUNT}: 2026-10-07 - At MFC the pilot runs. ${repeated} to the agreement. At RMS it progresses.`,
      risk: `The deadline slips so ${repeated} to the EA.`,
    })).toContain("D8");
    expect(codes()).not.toContain("D8");
  });

  it("D9 says when notes fell outside the window", () => {
    expect(codes({}, { notesOutsideWindow: 3 })).toContain("D9");
    expect(codes({}, { notesOutsideWindow: 0 })).not.toContain("D9");
  });
});
