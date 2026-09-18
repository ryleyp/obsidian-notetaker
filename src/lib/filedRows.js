// Which EA Activity rows the CSM has already logged in Salesforce. Persisted
// per browser so a re-run of the same quarter greys them out instead of
// presenting them as new work, and the most recent ones double as few-shot
// examples for the classifier.

const STORAGE_KEY = "sfdc:filed-rows";
const CAP = 400;

const norm = (s) => String(s || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export function filedRowKey(row) {
  return `${row?.eventDate || ""}|${norm(row?.title)}`;
}

// One note is one activity, so the same source on the same day is the same
// record even when a later run titled it differently. This is what lets a
// tick survive regeneration, where titles never come back word for word.
function sourceKey(row) {
  const source = norm(row?.sourceTitle);
  return source ? `${row?.eventDate || ""}|${source}` : "";
}

function titleKeys(row) {
  const keys = [filedRowKey(row)];
  if (norm(row?.improvedTitle)) keys.push(`${row?.eventDate || ""}|${norm(row.improvedTitle)}`);
  return keys;
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
  if (filed) {
    next[filedRowKey(row)] = {
      ts: Date.now(),
      row: {
        eventDate: row.eventDate, title: row.title, improvedTitle: row.improvedTitle || "", type: row.type, subtype: row.subtype,
        comments: row.comments, sourceTitle: row.sourceTitle || "",
      },
    };
  } else {
    // Unticking has to remove the entry however it matched — by either
    // title or by the source note — or the row springs back as filed.
    const source = sourceKey(row);
    for (const key of Object.keys(next)) {
      if (titleKeys(row).includes(key) || (source && sourceKey(next[key]?.row) === source)) delete next[key];
    }
  }
  persist(next);
  return next;
}

export function isFiled(map, row) {
  if (titleKeys(row).some((key) => map[key])) return true;
  const source = sourceKey(row);
  return !!source && Object.values(map).some((entry) => sourceKey(entry?.row) === source);
}

// Most recently filed rows, newest first, for use as prompt examples.
export function recentFiledRows(map, limit = 6) {
  return Object.values(map)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit)
    .map((entry) => entry.row)
    .filter((row) => row && row.title && row.type);
}
