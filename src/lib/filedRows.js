// Which EA Activity rows the CSM has already logged in Salesforce. Persisted
// per browser so a re-run of the same quarter greys them out instead of
// presenting them as new work, and the most recent ones double as few-shot
// examples for the classifier.

const STORAGE_KEY = "sfdc:filed-rows";
const CAP = 400;

export function filedRowKey(row) {
  return `${row?.eventDate || ""}|${String(row?.title || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase()}`;
}

export function loadFiledRows() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persist(map) {
  // Oldest entries fall off once the cap is reached.
  const entries = Object.entries(map).sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0)).slice(0, CAP);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Storage may be unavailable; the in-memory map still drives this session.
  }
}

export function markFiled(map, row, filed) {
  const next = { ...map };
  const key = filedRowKey(row);
  if (filed) {
    next[key] = {
      ts: Date.now(),
      row: { eventDate: row.eventDate, title: row.title, type: row.type, subtype: row.subtype, comments: row.comments },
    };
  } else {
    delete next[key];
  }
  persist(next);
  return next;
}

export function isFiled(map, row) {
  return !!map[filedRowKey(row)];
}

// Most recently filed rows, newest first, for use as prompt examples.
export function recentFiledRows(map, limit = 6) {
  return Object.values(map)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit)
    .map((entry) => entry.row)
    .filter((row) => row && row.title && row.type);
}
