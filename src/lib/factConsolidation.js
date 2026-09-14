// Contact/site facts arrive one per mention, so the same person or site
// shows up once per note and once per spelling ("Dana", "Dana Whitfield",
// "Whitfield, Dana"). mergeFacts only drops byte-identical duplicates, which
// leaves the map — and the prompt that builds it — full of near-copies.
//
// This consolidates variants of the same entity into one fact that keeps
// every source and detail. Matching is deliberately conservative: merging
// two different people is far worse than leaving a duplicate, so a short
// name only folds into a longer one when exactly one candidate matches.

const TITLES = new Set(["mr", "mrs", "ms", "miss", "dr", "prof", "sir"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md"]);
// Words that describe a location rather than identify it, so "Dallas" and
// "Dallas Lab" are the same place.
const GENERIC_SITE_WORDS = new Set([
  "lab", "labs", "laboratory", "site", "sites", "campus", "facility", "facilities",
  "office", "offices", "plant", "building", "bldg", "center", "centre", "location", "team",
]);
// Names that identify nobody; extraction picks these up from loose phrasing.
const JUNK_NAMES = new Set([
  "unknown", "n/a", "na", "none", "tbd", "tba", "someone", "somebody", "they", "them",
  "he", "she", "it", "team", "the team", "customer", "the customer", "attendees",
  "others", "everyone", "various", "multiple", "staff", "folks", "people",
]);
const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
const MAX_EVIDENCE_PIECES = 4;
const MAX_EVIDENCE_CHARS = 600;

function tokens(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
}

// Identity key for equality matching: order-independent and free of words
// that don't distinguish one entity from another.
export function nameKey(name, type = "person") {
  const dropped = type === "site" ? GENERIC_SITE_WORDS : new Set([...TITLES, ...SUFFIXES]);
  const kept = tokens(name).filter((token) => !dropped.has(token));
  return (kept.length ? kept : tokens(name)).slice().sort().join(" ");
}

// Extraction sometimes asserts an alias that is simply a different person
// ("Jordan Blake" listed under "Avery Stone"). Trusting those blindly merges two
// real people into one, so an alias only links names it could plausibly be:
// a shared word, an initialism, or one spelling contained in the other.
export function aliasPlausible(name, alias, type = "person") {
  const a = tokens(name);
  const b = tokens(alias);
  if (!a.length || !b.length) return false;

  // A lone word lifted straight out of the name ("Space" from "Acme
  // Aerospace Space") identifies nothing on its own and would pull in every
  // other entity sharing that word. Short forms like this are merged by the
  // ambiguity-checked fold instead, which refuses when more than one
  // candidate matches.
  if (b.length === 1 && a.length > 1 && a.includes(b[0])) return false;

  const shared = b.some((token) => token.length > 2 && a.includes(token));
  if (shared) return true;

  const flat = (list) => list.join("");
  const nameFlat = flat(a);
  const aliasFlat = flat(b);
  // "Priyan" vs "Priyann", "Sunnyvale" vs "Sunnyvale Facility".
  if (nameFlat.includes(aliasFlat) || aliasFlat.includes(nameFlat)) return true;
  // "DW" for "Daniela Whitfield", "AA" for "Acme Aerospace".
  const initials = a.map((token) => token[0]).join("");
  if (aliasFlat.length > 1 && (initials === aliasFlat || initials.startsWith(aliasFlat))) return true;

  return type === "site" && nameKey(name, type) === nameKey(alias, type);
}

export function isJunkName(name) {
  const cleaned = String(name || "").trim().toLowerCase().replace(/^the\s+/, "");
  if (!cleaned) return true;
  if (JUNK_NAMES.has(cleaned) || JUNK_NAMES.has(`the ${cleaned}`)) return true;
  // A "name" with no letters at all identifies nothing.
  return !/\p{L}/u.test(cleaned);
}

const distinct = (values) => [...new Set(values.map((v) => String(v || "").trim()).filter(Boolean))];

// The most complete spelling wins: natural order over "Last, First", then
// most tokens, then longest.
function bestName(names) {
  const listForm = (name) => (name.includes(",") ? 1 : 0);
  return [...names].sort((a, b) => {
    const byForm = listForm(a) - listForm(b);
    if (byForm !== 0) return byForm;
    const byTokens = tokens(b).length - tokens(a).length;
    return byTokens !== 0 ? byTokens : b.length - a.length;
  })[0];
}

function mergeGroup(group) {
  const names = distinct(group.map((f) => f.name));
  const name = bestName(names);
  const newest = [...group].sort((a, b) => String(b.sourceDate || "").localeCompare(String(a.sourceDate || "")))[0];
  const evidence = distinct(group.map((f) => f.evidence))
    .slice(0, MAX_EVIDENCE_PIECES)
    .join(" • ")
    .slice(0, MAX_EVIDENCE_CHARS);

  return {
    ...newest,
    name,
    // Every other spelling becomes an alias so the map can still match them.
    aliases: distinct([...group.flatMap((f) => f.aliases || []), ...names.filter((n) => n !== name)]),
    role: distinct(group.map((f) => f.role)).join("; "),
    organization: distinct(group.map((f) => f.organization)).join("; "),
    site: distinct(group.map((f) => f.site)).join("; "),
    relationship: distinct(group.map((f) => f.relationship)).join("; "),
    evidence,
    confidence: [...group].sort((a, b) => (CONFIDENCE_RANK[b.confidence] || 0) - (CONFIDENCE_RANK[a.confidence] || 0))[0].confidence,
    mergedCount: group.length,
    sources: distinct(group.map((f) => [f.sourceDate, f.sourceTitle].filter(Boolean).join(" — "))),
  };
}

// Folds a single-token name into a longer one ("Dana" → "Dana Whitfield"),
// but only when exactly one longer name contains that token — two Danas
// means we cannot tell which one was meant, so both stay separate.
function foldShortNames(groups, type) {
  if (type !== "person" && type !== "site") return groups;
  const keys = [...groups.keys()];
  const multi = keys.filter((key) => key.split(" ").length > 1);

  for (const key of keys) {
    if (key.split(" ").length !== 1) continue;
    const candidates = multi.filter((longKey) => longKey.split(" ").includes(key));
    if (candidates.length !== 1) continue;
    groups.get(candidates[0]).push(...groups.get(key));
    groups.delete(key);
  }
  return groups;
}

// Returns the consolidated facts plus a report of what changed, so the run
// can show its work instead of silently rewriting the CSM's data.
export function consolidateFacts(facts = []) {
  const usable = [];
  const dropped = [];
  for (const fact of facts) {
    if (!fact?.name || isJunkName(fact.name)) dropped.push(fact?.name || "(unnamed)");
    else usable.push(fact);
  }

  const byType = new Map();
  // Every name and alias a group has been seen under points back at it, so a
  // later fact named only "DW" joins the group that listed "DW" as an alias.
  const lookupByType = new Map();
  for (const fact of usable) {
    const type = fact.type || "person";
    if (!byType.has(type)) byType.set(type, new Map());
    if (!lookupByType.has(type)) lookupByType.set(type, new Map());
    const groups = byType.get(type);
    const lookup = lookupByType.get(type);

    const usableAliases = (fact.aliases || []).filter((alias) => aliasPlausible(fact.name, alias, type));
    const keys = [fact.name, ...usableAliases].map((n) => nameKey(n, type)).filter(Boolean);
    const groupKey = keys.map((key) => lookup.get(key)).find(Boolean) || nameKey(fact.name, type);
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(fact);
    for (const key of keys) if (!lookup.has(key)) lookup.set(key, groupKey);
  }

  const consolidated = [];
  const merges = [];
  for (const [type, groups] of byType) {
    for (const group of foldShortNames(groups, type).values()) {
      const merged = mergeGroup(group);
      consolidated.push(merged);
      if (group.length > 1) {
        merges.push({
          type,
          name: merged.name,
          count: group.length,
          variants: distinct(group.map((f) => f.name)).filter((n) => n !== merged.name),
        });
      }
    }
  }

  consolidated.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  return { facts: consolidated, merges, dropped: distinct(dropped) };
}
