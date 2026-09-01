// Reads the "**Response needed:**" verdict a generated email note carries in
// its Thread Summary, so the Todoist reminder is only created when the thread
// actually leaves a ball in the CSM's court.
//
// Returns { needed: true|false|null, reason }. `null` means the note has no
// parseable verdict (older note format, or the model skipped it) — callers
// should treat that as "create the reminder" so a miss fails safe.
export function parseResponseNeeded(note) {
  const match = String(note || "").match(/\*\*Response needed:\*\*\s*(yes|no)\b\s*(?:[—–:-]\s*)?([^\n]*)/i);
  if (!match) return { needed: null, reason: "" };
  return {
    needed: match[1].toLowerCase() === "yes",
    reason: match[2].trim().replace(/\s*\[[TNEO]\d+\]/g, ""),
  };
}
