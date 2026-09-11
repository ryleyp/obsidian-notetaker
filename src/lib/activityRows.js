// EA Activity structured rows: the synthesize API streams newline-delimited
// JSON (one activity per line). Parsing is tolerant of partial trailing
// lines (mid-stream), code fences, and stray commentary.

export function parseActivityRows(text) {
  const rows = [];
  for (const rawLine of (text || "").split("\n")) {
    const line = rawLine.trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    if (!line.startsWith("{")) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!obj || typeof obj !== "object") continue;
    if (!obj.title && !obj.comments) continue;
    rows.push({
      eventDate: obj.eventDate || "",
      title: obj.title || "",
      type: obj.type || "",
      subtype: obj.subtype || "",
      comments: obj.comments || "",
      agreement: obj.agreement || "",
      sourceTitle: obj.sourceTitle || "",
      // "note" = harvested from the note's own reviewed SFDC entry;
      // "generated" (default) = classified by Claude from the note body.
      origin: obj.origin === "note" ? "note" : "generated",
      // A classification second opinion the CSM can apply or dismiss.
      suggestedType: obj.suggestedType || "",
      suggestedSubtype: obj.suggestedSubtype || "",
      suggestReason: obj.suggestReason || "",
      review: !!obj.review,
      reviewReason: obj.reviewReason || "",
      // Post-generation verification verdict (set by the verify pass).
      verify: obj.verify || "",
      verifyReason: obj.verifyReason || "",
    });
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
