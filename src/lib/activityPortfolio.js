// Portfolio-level review of a whole EA Activity report.
//
// The row-level lint answers "can this row be posted?". This answers the
// question a manager asks of the report as a whole: does the shape of the
// quarter look like real customer coverage, or like a pile of internal
// meetings and duplicates? Deterministic — no model, no cost, so it can sit
// under the table and update as rows are edited.

import { SFDC_TAXONOMY } from "./sfdcTaxonomy";

const INTERNAL_TYPE = "Internal Alignment & Collaboration";

// A quarter of customer-success work that is more than a third internal is
// worth a second look; these are review prompts, not rules.
const INTERNAL_SHARE_LIMIT = 0.35;
const CONCENTRATION_LIMIT = 0.6;
const OTHER_SHARE_LIMIT = 0.2;
const QUIET_GAP_DAYS = 45;
const DEPTH_MIN_ROWS = 5;

// Senior stakeholders the coverage review looks for. An account logged
// entirely against its admin has no visibility above the person who
// administers the licences.
const SENIOR_ROLE = /\b(?:director|manager|sponsor|VP|vice president|head of|chief|CTO|CIO|executive|principal)\b/i;

// People named in a comment: two capitalised words in a row, minus the
// labels and acronyms that are not people.
const NOT_A_PERSON = new Set([
  "Summary", "Contribution", "Outcomes", "Outcome", "Next", "Region", "Attendees",
  "Participants", "Type", "Subtype", "None", "The", "This", "That", "EA", "EP",
  "NI", "CSM", "FAE", "AM", "IT",
  // Titles and roles pair up like names ("Admin Lead", "Engineering Director").
  "Admin", "Administrator", "Lead", "Manager", "Director", "Engineer", "Engineering",
  "Sponsor", "Architect", "Technician", "Scientist", "Analyst", "Owner", "Principal",
  "Supervisor", "Vice", "President", "Head", "Chief", "Executive", "Team", "Group",
  "User", "Site", "Lab", "Server", "License", "Training", "Support", "Account",
]);

function namedPeople(rows) {
  const names = new Set();
  for (const row of rows) {
    for (const match of String(row?.comments || "").matchAll(/\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b/g)) {
      if (NOT_A_PERSON.has(match[1]) || NOT_A_PERSON.has(match[2])) continue;
      names.add(`${match[1]} ${match[2]}`.toLowerCase());
    }
  }
  return names;
}

const normalizeTitle = (title) => String(title || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

function daysBetween(earlier, later) {
  return Math.round((later - earlier) / 86_400_000);
}

export function reviewActivityPortfolio(rows = [], { rangeStart = "", rangeEnd = "", today = new Date() } = {}) {
  const findings = [];
  const add = (code, message) => findings.push({ code, message });
  const total = rows.length;
  if (!total) return { findings, stats: { total: 0, internal: 0, customerFacing: 0, other: 0, byType: [], stalePlanned: 0 } };

  const counts = new Map();
  for (const row of rows) {
    const type = String(row?.type || "").trim() || "(no type)";
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, count, share: count / total }))
    .sort((a, b) => b.count - a.count);

  const internal = counts.get(INTERNAL_TYPE) || 0;
  const customerFacing = total - internal;
  const other = rows.filter((row) => row?.type === "Other" || row?.subtype === "Other").length;

  if (internal / total > INTERNAL_SHARE_LIMIT) {
    add("internal-heavy", `${internal} of ${total} activities are internal alignment. A reviewer reads that as thin customer-facing coverage.`);
  }

  const top = byType[0];
  if (byType.length > 1 && top.share > CONCENTRATION_LIMIT) {
    add("concentrated", `${Math.round(top.share * 100)}% of the report is "${top.type}". Check whether other real work went unlogged rather than manufacturing variety.`);
  }

  if (other / total > OTHER_SHARE_LIMIT) {
    add("other-heavy", `${other} of ${total} rows are filed under "Other". Repeated "Other" usually means a misclassification or a genuine taxonomy gap worth raising.`);
  }

  // Same title on the same day, or the same title twice in a week: either a
  // duplicate, or a recurring engagement that collapsed into one row.
  const byTitle = new Map();
  for (const row of rows) {
    const key = normalizeTitle(row?.title);
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(row);
  }
  const duplicates = [...byTitle.values()].filter((group) => {
    if (group.length < 2) return false;
    const dates = group.map((row) => String(row?.eventDate || "")).filter(Boolean).sort();
    return dates.length < 2 || dates[0] === dates[dates.length - 1];
  });
  if (duplicates.length) {
    add("duplicates", `${duplicates.length} title${duplicates.length !== 1 ? "s appear" : " appears"} more than once on the same date — likely duplicates: ${duplicates.slice(0, 3).map((g) => `"${g[0].title}"`).join(", ")}.`);
  }

  const missingAgreement = rows.filter((row) => !String(row?.agreement || "").trim()).length;
  if (missingAgreement && missingAgreement < total) {
    add("missing-agreement", `${missingAgreement} of ${total} rows carry no EA/EP number while the rest do — reporting fragments when the identifier is inconsistent.`);
  }

  // A long silent stretch inside the range, which is what a coverage review
  // actually looks for.
  const dated = rows
    .map((row) => String(row?.eventDate || ""))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (dated.length) {
    const points = [rangeStart, ...dated, rangeEnd].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
    let worst = { gap: 0, from: "", to: "" };
    for (let i = 1; i < points.length; i += 1) {
      const gap = daysBetween(new Date(`${points[i - 1]}T12:00:00`), new Date(`${points[i]}T12:00:00`));
      if (gap > worst.gap) worst = { gap, from: points[i - 1], to: points[i] };
    }
    if (worst.gap > QUIET_GAP_DAYS) {
      add("coverage-gap", `${worst.gap} days with no logged activity (${worst.from} → ${worst.to}). Either work went unlogged or the account was genuinely quiet — both are worth knowing before this is reviewed.`);
    }
  }

  // Status hygiene: what a quarter-end review catches first.
  const stalePlanned = rows.filter((row) => {
    const date = String(row?.eventDate || "");
    return row?.status === "Planned" && /^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T12:00:00`) < today;
  }).length;
  if (stalePlanned) {
    add("stale-planned", `${stalePlanned} record${stalePlanned !== 1 ? "s are" : " is"} still Planned after their date. Update them with what happened or cancel them before this period closes.`);
  }

  // Stakeholder depth — an account carried by one contact, or logged
  // entirely below the level where renewals are decided.
  if (total >= DEPTH_MIN_ROWS) {
    const people = namedPeople(rows);
    if (people.size === 1) {
      add("single-contact", `Every activity names the same one contact. An account resting on a single relationship is a risk worth naming before someone else notices it.`);
    } else if (people.size === 0) {
      add("no-contacts", "No customer contact is named anywhere in the report — a reader cannot tell who this account's relationships are with.");
    }
    if (!rows.some((row) => SENIOR_ROLE.test(String(row?.comments || "")))) {
      add("no-senior-stakeholder", "No director, manager, or sponsor appears in any activity. Coverage reviews read that as engagement below the level where renewals are decided.");
    }
  }

  const unclassified = rows.filter((row) => {
    const entry = SFDC_TAXONOMY.find((t) => t.type === row?.type);
    return !entry || !entry.subtypes.some((sub) => sub.name === row?.subtype);
  }).length;
  if (unclassified) {
    add("unclassified", `${unclassified} row${unclassified !== 1 ? "s do" : " does"} not carry a valid Type/Subtype pair and cannot be filed as written.`);
  }

  return {
    findings,
    stats: { total, internal, customerFacing, other, byType, stalePlanned },
  };
}
