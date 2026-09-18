// The improved-title pass: fills the Improved Title column for rows that
// have none — harvested SFDC entries written before the field existed and
// reports saved before the column was added. It never touches a title that
// is already there and never rewrites the source name in Title.

const TITLE_CHAR_LIMIT = 200;

// Which rows still need a Salesforce-ready title.
export function rowsNeedingTitles(rows) {
  return (rows || [])
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => row && !String(row.improvedTitle || "").trim());
}

// Reads the model's {"titles":[{"index":n,"title":"..."}]} reply against the
// rows that were sent. Anything malformed, out of range, blank, over the
// Salesforce limit, or repeated is dropped rather than failing the pass:
// a half-filled column beats an empty one.
export function parseTitleProposals(text, sent) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
  } catch {
    return [];
  }
  const allowed = new Set((sent || []).map((r) => r?.index).filter(Number.isInteger));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(parsed?.titles) ? parsed.titles : []) {
    const index = item?.index;
    const title = String(item?.title || "").replace(/\s+/g, " ").trim();
    if (!Number.isInteger(index) || !allowed.has(index) || seen.has(index)) continue;
    if (!title || title.length > TITLE_CHAR_LIMIT) continue;
    seen.add(index);
    out.push({ index, title });
  }
  return out;
}

// Writes proposals into improvedTitle, only where the row has none.
export function applyImprovedTitles(rows, titles) {
  const byIndex = new Map((titles || []).map((t) => [t.index, t.title]));
  return (rows || []).map((row, index) => {
    const title = byIndex.get(index);
    if (!title || String(row?.improvedTitle || "").trim()) return row;
    return { ...row, improvedTitle: title };
  });
}
