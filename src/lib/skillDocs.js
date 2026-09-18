// Builds the reference documents shipped with the EA Activity skill.
//
// The skill has to carry the taxonomy and the quality checks with it, because
// it runs where the app does not. Generating those pages from the same modules
// the app uses means the skill cannot quietly describe a different taxonomy
// than the one the app classifies against — the failure this codebase already
// had once, when note-time and report-time classification disagreed.

import { SFDC_TAXONOMY, activityWritingRules, classificationGuidance } from "./sfdcTaxonomy";
import { COMMENT_CHAR_LIMIT, COMMENT_WORD_LIMIT, LINT_RULES, TITLE_CHAR_LIMIT } from "./activityLint";
import {
  HEALTH_COLOURS,
  HEALTH_LINT_RULES,
  HEALTH_PILLARS,
  HEALTH_SECTIONS,
  HEALTH_SESSION_TYPES,
  HEALTH_TRENDS,
  USAGE_SOURCES,
  healthSessionSections,
  requiredHealthSections,
} from "./healthSession";

const GENERATED_NOTE = "<!-- Generated from src/lib by `npm run skill`. Edit the source, not this file. -->";

export function buildTaxonomyReference() {
  const lines = [
    "# EA engagement taxonomy",
    "",
    GENERATED_NOTE,
    "",
    "Type and Subtype are Salesforce picklist values. Copy them character-for-character;",
    "a near-miss spelling cannot be filed.",
    "",
    "## Choosing a type",
    "",
    classificationGuidance(),
    "",
    "## Writing the record",
    "",
    activityWritingRules(),
    "",
    "## The types",
    "",
  ];

  for (const type of SFDC_TAXONOMY) {
    lines.push(`### ${type.type}`, "", `${type.description}.`, "");
    for (const sub of type.subtypes) {
      lines.push(`- **${sub.name}**${sub.description ? ` — ${sub.description}` : ""}`);
      if (sub.format) lines.push(`  - Comment format: \`${sub.format}\``);
      if (sub.example) lines.push(`  - Example: ${sub.example}`);
    }
    if (type.note) lines.push("", `> ${type.note}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildQualityReference() {
  const rows = LINT_RULES.map((rule) => `| \`${rule.code}\` | ${rule.severity === "hard" ? "Must fix" : "Should fix"} | ${rule.catches} | ${rule.fix} |`);
  const fixable = LINT_RULES.filter((rule) => rule.fixable).map((rule) => `\`${rule.code}\``);

  return `# Quality checks for an activity record

${GENERATED_NOTE}

Run every check before handing a record over. "Must fix" means Salesforce or the
reporting convention rejects it as written; "should fix" means it will read badly to
whoever opens the record.

Hard limits: comment **${COMMENT_CHAR_LIMIT} characters and ${COMMENT_WORD_LIMIT} words**, title **${TITLE_CHAR_LIMIT} characters**.

| Check | Severity | What it catches | How to resolve it |
|-------|----------|-----------------|-------------------|
${rows.join("\n")}

These can be applied mechanically without changing meaning: ${fixable.join(", ")}.
Everything else needs a judgement call — make it, or hand the record back with the
problem named.
`;
}

export function buildHealthSessionReference() {
  const lines = [
    "# Health scorecard session notes",
    "",
    GENERATED_NOTE,
    "",
    "A health scorecard session is a meeting about account health itself: the colours,",
    "the deck, the commitments. The app detects one from the meeting title, the CSM's",
    "own context notes, and the transcript, and asks for extra sections in the note.",
    "Those sections are what the quarterly scorecard is later built from, so this page",
    "describes what each one has to contain.",
    "",
    `Pillars: ${HEALTH_PILLARS.join(", ")}. Colours: ${HEALTH_COLOURS.join(", ")}. Trends: ${HEALTH_TRENDS.join(", ")}.`,
    "",
    "## The kinds of session",
    "",
  ];

  for (const type of HEALTH_SESSION_TYPES) {
    const sections = healthSessionSections(type.id).map((section) => section.heading);
    const required = requiredHealthSections(type.id).map((section) => section.heading);
    lines.push(`### ${type.label}`, "", type.definition, "");
    lines.push(`- Sections asked for: ${sections.join(", ") || "none"}.`);
    lines.push(`- Sections a saved note must carry: ${required.join(", ") || "none"}.`, "");
  }

  lines.push("## The sections", "");
  for (const section of HEALTH_SECTIONS) {
    lines.push(`### ${section.heading}`, "", section.instructions, "");
  }

  lines.push(
    "## Naming a usage figure's source",
    "",
    "Every usage number carries the source it came from, because each source is blind",
    "to something different and the reader cannot tell which number is which:",
    "",
    ...USAGE_SOURCES.map((source) => `- **${source.name}** — ${source.blindSpot}.`),
    "",
    "## Checks on a saved note",
    "",
    "| Check | Severity | What it catches | How to resolve it |",
    "|-------|----------|-----------------|-------------------|",
    ...HEALTH_LINT_RULES.map((rule) => `| \`${rule.code}\` | ${rule.severity === "hard" ? "Must fix" : "Should fix"} | ${rule.catches} | ${rule.fix} |`),
    "",
    "## Logging one of these sessions",
    "",
    "The session itself is usually an internal activity: account planning, or a review",
    "of one account's health with the account team. A manager one-to-one about the",
    "scorecard is not reportable at all. Whatever the record says, the scorecard",
    "content belongs in the note's sections above, not in the activity comment.",
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

export const SKILL_FILES = {
  "reference/taxonomy.md": buildTaxonomyReference,
  "reference/quality-checks.md": buildQualityReference,
  "reference/health-sessions.md": buildHealthSessionReference,
};
