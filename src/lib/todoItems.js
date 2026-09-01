// Shared extraction of the note-taker's own action items from a generated
// note, used by the weekly ToDos file and the Todoist push.

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The "**Owner:** Name" value from an action-item line, or "" when the line
// has no owner field (e.g. Next Steps milestones).
export function ownerOfItem(line) {
  const match = String(line || "").match(/\*\*Owner:\*\*\s*([^|]+?)\s*(?:\||$)/);
  return match ? match[1].trim() : "";
}

// Which action items belong to the note-taker. Role terms are generic, but the
// personal names have to come from configuration — hardcoding one user's name
// put personal data in a public repo and made the feature a no-op for everyone
// else. ownerNames is supplied per request from Settings.
//
// When the line has an "**Owner:**" field, only that field is matched — a task
// like "Dana to send <your name> the list — Owner: Dana" is Dana's, not yours.
// Lines without an owner field fall back to whole-line matching.
export function isRelevantItem(line, ownerNames = []) {
  const owner = ownerOfItem(line);
  const target = owner || String(line || "");

  const names = ownerNames.map((n) => String(n || "").trim()).filter(Boolean);
  if (names.length) {
    const namePattern = new RegExp(`\\b(${names.map(escapeRegex).join("|")})\\b`, "i");
    if (namePattern.test(target)) return true;
  }
  // First-person owners only count in an explicit owner field; matching "me"
  // across a whole line would grab nearly everything.
  if (owner && /\b(me|myself|note[- ]?taker)\b/i.test(owner)) return true;
  return /\b(Customer Success|Customer Success Managers?|CSMs?)\b/i.test(target)
    || /\bCS\b/.test(target);
}

export function extractItems(notes, ownerNames = []) {
  const result = { actionItems: [], nextSteps: [] };

  const actionMatch = notes.match(/## Action Items\n([\s\S]*?)(?=\n## |\n---\n|$)/);
  if (actionMatch) {
    result.actionItems = actionMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("- ") && isRelevantItem(l, ownerNames));
  }

  const nextMatch = notes.match(/## Next Steps\n([\s\S]*?)(?=\n## |\n---\n|$)/);
  if (nextMatch) {
    result.nextSteps = nextMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("- ") && isRelevantItem(l, ownerNames));
  }

  return result;
}
