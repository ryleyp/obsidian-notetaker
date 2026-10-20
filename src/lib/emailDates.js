// Extracts the date of the most recent message in a pasted email thread, so
// the note date (and dated filename) can track the thread as replies arrive.
//
// Only header-shaped lines are considered — "Date:", "Sent:", and
// "On ... wrote:" attribution lines — never dates in message bodies, which
// routinely mention deadlines and past events unrelated to when the email
// was sent.

const HEADER_DATE_LINE = /^\s*>*\s*(?:date|sent)\s*:\s*(.+)$/i;
const ON_WROTE_LINE = /^\s*>*\s*on\s+(.+)\s+wrote\s*:?\s*$/i;

function parseDateValue(raw) {
  const cleaned = String(raw || "").trim().replace(/\s+/g, " ");
  if (!cleaned) return null;

  const attempts = [cleaned];
  const atIndex = cleaned.toLowerCase().indexOf(" at ");
  if (atIndex > 0) attempts.push(cleaned.slice(0, atIndex));
  // Attribution lines often trail off into the sender's name
  // ("On Aug 25, 2026, at 2:03 PM, Dana Smith"), so retry with trailing
  // comma-segments removed.
  const parts = cleaned.split(",");
  for (let i = parts.length - 1; i >= 1; i--) {
    attempts.push(parts.slice(0, i).join(","));
  }

  for (const attempt of attempts) {
    // Require an explicit four-digit year so partial fragments like
    // "Tuesday, August 25" don't parse into an arbitrary year.
    if (!/\b20\d{2}\b/.test(attempt)) continue;
    const timestamp = Date.parse(attempt);
    if (Number.isNaN(timestamp)) continue;
    const date = new Date(timestamp);
    const year = date.getFullYear();
    if (year >= 2000 && year <= 2100) return date;
  }
  return null;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// A Teams (or other chat) paste has no Date:/Sent: headers. Its timestamps
// are standalone date-divider lines between messages — "October 10, 2026",
// "Friday, October 10, 2026 2:30 PM", "[10/10/2026 2:30 PM]". A line only
// counts when the WHOLE line (minus brackets) parses as a date, so body
// sentences that mention a date stay ignored; the length cap keeps prose
// that happens to start with a date out too.
const CHAT_DIVIDER_MAX_LENGTH = 48;

function chatDividerDate(line) {
  const bare = line.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!bare || bare.length > CHAT_DIVIDER_MAX_LENGTH) return null;
  return parseDateValue(bare);
}

// Returns the newest send date found in the thread as "YYYY-MM-DD",
// or "" when no header-shaped date is present. Email headers win when the
// paste has any; chat date dividers are only consulted as a fallback, so an
// email body date can never override its real send dates.
export function latestEmailResponseDate(threadText) {
  const lines = String(threadText || "").split("\n");

  let latest = null;
  for (const line of lines) {
    const candidate = line.match(HEADER_DATE_LINE)?.[1] ?? line.match(ON_WROTE_LINE)?.[1];
    if (!candidate) continue;
    const parsed = parseDateValue(candidate);
    if (parsed && (!latest || parsed > latest)) latest = parsed;
  }
  if (latest) return toIsoDate(latest);

  for (const line of lines) {
    const parsed = chatDividerDate(line);
    if (parsed && (!latest || parsed > latest)) latest = parsed;
  }
  return latest ? toIsoDate(latest) : "";
}

// "YYYY-MM-DD" for the local calendar day `days` before `now` (0 = today).
// Built from calendar fields, not by subtracting milliseconds, so a daylight
// saving change never lands the result on the wrong day.
export function isoDateDaysAgo(days = 0, now = new Date()) {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return toIsoDate(date);
}
