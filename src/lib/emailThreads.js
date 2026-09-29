// Identifying an email thread from its subject line.
//
// The same thread arrives with the subject dressed differently every time:
// "Budget review", "RE: Budget review", "[EXTERNAL] RE: Budget review",
// "FW: [EXT] Re- Budget review". Mail clients and gateways add these markers;
// none of them makes it a different conversation, so none of them belongs in
// the thread's identity.
//
// What DOES belong is any other tag the sender chose to put there. A
// "[NI INTERNAL]" thread is deliberately not the same conversation as the
// customer-facing one with the same subject, so tags are kept unless they are
// on the known-noise list below.

// Reply and forward prefixes, including the ones non-English clients send.
const REPLY_PREFIX = "re|res|ref|fw|fwd|fwed|forward|aw|antw|antwort|sv|vs|vb|tr|rv|enc|odp|doorst";

// Gateway markers meaning "this came from outside" — never part of a subject.
const EXTERNAL_MARKER = "external(?:\\s+(?:email|sender|message))?|extern|ext";

// The longer banner form, "CAUTION: EXTERNAL EMAIL". The caution word alone is
// not noise — "Warning: system outage" is a real subject — so it only counts
// when an external marker follows it.
const BANNER = new RegExp(`^\\s*(?:caution|warning|alert|notice)\\s*[:\\-–—]?\\s+(?:${EXTERNAL_MARKER})\\b\\s*[:\\-–—]?\\s*`, "i");

// A marker in brackets, parentheses, braces, or asterisks: [EXTERNAL],
// (External), {EXT}, **EXTERNAL**. A trailing separator is optional because
// clients write both "[EXTERNAL] Subject" and "[EXTERNAL]: Subject".
const WRAPPED = new RegExp(`^\\s*(?:\\[\\s*(?:${EXTERNAL_MARKER})\\s*\\]|\\(\\s*(?:${EXTERNAL_MARKER})\\s*\\)|\\{\\s*(?:${EXTERNAL_MARKER})\\s*\\}|\\*\\*\\s*(?:${EXTERNAL_MARKER})\\s*\\*\\*)\\s*[:\\-–—]?\\s*`, "i");

// A bare marker needs a separator so a subject that merely starts with the
// word survives: "EXT: rollout" is noise, "External audit findings" is not.
// A dash must be followed by whitespace, so "Re-org plan" stays intact while
// the app's own "RE- Subject" filename form is still peeled.
const BARE = new RegExp(`^\\s*(?:${REPLY_PREFIX}|${EXTERNAL_MARKER})\\s*(?::+\\s*|[\\-–—]\\s+)`, "i");

// Leading warning glyphs some gateways prepend.
const GLYPH = /^\s*(?:[⚠️❗❕‼Ὢ8]\s*)+/;

// Strips every leading noise marker, in whatever order they were stacked.
export function stripThreadNoise(subject) {
  let out = String(subject || "");
  for (let guard = 0; guard < 20; guard += 1) {
    const next = out.replace(GLYPH, "").replace(BANNER, "").replace(WRAPPED, "").replace(BARE, "");
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").trim();
}

// The comparison key for "is this the same thread?". Case, spacing, and
// punctuation the filename form mangles are all normalised away.
export function emailThreadKey(subject) {
  return stripThreadNoise(subject)
    .normalize("NFKC")
    // The saved filename turns ":" into "-", so a subject and the file it was
    // saved as have to compare equal.
    .replace(/[:\-–—]+/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Whether two subjects name the same conversation.
export function sameEmailThread(a, b) {
  const keyA = emailThreadKey(a);
  return !!keyA && keyA === emailThreadKey(b);
}
