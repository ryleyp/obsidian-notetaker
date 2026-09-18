// A health scorecard session is not an ordinary meeting, and a note that
// treats it like one throws away the part that is expensive to rebuild.
//
// These sessions are where pillar colours get set, where the deck itself gets
// torn apart, and where leadership asks the questions that have to be answered
// next quarter. A normal note records the discussion and loses the rest: which
// pillar ended up which colour, who set it, whether it moved during the call,
// which feedback was about the account and which was about the slide, and what
// the CSM leads as against what the CSM is relaying from the account team.
//
// Everything here is generic. Real names, accounts and pronouns come from the
// caller's private config (see docs/private-config.md), never from this file.

import { noteSections } from "./noteSections";

export const HEALTH_PILLARS = [
  "Proficiency & Self Service",
  "Adoption",
  "Sponsors & End Users",
  "Expansion",
  "Renewal",
];

export const HEALTH_COLOURS = ["Green", "Yellow", "Red", "Unknown"];
export const HEALTH_TRENDS = ["Improving", "Flat", "Declining", "Unknown"];

// Sources a usage claim can come from, each with the blind spot that makes it
// wrong to call it "usage" without saying which one it is.
export const USAGE_SOURCES = [
  { name: "Telemetry", blindSpot: "connected machines only" },
  { name: "License manager logs", blindSpot: "only the logs the customer chooses to send" },
  { name: "CRM or BI bookings", blindSpot: "misses a late or misfiled renewal" },
  { name: "Usage slide export", blindSpot: "a point in time, not a live figure" },
  { name: "Email or campaign tooling", blindSpot: "blocked tracking under-reports engagement" },
  { name: "Verbal estimate", blindSpot: "unverified, name who said it" },
];

// `types` decides which sessions are asked for the section; `requiredFor` is
// the narrower list the linter holds a saved note to, so a note is not nagged
// for a section that was optional in the first place.
const SECTION = (id, heading, types, requiredFor, instructions) => ({ id, heading, types, requiredFor, instructions });

// The note layer. Order is the order they appear in the note, immediately
// after Meeting Notes, before the standard callout sections.
export const HEALTH_SECTIONS = [
  SECTION("ratings", "Health Ratings Captured", ["coaching", "am_presync", "leadership_review", "portfolio_rollup", "mixed"], ["coaching", "am_presync", "leadership_review", "portfolio_rollup"], `One row per account per pillar, as a table with these columns: Pillar | Colour | Said By | Changed On Call | Reason Given | Data Source Cited | Green If | Status.
- Cover every pillar: ${HEALTH_PILLARS.join(", ")}, plus an Overall row. A pillar nobody discussed gets a row saying "Not discussed". Never drop the row, because a missing row and an undiscussed pillar mean different things to whoever reads this next.
- Colour is one of ${HEALTH_COLOURS.join(", ")}. When someone says Amber, write Yellow and put their word in Reason Given.
- Changed On Call records a colour that moved during the session, as "Green to Yellow". Otherwise write "No".
- Status is Agreed, Proposed, or Disputed. A colour one person floated is Proposed.
- If a summary sentence for overall health was drafted or reworded live, quote the final version under the table.`),

  SECTION("feedback", "Scorecard Feedback", ["coaching", "am_presync", "leadership_review", "mixed"], ["coaching", "leadership_review"], `Feedback about the scorecard itself, never about the account. Group it under these labels, naming who said each item and citing the source:
- **Framing and narrative**: what story to tell, what to lead with.
- **Wording changes**: quote the before and after when the session gives both.
- **Structure and format**: slides to add, cut, merge, or reorder.
- **Verify before presenting**: numbers, dates, or charts a reviewer questioned.
- **What worked**: praise, in the reviewer's own words where possible.
- **Standing coaching**: guidance that applies to every account, not just this one.`),

  SECTION("questions", "Leadership Questions Asked", ["leadership_review", "am_presync"], ["leadership_review"], `A table of Question | Asked By | Answer Given | Status, where Status is Answered, Partial, or Follow-up owed. These are the questions to have an answer ready for next time, so record the ones that got a weak answer as carefully as the ones that did not get one at all.`),

  SECTION("data", "Usage And Data Claims", ["leadership_review", "am_presync", "portfolio_rollup"], ["leadership_review"], `A table of Claim | Source | Period | Caveat Stated | Conflicts With, covering every usage, seat, machine, bookings, or churn figure discussed. Name the source as one of: ${USAGE_SOURCES.map((source) => source.name).join(", ")}. Record a figure that was dismissed as implausible together with the reason it was dismissed; that reasoning is what stops it coming back next quarter.`),

  SECTION("ownership", "Led Versus Relayed", ["coaching", "am_presync", "leadership_review"], ["coaching", "leadership_review"], `Two lists, because a scorecard that claims the account team's work as the CSM's is as wrong as one that relays it with no attribution:
- **Led by the CSM**: work the CSM ran or executed, with the result.
- **Relayed from others**: work owned by the account manager, account team, product, support, or the customer, with the owner named.
Where the session does not make ownership clear, put the item under Relayed and add "(ownership unclear)".`),

  SECTION("commitments", "Commitments For Next Review", ["coaching", "am_presync", "leadership_review"], ["leadership_review"], `Scorecard-level commitments as checkboxes, each carrying every field:
- [ ] [Commitment] | **Owner:** [name or team] | **Due:** [date or trigger] | **Done when:** [what completion looks like] | **Pillar:** [pillar it moves] | **Dependency:** [blocker or "None"]
Leave the ordinary to-dos in Action Items; add "[scorecard-commitment]" to the matching Action Items line so the two stay connected.
If commitments from a previous review were checked off in this session, list each one with Done, In progress, Blocked, or Dropped.`),

  SECTION("support", "Support Asks Raised", ["leadership_review", "am_presync"], ["leadership_review"], `A table of Ask | Team Being Asked | Status, where Status is New, Standing, or Resolved. Group by the team that can act on it, not by the pillar it came from.`),

  SECTION("cross", "Cross-Account References", ["coaching", "am_presync", "leadership_review", "portfolio_rollup"], [], `Any other customer raised as a precedent or comparison, listed under that customer's name. These are the facts most likely to end up misfiled as this account's, so they live here and nowhere else in the note.`),

  SECTION("verify", "Verify Before Use", ["coaching", "am_presync", "leadership_review", "portfolio_rollup", "mixed"], ["leadership_review"], `- A date or quantity stated two different ways, with both versions quoted.
- A name, product, or site the transcript may have misheard.
- A plan that could be mistaken for an agreement.
- Anything a speaker flagged as unconfirmed.`),
];

export const HEALTH_SESSION_TYPES = [
  {
    id: "coaching",
    label: "Scorecard coaching",
    definition: "The CSM and their manager work the scorecard or its template. The output is feedback on the deck.",
    cues: ["1x1", "1:1", "one on one", "coaching", "scorecard feedback", "healthcard", "health card", "template review"],
  },
  {
    id: "am_presync",
    label: "Account manager pre-sync",
    definition: "The CSM walks the account manager through the deck before the leadership review so nothing lands as a surprise.",
    cues: ["pre-sync", "presync", "pre sync", "pre-brief", "prebrief", "pre-read", "before the review", "ahead of the review"],
  },
  {
    id: "leadership_review",
    label: "Leadership health review",
    definition: "The CSM presents account health to sales and Customer Success leadership.",
    cues: ["health review", "cs health", "customer success health", "quarterly review", "leadership review", "exec review", "executive review"],
  },
  {
    id: "portfolio_rollup",
    label: "Portfolio roll-up",
    definition: "A team session building a one-line health view across several accounts for an executive.",
    cues: ["portfolio", "across accounts", "all accounts", "team meeting", "csm team", "roll-up", "rollup"],
  },
  {
    id: "mixed",
    label: "Health scoring inside another meeting",
    definition: "A regular meeting where health scoring is one topic among several. The layer covers that topic only.",
    cues: [],
  },
];

// A title phrase naming health or the scorecard is enough on its own: these
// sessions are named plainly.
const TITLE_SIGNALS = [
  "health review", "health score", "health scoring", "healthcard", "health card",
  "scorecard", "score card", "cs health", "customer success health", "account health",
];

// These name the occasion rather than the subject. A customer QBR is also a
// "quarterly review", so one of them alone is not enough: it takes two, or one
// plus a scorecard phrase in the body.
const WEAK_TITLE_SIGNALS = [
  "quarterly review", "pre-sync", "presync", "pre sync", "pre-brief", "prebrief",
  "leadership review", "exec review", "executive review", "account review",
];

// In the body, one mention proves nothing: people say "yellow" about anything.
// Three distinct scorecard phrases is the bar for treating an unnamed meeting
// as one of these sessions.
const BODY_SIGNALS = [
  "health score", "health-score", "health scoring", "scorecard", "health scorecard",
  "green if", "support needed", "recommended actions", "pillar", "overall health",
  "adoption rating", "renewal risk",
];
const BODY_SIGNAL_THRESHOLD = 3;

function normalize(value) {
  return String(value || "").toLowerCase();
}

function hits(haystack, needles) {
  return needles.filter((needle) => haystack.includes(needle));
}

export function healthSessionType(id) {
  return HEALTH_SESSION_TYPES.find((type) => type.id === id) || null;
}

export function healthSessionSections(typeId) {
  return HEALTH_SECTIONS.filter((section) => section.types.includes(typeId));
}

// The sections a saved note of this kind has to carry.
export function requiredHealthSections(typeId) {
  return HEALTH_SECTIONS.filter((section) => section.requiredFor.includes(typeId));
}

// Which kind of session this is. Title cues win, because the title is written
// by the CSM and says what the meeting was; body cues only break a tie or
// carry an untitled meeting.
export function detectHealthSession({ title = "", transcript = "", context = "" } = {}) {
  const titleText = normalize(title);
  const bodyText = `${normalize(context)}\n${normalize(transcript)}`;
  const titleSignals = hits(titleText, TITLE_SIGNALS);
  const weakSignals = hits(titleText, WEAK_TITLE_SIGNALS);
  const bodySignals = [...new Set(hits(bodyText, BODY_SIGNALS))];

  const named = titleSignals.length > 0
    || weakSignals.length > 1
    || (weakSignals.length === 1 && bodySignals.length > 0);
  if (!named && bodySignals.length < BODY_SIGNAL_THRESHOLD) {
    return { isHealthSession: false, type: null, signals: [] };
  }

  const scored = HEALTH_SESSION_TYPES
    .filter((type) => type.cues.length)
    .map((type) => ({ id: type.id, score: hits(titleText, type.cues).length * 2 + hits(bodyText, type.cues).length }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const type = scored[0]?.id || (named ? "leadership_review" : "mixed");
  return {
    isHealthSession: true,
    type: named ? type : "mixed",
    signals: [...titleSignals, ...weakSignals, ...bodySignals],
  };
}

// The block that goes into the note-generation prompt. Empty string when this
// is not a health session, so the caller can interpolate it unconditionally.
export function healthSessionPrompt(detection) {
  const resolved = typeof detection === "string" ? { isHealthSession: true, type: detection } : detection;
  if (!resolved?.isHealthSession) return "";
  const type = healthSessionType(resolved.type) || healthSessionType("mixed");
  const sections = healthSessionSections(type.id);
  if (!sections.length) return "";

  const blocks = sections.map((section) => `---

## ${section.heading}

${section.instructions}`);

  return `${blocks.join("\n\n")}

RULES FOR THE SECTIONS ABOVE
- This meeting is a ${type.label.toLowerCase()}: ${type.definition} Those sections belong in the note in the order shown, between Meeting Notes and "Things NI SW Customer Success Should Take Note Of", and carry source citations like the rest of the note.
- They feed the quarterly scorecard, so what is recorded there is what survives the quarter.
- Record only what was said. "Not discussed" is a real answer; an invented colour, owner, date, or figure is worse than a gap.
- Colour words are ${HEALTH_COLOURS.join(", ")}. Trend words are ${HEALTH_TRENDS.join(", ")}. Flat is not declining.
- Never merge two speakers into one person, and never attribute a manager's or reviewer's actions to the note owner.
- Name each person once, under the name they are most often called, and label internal colleagues as internal.
- Keep feedback about the scorecard out of the account sections, and keep another customer's facts in Cross-Account References.`;
}

export const HEALTH_LINT_RULES = [
  { code: "missing-section", severity: "hard", catches: "A section this kind of session is supposed to carry is absent.", fix: "Add the section, or write \"Not discussed\" under it." },
  { code: "alias-token", severity: "hard", catches: "A pseudonymization alias such as PERSON_2 left in the saved note.", fix: "Restore the real name, or cut the line. An alias is meaningless to every later reader." },
  { code: "owner-merged", severity: "hard", catches: "The note owner merged with another speaker, as in \"Owner (Manager)\".", fix: "Re-attribute from the transcript; whoever ran the review is usually not the note owner." },
  { code: "owner-pronoun", severity: "hard", catches: "A pronoun for the note owner that contradicts the configured pronouns.", fix: "Use the configured pronouns, or leave the pronoun out." },
  { code: "pillar-missing", severity: "soft", catches: "A pillar with no row in the ratings table.", fix: "Add the row with \"Not discussed\" rather than leaving the pillar out." },
  { code: "rating-no-colour", severity: "soft", catches: "A ratings row with no colour and no \"Not discussed\".", fix: "Record the colour that was stated, or say it was not discussed." },
  { code: "colour-word", severity: "soft", catches: "\"Amber\" used as a rating outside a quotation.", fix: "Write Yellow, and keep the speaker's wording in the reason column." },
  { code: "duplicate-callout", severity: "soft", catches: "The same person listed twice in the callouts.", fix: "Merge the entries under one name." },
  { code: "unsourced-claim", severity: "soft", catches: "A usage or bookings claim with no source named.", fix: "Name the source and the period, or move the claim to Verify Before Use." },
  { code: "commitment-fields", severity: "soft", catches: "A commitment missing its owner, timing, or completion test.", fix: "Fill in every field; a commitment with no completion test cannot be reviewed next quarter." },
  { code: "cross-account", severity: "soft", catches: "Another customer named outside Cross-Account References.", fix: "Move it into that section, under that customer's name." },
  { code: "stray-punctuation", severity: "soft", catches: "A line ending in stray punctuation left by the generator.", fix: "Delete the trailing character." },
];

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PRONOUN_SETS = {
  she: { all: ["she", "her", "hers", "herself"], subjectAndPossessive: ["she", "her", "hers"] },
  he: { all: ["he", "him", "his", "himself"], subjectAndPossessive: ["he", "his"] },
  they: { all: ["they", "them", "their", "theirs", "themselves"], subjectAndPossessive: [] },
};

// "she/her" configured, and a note that says "Ryley ... his own relationships"
// got the note owner wrong. Only subject and possessive forms are returned:
// an object pronoun ("email him") usually points at someone else in the
// sentence, and "they/them" is too often a generic plural to flag at all.
export function disallowedPronouns(pronouns) {
  const text = normalize(pronouns);
  if (!text) return [];
  const allowed = Object.keys(PRONOUN_SETS).filter((key) => PRONOUN_SETS[key].all.some((word) => new RegExp(`\\b${word}\\b`).test(text)));
  if (!allowed.length) return [];
  return Object.entries(PRONOUN_SETS)
    .filter(([key]) => !allowed.includes(key))
    .flatMap(([, forms]) => forms.subjectAndPossessive);
}

const ALIAS_TOKEN = /\b(?:PERSON|ORG|EMAIL)(?:_[A-Z])?_\d+\b/;
const EM_DASH = /—/;
const STRAY_PUNCTUATION = /[^\s]-[.,]\s*$/m;
const USAGE_CLAIM = /\b(?:usage|machines|seats|licen[cs]es|bookings|churn|consumption|installs)\b/i;
const USAGE_SOURCE_WORDS = /\b(?:telemetry|license manager|licence manager|flexlm|vlm|crm|salesforce|sfdc|tableau|bookings report|usage slide|export|newsletter tooling|per |according to|reported by)\b/i;
const QUOTED = /["“”]([^"“”]{0,400})["“”]/g;
const NOT_DISCUSSED = /not discussed/i;

function sectionByHeading(sections, heading) {
  return sections.find((section) => section.key === heading.toLowerCase()) || null;
}

function tableRows(content) {
  return String(content || "")
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1 && !cells.every((cell) => /^:?-{2,}:?$/.test(cell)));
}

function sentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+|\n/);
}

// Every check a saved health-session note has to pass. Mechanical only: no
// model, no judgement, so it can run on every note every time.
export function lintHealthNote(markdown, { type = "mixed", ownerNames = [], ownerPronouns = "", otherAccounts = [] } = {}) {
  const issues = [];
  const push = (code, severity, message) => issues.push({ code, severity, message });
  const text = String(markdown || "");
  if (!text.trim()) return issues;

  const sections = noteSections(text);
  const expected = requiredHealthSections(type);
  const missing = expected.filter((section) => !sectionByHeading(sections, section.heading));
  if (missing.length) {
    push("missing-section", "hard", `Missing ${missing.length === 1 ? "section" : "sections"}: ${missing.map((section) => section.heading).join(", ")}.`);
  }

  if (ALIAS_TOKEN.test(text)) push("alias-token", "hard", "Contains a pseudonymization alias that was never restored to a real name.");

  const owners = (ownerNames || []).map((name) => String(name || "").trim()).filter(Boolean);
  for (const owner of owners) {
    const paired = new RegExp(`\\b${escapeRegex(owner)}\\s*\\(([^)]{1,40})\\)`, "i");
    const match = text.match(paired);
    if (match && !owners.some((other) => other.toLowerCase() === match[1].trim().toLowerCase())) {
      push("owner-merged", "hard", `"${match[0]}" merges the note owner with someone else.`);
      break;
    }
  }

  const wrongPronouns = disallowedPronouns(ownerPronouns);
  if (owners.length && wrongPronouns.length) {
    const ownerPattern = new RegExp(`\\b(?:${owners.map(escapeRegex).join("|")})\\b`, "i");
    const pronounPattern = new RegExp(`\\b(?:${wrongPronouns.join("|")})\\b`, "i");
    // Only a pronoun that comes after the owner's name in the same sentence
    // can be read as pointing back at them.
    const offending = sentences(text).find((sentence) => {
      const owner = sentence.search(ownerPattern);
      const pronoun = sentence.search(pronounPattern);
      return owner >= 0 && pronoun > owner;
    });
    if (offending) {
      const word = offending.match(pronounPattern)[0];
      const at = offending.search(pronounPattern);
      const excerpt = offending.trim().slice(Math.max(0, at - 60), at + 60).trim();
      push("owner-pronoun", "hard", `"${word}" refers to the note owner, whose pronouns are ${ownerPronouns.trim()}: "...${excerpt}...".`);
    }
  }

  const ratings = sectionByHeading(sections, "Health Ratings Captured");
  if (ratings) {
    const rows = tableRows(ratings.content);
    for (const pillar of HEALTH_PILLARS) {
      if (!rows.some((cells) => cells.some((cell) => cell.toLowerCase().includes(pillar.toLowerCase())))) {
        push("pillar-missing", "soft", `No ratings row for ${pillar}.`);
      }
    }
    const colourPattern = new RegExp(`\\b(?:${HEALTH_COLOURS.join("|")})\\b`, "i");
    const uncoloured = rows.filter((cells) => {
      const line = cells.join(" ");
      const isPillarRow = HEALTH_PILLARS.some((pillar) => line.toLowerCase().includes(pillar.toLowerCase())) || /\boverall\b/i.test(line);
      return isPillarRow && !colourPattern.test(line) && !NOT_DISCUSSED.test(line);
    });
    if (uncoloured.length) push("rating-no-colour", "soft", `${uncoloured.length} ratings row${uncoloured.length === 1 ? "" : "s"} carry no colour and no "Not discussed".`);
  }

  if (/\bamber\b/i.test(text.replace(QUOTED, " "))) {
    push("colour-word", "soft", "Uses Amber as a rating; the scorecard colour is Yellow.");
  }

  const callouts = sectionByHeading(sections, "User-Level Callouts");
  if (callouts) {
    const names = [...callouts.content.matchAll(/^\s*[-*]\s*\*\*(.+?)\*\*/gm)]
      .map((match) => match[1].replace(/\(.*?\)/g, "").trim().toLowerCase())
      .filter(Boolean);
    const seen = new Set();
    const duplicates = names.filter((name) => (seen.has(name) ? true : (seen.add(name), false)));
    if (duplicates.length) push("duplicate-callout", "soft", `Listed twice in the callouts: ${[...new Set(duplicates)].join(", ")}.`);
  }

  const data = sectionByHeading(sections, "Usage And Data Claims");
  if (data) {
    const unsourced = tableRows(data.content).filter((cells) => {
      const line = cells.join(" ");
      return USAGE_CLAIM.test(line) && !USAGE_SOURCE_WORDS.test(line) && !/\bclaim\b/i.test(cells[0] || "");
    });
    if (unsourced.length) push("unsourced-claim", "soft", `${unsourced.length} usage claim${unsourced.length === 1 ? "" : "s"} with no source named.`);
  }

  const commitments = sectionByHeading(sections, "Commitments For Next Review");
  if (commitments) {
    const incomplete = commitments.content
      .split("\n")
      .filter((line) => /^\s*[-*]\s*\[[ xX]\]/.test(line))
      .filter((line) => !(/owner:/i.test(line) && /(due|trigger):/i.test(line) && /done when:/i.test(line)));
    if (incomplete.length) push("commitment-fields", "soft", `${incomplete.length} commitment${incomplete.length === 1 ? "" : "s"} missing an owner, timing, or completion test.`);
  }

  const singleAccountSession = ["coaching", "am_presync", "leadership_review"].includes(type);
  const crossSection = sectionByHeading(sections, "Cross-Account References");
  const outsideCross = crossSection ? text.replace(crossSection.content, " ") : text;
  const strays = (singleAccountSession ? otherAccounts || [] : [])
    .map((account) => String(account || "").trim())
    .filter(Boolean)
    .filter((account) => new RegExp(`\\b${escapeRegex(account)}\\b`, "i").test(outsideCross));
  if (strays.length) push("cross-account", "soft", `Another customer appears outside Cross-Account References: ${strays.join(", ")}.`);

  if (STRAY_PUNCTUATION.test(text)) push("stray-punctuation", "soft", "A line ends in stray punctuation such as \"-.\".");

  return issues;
}
