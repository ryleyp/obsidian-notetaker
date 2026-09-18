import { isCanonicalPair } from "./sfdcTaxonomy";

// Bounds runaway model output without colliding with the 800-character
// Salesforce limit the table warns about: truncating at 800 here would
// silently cut a comment the CSM already reviewed and make that warning
// unreachable, so trimming stays the CSM's call.
const MAX_COMMENT_CHARS = 4000;

// A record is Completed unless it is a real future commitment (Planned) or
// something that did not happen (Canceled). Notes describe meetings that
// already occurred, so Completed is the default everywhere.
export const STATUSES = ["Completed", "Planned", "Canceled"];

// EA Activity structured rows: the synthesize API streams newline-delimited
// JSON (one activity per line). Parsing is tolerant of partial trailing
// lines (mid-stream), code fences, and stray commentary.

export function normalizeActivityRow(obj) {
  if (!obj || typeof obj !== "object") return null;
  const title = String(obj.title || "").trim().slice(0, 200);
  const comments = String(obj.comments || "").trim().slice(0, MAX_COMMENT_CHARS);
  if (!title && !comments) return null;
  const eventDate = String(obj.eventDate || "").trim();
  const type = String(obj.type || "").trim();
  const subtype = String(obj.subtype || "").trim();
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDate);
  const validClassification = isCanonicalPair(type, subtype);
  const validationReason = [!validDate && "Event date must be YYYY-MM-DD.", !validClassification && "Type and subtype must match the Salesforce taxonomy."].filter(Boolean).join(" ");
  const row = {
    eventDate,
    title,
    // The reviewer's proposed title, kept beside the original rather than
    // replacing it, so the report shows both.
    improvedTitle: String(obj.improvedTitle || "").trim().slice(0, 200),
    type,
    subtype,
    comments,
    status: STATUSES.includes(obj.status) ? obj.status : "Completed",
    agreement: String(obj.agreement || "").trim(),
    sourceTitle: String(obj.sourceTitle || "").trim(),
    origin: obj.origin === "note" ? "note" : "generated",
    suggestedType: String(obj.suggestedType || ""),
    suggestedSubtype: String(obj.suggestedSubtype || ""),
    suggestReason: String(obj.suggestReason || ""),
    review: !!obj.review || !!validationReason,
    reviewReason: String(obj.reviewReason || validationReason),
    verify: ["passed", "failed"].includes(obj.verify) ? obj.verify : "",
    verifyReason: String(obj.verifyReason || ""),
  };
  if (obj.verifySource !== undefined) row.verifySource = String(obj.verifySource || "");
  if (obj.verifyEvidence !== undefined) row.verifyEvidence = String(obj.verifyEvidence || "").slice(0, 240);
  return row;
}

export function parseActivityRows(text) {
  const rows = [];
  const input = String(text || "").trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(input);
    const collection = Array.isArray(parsed) ? parsed : parsed?.rows;
    if (Array.isArray(collection)) return collection.map(normalizeActivityRow).filter(Boolean);
  } catch {}
  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    if (!line.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    const row = normalizeActivityRow(obj);
    if (row) rows.push(row);
  }
  return rows;
}

export function rowsToNDJSON(rows) {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}

const esc = (s) => (s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();

// The activity date is the date in the source note's title. The model is
// told to copy it, but can drift to a date mentioned inside the meeting, so
// the note wins whenever it carries one.
export function eventDateFromNote(row, note) {
  const noteDate = String(note?.date || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(noteDate) ? noteDate : row?.eventDate || "";
}

// Newest first; rows without a date sink to the bottom. Stable for ties so
// Claude's emission order survives within a day.
export function sortRowsByDate(rows) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const ad = a.row.eventDate || "";
      const bd = b.row.eventDate || "";
      if (ad !== bd) return ad ? (bd ? bd.localeCompare(ad) : -1) : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

// Markdown table used for Save to Obsidian / Copy All. The Filed column is
// the durable record of what has been logged in Salesforce: tick it here or
// in Obsidian ("[x]") and the next run of the same folder honors it.
export function rowsToMarkdown(rows) {
  const lines = [
    "| Filed | Status | Event Date | Improved Title | Title | Type | Subtype | EA/EP | Source Note | Comments |",
    "|-------|--------|------------|----------------|-------|------|---------|-------|-------------|----------|",
    ...rows.map((r) => `| ${r.filed ? "[x]" : "[ ]"} | ${esc(r.status || "Completed")} | ${esc(r.eventDate)} | ${esc(r.improvedTitle)} | ${esc(r.title)} | ${esc(r.type)} | ${esc(r.subtype)} | ${esc(r.agreement)} | ${esc(r.sourceTitle)} | ${esc(r.comments)} |`),
  ];
  return lines.join("\n");
}

const unesc = (s) => String(s || "").replace(/\\\|/g, "|").trim();

function splitTableRow(line) {
  // Split on unescaped pipes; drop the empty edge cells.
  const cells = line.split(/(?<!\\)\|/).map(unesc);
  return cells.slice(1, cells.length - 1);
}

// Reads a saved EA Activity Report table back into [{ eventDate, title,
// filed }]. Tolerates the older table without a Filed column (every row
// unfiled) and any column order, keyed off the header row.
const TICKED = /^\[\s*[xX✓✔]\s*\]$|^(x|yes|✓|✔|☑|true)$/i;

// Reads a saved EA Activity Report table into cells keyed by column name.
// Tolerates any column order and the older tables without Filed or Status,
// keyed off the header row.
function readTable(markdown) {
  const lines = String(markdown || "").split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  if (lines.length < 2) return null;
  const header = splitTableRow(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => header.findIndex((h) => h === name);
  const dateIdx = col("event date");
  const titleIdx = col("title");
  if (dateIdx < 0 || titleIdx < 0) return null;

  const rows = lines.slice(1)
    .filter((l) => !/^\s*\|\s*-{3,}/.test(l))
    .map(splitTableRow)
    .filter((cells) => cells.length > Math.max(dateIdx, titleIdx));
  return { col, dateIdx, titleIdx, rows };
}

export function parseReportTable(markdown) {
  const table = readTable(markdown);
  if (!table) return [];
  const filedIdx = table.col("filed");
  return table.rows
    .map((cells) => ({
      eventDate: cells[table.dateIdx] || "",
      title: cells[table.titleIdx] || "",
      filed: filedIdx >= 0 ? TICKED.test(cells[filedIdx] || "") : false,
    }))
    .filter((r) => r.title);
}

// The whole saved report back as editable rows, so a report filed weeks ago
// can be reopened and put through the same lint, verification, and
// improvement passes as a fresh one.
export function parseReportRows(markdown) {
  const table = readTable(markdown);
  if (!table) return [];
  const idx = {
    filed: table.col("filed"),
    status: table.col("status"),
    improvedTitle: table.col("improved title"),
    type: table.col("type"),
    subtype: table.col("subtype"),
    agreement: table.col("ea/ep"),
    sourceTitle: table.col("source note"),
    comments: table.col("comments"),
  };
  const cell = (cells, at) => (at >= 0 ? cells[at] || "" : "");

  return table.rows
    .map((cells) => {
      const row = normalizeActivityRow({
        eventDate: cells[table.dateIdx] || "",
        title: cells[table.titleIdx] || "",
        improvedTitle: cell(cells, idx.improvedTitle),
        type: cell(cells, idx.type),
        subtype: cell(cells, idx.subtype),
        agreement: cell(cells, idx.agreement),
        sourceTitle: cell(cells, idx.sourceTitle),
        comments: cell(cells, idx.comments),
        status: cell(cells, idx.status),
        // A saved report's rows were already reviewed once; treat them as
        // reviewed material rather than fresh model output.
        origin: "note",
      });
      if (!row) return null;
      return { ...row, filed: idx.filed >= 0 ? TICKED.test(cell(cells, idx.filed)) : false };
    })
    .filter((row) => row && row.title);
}
