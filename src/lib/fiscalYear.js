// Fiscal-year filing. The fiscal year runs October 1 through September 30 and
// is named for the year it ENDS in, so October 2025 through September 2026 is
// FY2026.
//
// A note's fiscal year comes from the date in its title, which is the date the
// CSM typed for the meeting — not the file's timestamp, which changes whenever
// a note is edited. A note with no date in its title has no fiscal year and is
// left where it is rather than guessed at.

export const FY_START_MONTH = 9; // October, zero-indexed

const FOLDER_PATTERN = /^FY(\d{4})$/i;

export function fiscalYearForDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return null;
  // On or after October 1 the new fiscal year has started, and it is named
  // for the calendar year it ends in.
  return d.getMonth() >= FY_START_MONTH ? d.getFullYear() + 1 : d.getFullYear();
}

export function fiscalYearFolderName(fiscalYear) {
  return Number.isFinite(fiscalYear) ? `FY${fiscalYear}` : "";
}

export function isFiscalYearFolderName(name) {
  return FOLDER_PATTERN.test(String(name || "").trim());
}

export function fiscalYearFromFolderName(name) {
  const match = String(name || "").trim().match(FOLDER_PATTERN);
  return match ? Number(match[1]) : null;
}

// The YYYY-MM-DD a note title carries, or "" — the same rule the Todoist due
// dates and the note filenames already use.
export function dateFromTitle(title) {
  return String(title || "").match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
}

// The FY folder a titled note belongs in ("FY2026"), or "" when its title
// carries no date.
export function fiscalYearFolderForTitle(title) {
  const iso = dateFromTitle(title);
  if (!iso) return "";
  // Parsed at midday so a timezone offset cannot push the date across a day
  // boundary and, on October 1 or September 30, across a fiscal year.
  return fiscalYearFolderName(fiscalYearForDate(new Date(`${iso}T12:00:00`)));
}

export function currentFiscalYearFolder(now = new Date()) {
  return fiscalYearFolderName(fiscalYearForDate(now));
}

// "October 2025 – September 2026", for labelling a folder in the UI.
export function fiscalYearRangeLabel(fiscalYear) {
  if (!Number.isFinite(fiscalYear)) return "";
  return `October ${fiscalYear - 1} – September ${fiscalYear}`;
}
