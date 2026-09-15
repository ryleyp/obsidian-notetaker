// Performance-review goals: what the CSM is measured on, how those goals are
// written into generated notes, and how they are read back out.
//
// The contribution section in a note is the durable record — the CSM reviews
// it at save time, and the consolidation tab reads it back without a model
// call, the same way SFDC Activity Entries are harvested.

export const GOAL_SECTION_HEADING = "Goal Contributions";
export const NO_CONTRIBUTIONS = "Nothing noted.";

const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

// Strips list markers, numbering, and heading syntax from a pasted line.
function stripLeader(line) {
  return line
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^#+\s*/, "")
    .trim();
}

// Splits "Name — target" / "Name: target" / "Name - target". An em dash or a
// colon is a deliberate separator; a hyphen only counts when spaced, so
// "Go-to-market adoption" stays one name.
function splitNameAndTarget(text) {
  const match = text.match(/^(.*?)\s*(?:[—–:]|\s-\s)\s*(.+)$/);
  if (!match) return { name: text, target: "" };
  const name = clean(match[1]);
  const target = clean(match[2]);
  return name ? { name, target } : { name: text, target: "" };
}

// Parses goals pasted or uploaded as plain text / Markdown. One goal per
// line; blank lines and section headers without a target are kept as goals
// only when they carry text, so a pasted review document mostly works as-is.
export function parseGoalsText(text) {
  const goals = [];
  const seen = new Set();
  const lines = Array.isArray(text) ? text : String(text || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = stripLeader(rawLine);
    if (!line || line.length > 300) continue;
    // A row of dashes or a table separator is formatting, not a goal.
    if (/^[-=|\s]+$/.test(line)) continue;

    let name = line;
    let target = "";
    // Markdown table row: | Goal | Target |
    if (line.startsWith("|")) {
      const cells = line.split("|").map(clean).filter(Boolean);
      if (!cells.length) continue;
      if (/^goal|^metric|^objective/i.test(cells[0]) && cells.length > 1 && /target|measure/i.test(cells[1])) continue;
      name = cells[0];
      target = cells.slice(1).join(" — ");
    } else {
      ({ name, target } = splitNameAndTarget(line));
    }

    name = clean(name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    goals.push({ name, target: clean(target) });
  }
  return goals;
}

export function goalsToText(goals = []) {
  return goals.map((goal) => (goal.target ? `${goal.name} — ${goal.target}` : goal.name)).join("\n");
}

const normalize = (value) => clean(value).toLowerCase().replace(/[^a-z0-9 ]/g, "");

// Maps a goal name written by the model back to a configured goal. Exact
// normalized match first, then containment either way, so "Case studies" and
// "Case study completion" resolve to the same goal without matching unrelated
// goals that merely share a word.
export function matchGoal(name, goals = []) {
  const wanted = normalize(name);
  if (!wanted) return null;
  const exact = goals.find((goal) => normalize(goal.name) === wanted);
  if (exact) return exact;
  const contained = goals.filter((goal) => {
    const candidate = normalize(goal.name);
    return candidate && (candidate.includes(wanted) || wanted.includes(candidate));
  });
  return contained.length === 1 ? contained[0] : null;
}

// The goals block for a note-generation prompt. Returns "" when no goals are
// configured, so the section is simply omitted rather than asking the model
// to invent goals.
export function formatGoalsForPrompt(goals = []) {
  const usable = goals.filter((goal) => clean(goal.name));
  if (!usable.length) return "";
  return usable
    .map((goal) => `- ${clean(goal.name)}${goal.target ? ` (target: ${clean(goal.target)})` : ""}`)
    .join("\n");
}

// Reads the "## Goal Contributions" section a saved note carries.
export function parseGoalContributions(content) {
  const section = String(content || "").match(
    new RegExp(`## ${GOAL_SECTION_HEADING}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`)
  );
  if (!section) return [];

  const out = [];
  for (const line of section[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;
    const goal = trimmed.match(/\*\*Goal:\*\*\s*([^|]+?)\s*(?:\||$)/i)?.[1];
    if (!goal) continue;
    const contribution = trimmed.match(/\*\*Contribution:\*\*\s*([^|]+?)\s*(?:\||$)/i)?.[1] || "";
    const metric = trimmed.match(/\*\*Metric:\*\*\s*([^|]+?)\s*(?:\||$)/i)?.[1] || "";
    const cleanedGoal = clean(goal);
    const cleanedContribution = clean(contribution);
    if (!cleanedGoal || !cleanedContribution) continue;
    if (/^nothing noted\.?$/i.test(cleanedGoal)) continue;
    out.push({ goal: cleanedGoal, contribution: cleanedContribution, metric: clean(metric) });
  }
  return out;
}

export function formatContributionLine({ goal, contribution, metric }) {
  const parts = [`**Goal:** ${clean(goal)}`, `**Contribution:** ${clean(contribution)}`];
  if (clean(metric)) parts.push(`**Metric:** ${clean(metric)}`);
  return `- ${parts.join(" | ")}`;
}
