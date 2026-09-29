import { describe, expect, it } from "vitest";
import { emailThreadKey, sameEmailThread, stripThreadNoise } from "./emailThreads";

const SUBJECT = "Q3 license server migration";

describe("stripThreadNoise", () => {
  it("peels every dressing the same thread arrives wearing", () => {
    const variants = [
      SUBJECT,
      `RE: ${SUBJECT}`,
      `Re: ${SUBJECT}`,
      `FW: ${SUBJECT}`,
      `Fwd: ${SUBJECT}`,
      `RE: RE: FW: ${SUBJECT}`,
      `[EXTERNAL] ${SUBJECT}`,
      `[External] ${SUBJECT}`,
      `[EXT] ${SUBJECT}`,
      `[EXTERNAL]: ${SUBJECT}`,
      `(External) ${SUBJECT}`,
      `{EXT} ${SUBJECT}`,
      `**EXTERNAL** ${SUBJECT}`,
      `EXTERNAL: ${SUBJECT}`,
      `Ext: ${SUBJECT}`,
      `[EXTERNAL EMAIL] ${SUBJECT}`,
      `CAUTION: EXTERNAL ${SUBJECT}`,
      `⚠ [EXTERNAL] ${SUBJECT}`,
      `FW: [EXTERNAL] Re: ${SUBJECT}`,
      `[EXT] RE: FW: ${SUBJECT}`,
      // The form the app's own saved filenames take, once ":" became "-".
      `RE- ${SUBJECT}`,
      `FW- [EXTERNAL] Re- ${SUBJECT}`,
      // Non-English clients.
      `AW: ${SUBJECT}`,
      `SV: ${SUBJECT}`,
      `TR: ${SUBJECT}`,
    ];
    for (const variant of variants) {
      expect(stripThreadNoise(variant), variant).toBe(SUBJECT);
    }
  });

  it("keeps a tag the sender meant, which really does split the thread", () => {
    expect(stripThreadNoise(`[NI INTERNAL] ${SUBJECT}`)).toBe(`[NI INTERNAL] ${SUBJECT}`);
    expect(stripThreadNoise(`RE: [NI INTERNAL] ${SUBJECT}`)).toBe(`[NI INTERNAL] ${SUBJECT}`);
    expect(stripThreadNoise(`[CONFIDENTIAL] ${SUBJECT}`)).toBe(`[CONFIDENTIAL] ${SUBJECT}`);
    expect(stripThreadNoise(`[Action Required] ${SUBJECT}`)).toBe(`[Action Required] ${SUBJECT}`);
  });

  it("does not eat a subject that merely starts with one of those words", () => {
    expect(stripThreadNoise("External audit findings")).toBe("External audit findings");
    expect(stripThreadNoise("Re-org plan for Q4")).toBe("Re-org plan for Q4");
    expect(stripThreadNoise("Reference architecture review")).toBe("Reference architecture review");
    expect(stripThreadNoise("Extension request")).toBe("Extension request");
  });

  it("handles an empty or missing subject", () => {
    expect(stripThreadNoise("")).toBe("");
    expect(stripThreadNoise(null)).toBe("");
    expect(stripThreadNoise("RE:")).toBe("");
  });
});

describe("emailThreadKey", () => {
  it("matches every variant of one thread to the same key", () => {
    const key = emailThreadKey(SUBJECT);
    for (const variant of [`RE: ${SUBJECT}`, `[EXTERNAL] FW: ${SUBJECT}`, `[ext] re- ${SUBJECT}`, `  ${SUBJECT.toUpperCase()}  `]) {
      expect(emailThreadKey(variant), variant).toBe(key);
    }
  });

  it("keeps genuinely different threads apart", () => {
    expect(emailThreadKey(`[NI INTERNAL] ${SUBJECT}`)).not.toBe(emailThreadKey(SUBJECT));
    expect(emailThreadKey("Q4 license server migration")).not.toBe(emailThreadKey(SUBJECT));
    expect(emailThreadKey("Training credits")).not.toBe(emailThreadKey(SUBJECT));
  });

  it("ignores the punctuation the saved filename mangles", () => {
    // sanitizeFilename turns ":" into "-" on the way to disk.
    expect(emailThreadKey("Migration: phase 2")).toBe(emailThreadKey("Migration- phase 2"));
  });
});

describe("sameEmailThread", () => {
  it("answers the question the save path actually asks", () => {
    expect(sameEmailThread(`RE: ${SUBJECT}`, `[EXTERNAL] ${SUBJECT}`)).toBe(true);
    expect(sameEmailThread(SUBJECT, `[NI INTERNAL] ${SUBJECT}`)).toBe(false);
    expect(sameEmailThread("", SUBJECT)).toBe(false);
    expect(sameEmailThread("RE:", "FW:")).toBe(false);
  });
});
