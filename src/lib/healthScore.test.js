import { describe, expect, it } from "vitest";
import { buildHealthScorePrompt } from "./healthScore";

describe("buildHealthScorePrompt", () => {
  const base = {
    notes: [{ filename: "2026-09-01 Review.md", date: "2026-09-01", title: "Review", content: "Current evidence" }],
    accountName: "Acme",
    allAccounts: [{ name: "Acme", aliases: ["ACM"] }, { name: "Other Co", aliases: ["OC"] }],
    today: "2026-09-16",
    rangeStart: "2026-05-01",
    rangeEnd: "2026-09-16",
  };

  it("locks the prompt to the selected account and names forbidden accounts", () => {
    const prompt = buildHealthScorePrompt(base);
    expect(prompt).toContain("Create a slide-ready Customer Success health score for Acme only");
    expect(prompt).toContain("Other Co, OC");
    expect(prompt).toContain("Use only the source notes provided from the selected Acme folder");
  });

  it("labels optional prior review inputs without treating them as current proof", () => {
    const prompt = buildHealthScorePrompt({
      ...base,
      previousDeckName: "Q2 Scorecard.pdf",
      previousDeckText: "Prior rating: Yellow",
      reviewTranscriptFilename: "2026-09-01 Review.md",
    });
    expect(prompt).toContain("PRIOR SCORECARD PDF: Q2 Scorecard.pdf");
    expect(prompt).toContain("[SELECTED PRIOR REVIEW TRANSCRIPT]");
    expect(prompt).toContain("historical and unverified");
  });

  it("rejects folders that do not map to an account", () => {
    expect(() => buildHealthScorePrompt({ ...base, accountName: "Internal" })).toThrow(/configured account/);
  });
});

