// Shared extraction of the note-taker's own action items from a generated
// note, used by the weekly ToDos file and the Todoist push.

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Which action items belong to the note-taker. Role terms are generic, but the
// personal names have to come from configuration — hardcoding one user's name
// put personal data in a public repo and made the feature a no-op for everyone
// else. ownerNames is supplied per request from Settings.
export function isRelevantItem(line, ownerNames = []) {
  const names = ownerNames.map((n) => String(n || "").trim()).filter(Boolean);
  if (names.length) {
    const namePattern = new RegExp(`\\b(${names.map(escapeRegex).join("|")})\\b`, "i");
    if (namePattern.test(line)) return true;
  }
  return /\b(Customer Success|Customer Success Managers?|CSMs?)\b/i.test(line)
    || /\bCS\b/.test(line);
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
