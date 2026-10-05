export function aliasesFromReplacements(replacements = []) {
  return replacements
    .map((r) => r?.alias)
    .filter(Boolean);
}

const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;

// Email addresses are deterministic enough to detect locally. This keeps them
// out of AI requests even when the optional AI name/company scan is disabled.
export function extractEmailEntities(text = "") {
  const found = new Map();
  for (const match of String(text).matchAll(EMAIL_PATTERN)) {
    const email = match[0];
    const key = email.toLowerCase();
    if (!found.has(key)) found.set(key, { text: email, type: "email" });
  }
  return [...found.values()];
}

export function mergeSensitiveEntities(...groups) {
  const merged = new Map();
  for (const entity of groups.flat()) {
    const text = String(entity?.text || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const normalized = {
      ...entity,
      text,
      type: entity.type === "person" ? "person" : entity.type === "email" ? "email" : "org",
    };
    if (!merged.has(key) || normalized.type === "email") merged.set(key, normalized);
  }
  return [...merged.values()];
}

export function buildSanitizePrompt(transcript, knownAliases = []) {
  const aliasList = knownAliases.length ? knownAliases.join(", ") : "none";

  return `Extract sensitive proper nouns from this text that should be anonymized before sending to an AI.

INCLUDE:
- Person names (first, last, or full names)
- Email addresses
- Company and organization names
- Military branch or government agency names
- Division or business unit names

DO NOT INCLUDE:
- NI Software products: NI, LabVIEW, TestStand, SystemLink, DIAdem, FlexLogger, VeriStand, NI-DAQmx, LabWindows/CVI, Measurement Studio, NI-VISA, OpenTestBed
- Generic terms, job titles, locations, or common words
- Placeholder aliases already present in the text: ${aliasList}
- Any placeholder matching PERSON_#, ORG_#, PERSON_10, ORG_10, etc.

Return ONLY a JSON array, no explanation. Each item: {"text": "exact term", "type": "person", "org", or "email"}
If nothing found, return [].

TEXT:
${transcript}`;
}

// The model answers with a JSON array. A long transcript produces a long
// array, and an answer cut off by the output limit has no closing bracket —
// which used to mean the whole scan silently returned nothing and the review
// card never appeared. Salvage every complete object instead.
function parseEntityArray(raw) {
  const start = raw.indexOf("[");
  if (start === -1) return [];
  const body = raw.slice(start);

  const closed = body.match(/\[[\s\S]*\]/);
  if (closed) {
    try {
      return JSON.parse(closed[0]);
    } catch {
      // Malformed despite having both brackets; fall through and salvage.
    }
  }

  const salvaged = [];
  for (const match of body.matchAll(/\{[^{}]*\}/g)) {
    try {
      salvaged.push(JSON.parse(match[0]));
    } catch {
      // A half-written object at the cut-off point; skip it.
    }
  }
  return salvaged;
}

export function parseEntityList(rawText, knownAliases = []) {
  const raw = rawText?.trim() || "[]";
  const parsed = parseEntityArray(raw);
  const aliases = new Set(knownAliases.map((a) => a.toLowerCase()));

  return parsed
    .filter((item) => item && typeof item.text === "string")
    .map((item) => ({
      text: item.text.trim(),
      type: item.type === "person" ? "person" : item.type === "email" ? "email" : "org",
    }))
    .filter((item) => item.text && !aliases.has(item.text.toLowerCase()))
    .filter((item) => !/^(PERSON|ORG|EMAIL)_\d+$/i.test(item.text));
}
