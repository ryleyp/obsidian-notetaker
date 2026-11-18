import { assignAliases } from "./sanitize";

// Remembered Privacy Review decisions.
//
// The review card used to ask about every detected term on every transcript,
// including the ones already decided in an earlier meeting. A decision is
// stored locally (browser settings plus the glossary file, which already
// holds real names) and replayed on the next scan, so the card only shows
// terms it has never asked about.
//
// What is remembered is the DECISION, never an alias. A term remembered as
// "anonymize" gets a fresh random alias on every run, so the provider cannot
// link the same pseudonym across requests the way a saved replacement can.

export const ANONYMIZE = "anonymize";
export const IGNORE = "ignore";

// Only heuristic guesses can be remembered as "not sensitive". Emails, phone
// numbers, IDs, secrets, addresses, URLs, and IPs are deterministic matches
// that the outbound boundary blocks regardless, so remembering "ignore" for
// one would only turn a review row into a blocked request.
const IGNORABLE_TYPES = new Set(["person", "org", "location", "name"]);

const keyOf = (value) => String(value ?? "").trim().toLowerCase();

// Lowercased texts that may never be remembered as "not sensitive": the
// configured account names, their aliases, and the owner's own names.
export function protectedTextSet(knownEntities = []) {
  return new Set((knownEntities || []).map((entity) => keyOf(entity?.text)).filter(Boolean));
}

function normalizeDecision(item) {
  const text = String(item?.text ?? "").trim();
  if (!text) return null;
  const decision = item?.decision === IGNORE ? IGNORE : item?.decision === ANONYMIZE ? ANONYMIZE : null;
  if (!decision) return null;
  const type = String(item?.type || "org");
  if (decision === IGNORE && !IGNORABLE_TYPES.has(type)) return null;
  const restored = String(item?.restored ?? "").trim();
  return {
    text,
    type,
    decision,
    ...(decision === ANONYMIZE && restored && restored !== text ? { restored } : {}),
  };
}

export function normalizePrivacyDecisions(decisions = []) {
  const byKey = new Map();
  for (const item of Array.isArray(decisions) ? decisions : []) {
    const normalized = normalizeDecision(item);
    if (normalized) byKey.set(keyOf(normalized.text), normalized);
  }
  return [...byKey.values()];
}

// Splits freshly detected terms into the ones still needing a human decision
// and the ones already decided. A remembered "ignore" is not honored for a
// deterministic type or for a configured account/owner name, even if one was
// stored before the account was added: those go back to review.
export function applyRememberedDecisions(entities = [], decisions = [], { protectedTexts } = {}) {
  const remembered = new Map(normalizePrivacyDecisions(decisions).map((item) => [keyOf(item.text), item]));
  const guarded = protectedTexts || new Set();
  const review = [];
  const auto = [];
  const ignored = [];

  for (const entity of entities || []) {
    const key = keyOf(entity?.text);
    if (!key) continue;
    const past = remembered.get(key);
    if (past?.decision === ANONYMIZE) {
      auto.push({ ...entity, ...(past.restored ? { restored: past.restored } : {}) });
    } else if (past?.decision === IGNORE && IGNORABLE_TYPES.has(String(entity?.type || "org")) && !guarded.has(key)) {
      ignored.push(entity);
    } else {
      review.push(entity);
    }
  }
  return { review, auto, ignored };
}

// Everything a review flow needs after a scan: the rows still to show (with
// aliases assigned), the replacements to apply silently for this run only,
// and the counts the card reports.
export function planPrivacyReview(entities = [], { decisions = [], savedReplacements = [], knownEntities = [] } = {}) {
  const { review, auto, ignored } = applyRememberedDecisions(entities, decisions, {
    protectedTexts: protectedTextSet(knownEntities),
  });
  const autoReplacements = assignAliases(auto, savedReplacements).map((item) => ({
    original: item.text,
    alias: item.alias,
    restored: item.restored || item.text,
    type: item.type,
  }));
  return {
    review: assignAliases(review, [...(savedReplacements || []), ...autoReplacements]),
    autoReplacements,
    remembered: { anonymized: autoReplacements.length, ignored: ignored.length },
  };
}

// Folds the rows of a confirmed review card into the remembered list. A row
// left checked is remembered as "anonymize"; an unchecked row as "ignore",
// when that is allowed for it. A row saved to the permanent replacement list
// needs no decision: it is replaced before the next scan ever sees it.
export function recordPrivacyDecisions(existing = [], reviewed = [], { knownEntities = [] } = {}) {
  const guarded = protectedTextSet(knownEntities);
  const byKey = new Map(normalizePrivacyDecisions(existing).map((item) => [keyOf(item.text), item]));

  for (const row of reviewed || []) {
    const key = keyOf(row?.text);
    if (!key || (row.enabled && row.saveToList)) continue;
    if (!row.enabled && guarded.has(key)) continue;
    const next = normalizeDecision({
      text: row.text,
      type: row.type,
      decision: row.enabled ? ANONYMIZE : IGNORE,
      restored: row.restored,
    });
    if (next) byKey.set(key, next);
  }
  return [...byKey.values()];
}

export function removePrivacyDecision(decisions = [], text) {
  const key = keyOf(text);
  return normalizePrivacyDecisions(decisions).filter((item) => keyOf(item.text) !== key);
}

// The glossary file is the source of truth across machines. When it carries a
// decision list, that list replaces the browser's copy outright rather than
// merging with it: a decision removed on one machine (because the term turned
// out to be sensitive) must not be resurrected from another machine's cache.
// The failure direction is deliberate: a lost decision only means one more
// review row, never one less.
export function decisionsFromConfig(localDecisions, fileDecisions) {
  return Array.isArray(fileDecisions)
    ? normalizePrivacyDecisions(fileDecisions)
    : normalizePrivacyDecisions(localDecisions);
}
