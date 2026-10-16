export function aliasesFromReplacements(replacements = []) {
  return replacements
    .map((r) => r?.alias)
    .filter(Boolean);
}

const EMAIL_PATTERN = /\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+\b/gi;
const PHONE_PATTERN = /(?<![\w])(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]\d{3}[ .-]\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?(?!\w)/gi;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+/gi;
const SECRET_PATTERN = /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[opsu]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;
const SPLIT_SECRET_PATTERN = /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{4,}\r?\n[A-Za-z0-9_-]{8,}\b/g;
const CARD_CANDIDATE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/g;
const ADDRESS_PATTERN = /\b\d{1,6}\s+(?:[A-Z0-9][A-Z0-9.'-]*\s+){1,6}(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Lane|Ln\.?|Drive|Dr\.?|Court|Ct\.?|Parkway|Pkwy\.?|Highway|Hwy\.?|Way)\b/gi;
const ORG_SUFFIX_PATTERN = /\b\p{Lu}[\p{L}\p{N}&'.-]*(?:\s+\p{Lu}[\p{L}\p{N}&'.-]*){0,5}\s+(?:Inc\.?|Incorporated|LLC|L\.L\.C\.|Ltd\.?|Limited|Corp\.?|Corporation|Company|Co\.?|University|Institute|Laborator(?:y|ies)|Department|Agency|Command|Division|Group)\b/gu;
const DISPLAY_NAME_PATTERN = /\b(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){1,3})\s*<[^>\s]+@[^>\s]+>/gu;
const SPEAKER_PATTERN = /^\s*(\p{Lu}[\p{L}'-]+(?:,\s*\p{Lu}[\p{L}'-]+|(?:\s+\p{Lu}[\p{L}'-]+){0,3}))\s*(?:\([^\n)]*\))?\s*:/gmu;
const PERSON_CONTEXT_PATTERN = /\b(?:met with|meet with|spoke (?:with|to)|talked (?:with|to)|called|emailed|assigned to|owned by|owner|attendees?|participants?)\s*[:\-]?\s*(\p{Lu}[\p{L}'-]+(?:\s+\p{Lu}[\p{L}'-]+){0,3})/giu;

const COMMON_EMAIL_DOMAINS = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "icloud", "me", "yahoo",
  "aol", "protonmail", "proton", "pm", "hey", "fastmail", "mail",
]);
const PERSON_STOP_WORDS = new Set([
  "action", "agenda", "attendee", "attendees", "cc", "date", "from", "meeting",
  "notes", "participant", "participants", "speaker", "subject", "summary", "team",
  "teams", "to", "unknown", "user", "office", "phone", "email", "ssn", "server",
  "portal", "website", "url", "link", "key", "token", "topic", "title", "project",
  "customer", "company", "organization",
]);
const KNOWN_PUBLIC_TERMS = new Set([
  "ni", "labview", "teststand", "systemlink", "diadem", "flexlogger", "veristand",
  "ni-daqmx", "labwindows/cvi", "measurement studio", "ni-visa", "opentestbed",
]);

function addMatches(found, text, pattern, type, normalize = (value) => value) {
  for (const match of String(text).matchAll(pattern)) {
    const raw = normalize(match[1] || match[0]);
    const value = String(raw || "").trim().replace(/[),.;:]+$/, "");
    if (!value) continue;
    const key = value.toLowerCase();
    if (!found.has(key)) found.set(key, { text: value, type });
  }
}

function validIpv4(value) {
  return value.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
}

function passesLuhn(value) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function plausiblePerson(value) {
  const normalized = value.trim().toLowerCase();
  if (!normalized || /^(?:(?:PERSON|ORG|LOCATION|EMAIL|PHONE|ADDRESS|IP|URL|SECRET|ID)_\d+|PRIVATE_[A-F0-9]{12})$/i.test(value)) return false;
  if (KNOWN_PUBLIC_TERMS.has(normalized)) return false;
  const words = normalized.replace(/,/g, " ").split(/\s+/);
  const originalWords = value.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  return words.every((word) => !PERSON_STOP_WORDS.has(word))
    && originalWords.every((word) => /^\p{Lu}[\p{L}'-]*$/u.test(word));
}

function exactTermRegex(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "i");
}

// Names already configured by the user are a stronger signal than generic
// proper-noun guessing. Only return terms actually present in this payload.
export function extractKnownSensitiveEntities(text = "", knownEntities = []) {
  const source = String(text || "");
  const found = [];
  const seen = new Set();
  for (const entity of knownEntities || []) {
    const value = String(entity?.text || "").trim();
    if (!value || seen.has(value.toLowerCase()) || !exactTermRegex(value).test(source)) continue;
    seen.add(value.toLowerCase());
    found.push({ text: value, type: entity?.type === "person" ? "person" : "org" });
  }
  return found;
}

export function knownPrivacyEntities(settings = {}) {
  const entities = [];
  for (const account of settings.accounts || []) {
    if (account?.name && account.name !== "Internal") entities.push({ text: account.name, type: "org" });
    for (const alias of account?.aliases || []) {
      if (String(alias || "").trim()) entities.push({ text: alias, type: "org" });
    }
  }
  for (const name of settings.ownerNames || []) {
    if (String(name || "").trim()) entities.push({ text: name, type: "person" });
  }
  return entities;
}

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

// This detector is deliberately local and dependency-free. It catches the
// identifiers that can be recognized with high confidence before any text is
// offered to an optional AI-based name/company pass. Conservative contextual
// rules also catch common transcript speaker and attendee formats.
export function extractLocalSensitiveEntities(text = "") {
  const source = String(text || "");
  const found = new Map();

  for (const entity of extractDeterministicSensitiveEntities(source)) {
    found.set(entity.text.toLowerCase(), entity);
  }
  addMatches(found, source, ORG_SUFFIX_PATTERN, "org");

  const textOutsideEmails = source.replace(EMAIL_PATTERN, " ");
  for (const email of extractEmailEntities(source)) {
    const domain = email.text.split("@")[1]?.split(".")[0]?.toLowerCase();
    const mentionedOutsideEmail = domain
      ? new RegExp(`\\b${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(textOutsideEmails)
      : false;
    if (domain && domain.length > 2 && !COMMON_EMAIL_DOMAINS.has(domain) && mentionedOutsideEmail) {
      if (!found.has(domain)) found.set(domain, { text: domain, type: "org" });
    }
  }

  for (const pattern of [DISPLAY_NAME_PATTERN, SPEAKER_PATTERN, PERSON_CONTEXT_PATTERN]) {
    for (const match of source.matchAll(pattern)) {
      const value = String(match[1] || "").trim();
      if (plausiblePerson(value)) found.set(value.toLowerCase(), { text: value, type: "person" });
    }
  }

  return [...found.values()];
}

// High-confidence formats used by the final outbound boundary. Keep this
// separate from heuristic names and organizations so a heading or product
// name cannot block an otherwise safe request.
export function extractDeterministicSensitiveEntities(text = "") {
  const source = String(text || "");
  const found = new Map();
  addMatches(found, source, EMAIL_PATTERN, "email");
  addMatches(found, source, PHONE_PATTERN, "phone");
  addMatches(found, source, SSN_PATTERN, "id");
  addMatches(found, source, SECRET_PATTERN, "secret");
  addMatches(found, source, SPLIT_SECRET_PATTERN, "secret");
  addMatches(found, source, URL_PATTERN, "url");
  addMatches(found, source, ADDRESS_PATTERN, "address");
  for (const match of source.matchAll(IPV4_PATTERN)) {
    if (validIpv4(match[0])) addMatches(found, match[0], IPV4_PATTERN, "ip");
  }
  for (const match of source.matchAll(CARD_CANDIDATE_PATTERN)) {
    if (passesLuhn(match[0])) {
      const value = match[0].trim();
      found.set(value.toLowerCase(), { text: value, type: "id" });
    }
  }
  return [...found.values()];
}

export function mergeSensitiveEntities(...groups) {
  const merged = new Map();
  for (const entity of groups.flat()) {
    const text = String(entity?.text || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    const allowedTypes = new Set(["person", "email", "org", "location", "phone", "address", "ip", "url", "secret", "id"]);
    const normalized = {
      ...entity,
      text,
      type: allowedTypes.has(entity.type) ? entity.type : "org",
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
- Any placeholder matching PRIVATE_<random token>, PERSON_#, ORG_#, LOCATION_#, EMAIL_#, PHONE_#, ADDRESS_#, IP_#, URL_#, SECRET_#, or ID_#.

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
    .filter((item) => !/^(?:(?:PERSON|ORG|LOCATION|EMAIL|PHONE|ADDRESS|IP|URL|SECRET|ID)_\d+|PRIVATE_[A-F0-9]{12})$/i.test(item.text));
}
