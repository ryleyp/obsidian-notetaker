import { isCanonicalPair } from "./sfdcTaxonomy";

// Bounds runaway model output without colliding with the 800-character
// Salesforce limit the table warns about: truncating at 800 here would
// silently cut a comment the CSM already reviewed and make that warning
// unreachable, so trimming stays the CSM's call.
const MAX_COMMENT_CHARS = 4000;

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
    type,
    subtype,
    comments,
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
    "| Filed | Event Date | Title | Type | Subtype | EA/EP | Comments |",
    "|-------|------------|-------|------|---------|-------|----------|",
    ...rows.map((r) => `| ${r.filed ? "[x]" : "[ ]"} | ${esc(r.eventDate)} | ${esc(r.title)} | ${esc(r.type)} | ${esc(r.subtype)} | ${esc(r.agreement)} | ${esc(r.comments)} |`),
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
export function parseReportTable(markdown) {
  const lines = String(markdown || "").split(/\r?\n/).filter((l) => /^\s*\|/.test(l));
  if (lines.length < 2) return [];
  const header = splitTableRow(lines[0]).map((h) => h.toLowerCase());
  const col = (name) => header.findIndex((h) => h === name);
  const filedIdx = col("filed");
  const dateIdx = col("event date");
  const titleIdx = col("title");
  if (dateIdx < 0 || titleIdx < 0) return [];

  return lines.slice(1)
    .filter((l) => !/^\s*\|\s*-{3,}/.test(l))
    .map(splitTableRow)
    .filter((cells) => cells.length > Math.max(dateIdx, titleIdx))
    .map((cells) => ({
      eventDate: cells[dateIdx] || "",
      title: cells[titleIdx] || "",
      filed: filedIdx >= 0 ? /^\[\s*[xX✓✔]\s*\]$|^(x|yes|✓|✔|☑|true)$/i.test(cells[filedIdx] || "") : false,
    }))
    .filter((r) => r.title);
}
