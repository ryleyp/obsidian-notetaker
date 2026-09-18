import { describe, it, expect } from "vitest";
import { eventDateFromNote, parseActivityRows, parseReportRows, parseReportTable, rowsToMarkdown, rowsToNDJSON, sortRowsByDate } from "@/lib/activityRows";

const ROW = { eventDate: "2026-04-12", title: "EA Admin Sync", improvedTitle: "", type: "Strategic Relationship Management", subtype: "EA Admin Sync", comments: "CSM synced with Dana Voss.", agreement: "", sourceTitle: "Q2 Admin Sync", origin: "generated", status: "Completed", suggestedType: "", suggestedSubtype: "", suggestReason: "", review: false, reviewReason: "", verify: "", verifyReason: "" };

describe("parseActivityRows", () => {
  it("parses one JSON object per line", () => {
    const text = `${JSON.stringify(ROW)}\n${JSON.stringify({ ...ROW, title: "Second" })}`;
    const rows = parseActivityRows(text);
    expect(rows).toHaveLength(2);
    expect(rows[1].title).toBe("Second");
  });

  it("ignores a partial trailing line while streaming", () => {
    const text = `${JSON.stringify(ROW)}\n{"eventDate":"2026-05-01","title":"Cut off mid`;
    expect(parseActivityRows(text)).toHaveLength(1);
  });

  it("ignores code fences and commentary lines", () => {
    const text = "```json\n" + JSON.stringify(ROW) + "\n```\nHere are your activities:";
    const rows = parseActivityRows(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("EA Admin Sync");
  });

  it("preserves review flags", () => {
    const flagged = { ...ROW, review: true, reviewReason: "Could be Demo Days" };
    const rows = parseActivityRows(JSON.stringify(flagged));
    expect(rows[0].review).toBe(true);
    expect(rows[0].reviewReason).toBe("Could be Demo Days");
  });

  it("handles pipes inside comments without splitting anything", () => {
    const withPipe = { ...ROW, comments: "Region: AMER | Attendees: 22" };
    const rows = parseActivityRows(JSON.stringify(withPipe));
    expect(rows[0].comments).toBe("Region: AMER | Attendees: 22");
  });

  it("returns empty for blank/undefined input", () => {
    expect(parseActivityRows("")).toEqual([]);
    expect(parseActivityRows(undefined)).toEqual([]);
  });
});

describe("rowsToMarkdown", () => {
  it("renders a well-formed table and escapes pipes in cells", () => {
    const md = rowsToMarkdown([{ ...ROW, comments: "A | B" }]);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| Filed | Status | Event Date | Improved Title | Title | Type | Subtype | EA/EP | Source Note | Comments |");
    expect(lines[2]).toContain("A \\| B");
    // Every line has the same number of unescaped column separators
    const cols = (l) => (l.replace(/\\\|/g, "").match(/\|/g) || []).length;
    expect(cols(lines[2])).toBe(cols(lines[0]));
  });

  it("flattens newlines inside comments", () => {
    const md = rowsToMarkdown([{ ...ROW, comments: "line one\nline two" }]);
    expect(md.split("\n")).toHaveLength(3);
  });
});

describe("source note column", () => {
  it("includes the source note in the saved markdown table", () => {
    const md = rowsToMarkdown([ROW]);
    const lines = md.split("\n");
    const headerCells = lines[0].split("|").map((c) => c.trim());
    const sourceIdx = headerCells.indexOf("Source Note");
    expect(sourceIdx).toBeGreaterThan(-1);
    expect(lines[2].split("|").map((c) => c.trim())[sourceIdx]).toBe("Q2 Admin Sync");
  });
});

describe("round trip", () => {
  it("NDJSON serialization reparses to the same rows", () => {
    const rows = [ROW, { ...ROW, title: "Two", review: true, reviewReason: "why" }];
    expect(parseActivityRows(rowsToNDJSON(rows))).toEqual(rows);
  });
});

describe("origin and agreement passthrough", () => {
  it("defaults origin to generated and keeps harvested markers", () => {
    const rows = parseActivityRows(
      '{"title":"A","comments":"x"}\n{"title":"B","comments":"y","origin":"note","agreement":"EA 1"}'
    );
    expect(rows[0].origin).toBe("generated");
    expect(rows[0].agreement).toBe("");
    expect(rows[1].origin).toBe("note");
    expect(rows[1].agreement).toBe("EA 1");
  });
});

describe("sortRowsByDate", () => {
  it("orders newest first, keeps same-day order, sinks undated rows", () => {
    const rows = [
      { eventDate: "2026-08-01", title: "old" },
      { eventDate: "", title: "undated" },
      { eventDate: "2026-08-20", title: "new-a" },
      { eventDate: "2026-08-20", title: "new-b" },
    ];
    expect(sortRowsByDate(rows).map((r) => r.title)).toEqual(["new-a", "new-b", "old", "undated"]);
  });
});

describe("comment length", () => {
  it("keeps an over-limit reviewed comment so the table can warn instead of silently cutting it", () => {
    const long = "x".repeat(900);
    const [row] = parseActivityRows(JSON.stringify({ ...ROW, comments: long }));
    expect(row.comments).toHaveLength(900);
  });

  it("still bounds runaway model output", () => {
    const [row] = parseActivityRows(JSON.stringify({ ...ROW, comments: "y".repeat(9000) }));
    expect(row.comments).toHaveLength(4000);
  });
});

describe("eventDateFromNote", () => {
  it("takes the date from the source note's title over what the model wrote", () => {
    // A date mentioned inside the meeting ("we'll meet on the 24th") is the
    // classic drift; the note's own date is the activity date.
    expect(eventDateFromNote({ eventDate: "2026-09-24" }, { date: "2026-09-05", title: "Acme Dallas Visit" })).toBe("2026-09-05");
  });

  it("keeps the model's date when the note has none or the row has no source", () => {
    expect(eventDateFromNote({ eventDate: "2026-09-24" }, { date: "", title: "Undated" })).toBe("2026-09-24");
    expect(eventDateFromNote({ eventDate: "2026-09-24" }, null)).toBe("2026-09-24");
    expect(eventDateFromNote({ eventDate: "2026-09-24" }, { date: "Sep 2026" })).toBe("2026-09-24");
  });
});

describe("improved title column", () => {
  it("carries the reviewer's title beside the original through NDJSON and the saved table", () => {
    const [parsed] = parseActivityRows(JSON.stringify({ ...ROW, improvedTitle: "Acme EA Admin Sync - License Server" }));
    expect(parsed.title).toBe("EA Admin Sync");
    expect(parsed.improvedTitle).toBe("Acme EA Admin Sync - License Server");

    const md = rowsToMarkdown([parsed]);
    const header = md.split("\n")[0].split("|").map((c) => c.trim());
    expect(header.indexOf("Improved Title")).toBe(header.indexOf("Event Date") + 1);
    const cells = md.split("\n")[2].split("|").map((c) => c.trim());
    expect(cells[header.indexOf("Improved Title")]).toBe("Acme EA Admin Sync - License Server");
    expect(cells[header.indexOf("Title")]).toBe("EA Admin Sync");
  });

  it("is empty until a reviewer proposes one", () => {
    const [parsed] = parseActivityRows(JSON.stringify(ROW));
    expect(parsed.improvedTitle).toBe("");
  });
});

describe("Filed column round trip", () => {
  it("writes filed state into the table and reads it back", () => {
    const md = rowsToMarkdown([
      { ...ROW, filed: true },
      { ...ROW, title: "Second | pipe", eventDate: "2026-04-13", filed: false },
    ]);
    expect(md.split("\n")[0]).toBe("| Filed | Status | Event Date | Improved Title | Title | Type | Subtype | EA/EP | Source Note | Comments |");
    expect(parseReportTable(md)).toEqual([
      { eventDate: "2026-04-12", title: "EA Admin Sync", improvedTitle: "", sourceTitle: "Q2 Admin Sync", filed: true },
      { eventDate: "2026-04-13", title: "Second | pipe", improvedTitle: "", sourceTitle: "Q2 Admin Sync", filed: false },
    ]);
  });

  it("reads older reports without a Filed column as unfiled, and accepts hand edits", () => {
    const old = [
      "| Event Date | Title | Type | Subtype | EA/EP | Comments |",
      "|------------|-------|------|---------|-------|----------|",
      "| 2026-04-12 | Old Row | T | S |  | c |",
    ].join("\n");
    expect(parseReportTable(old)).toEqual([{ eventDate: "2026-04-12", title: "Old Row", improvedTitle: "", sourceTitle: "", filed: false }]);

    const edited = [
      "| Filed | Event Date | Title | Type | Subtype | EA/EP | Comments |",
      "|---|---|---|---|---|---|---|",
      "| x | 2026-04-12 | Hand Edited | T | S |  | c |",
      "| [X] | 2026-04-13 | Caps | T | S |  | c |",
      "| [ ] | 2026-04-14 | Open | T | S |  | c |",
    ].join("\n");
    expect(parseReportTable(edited).map((r) => r.filed)).toEqual([true, true, false]);
  });
});

describe("parseReportTable source and improved title", () => {
  it("reads the source note and improved title back so filed matching can use them", () => {
    const [row] = parseReportTable(rowsToMarkdown([{ ...ROW, filed: true, improvedTitle: "Q2 Licensing Governance Sync" }]));
    expect(row).toMatchObject({ eventDate: "2026-04-12", title: "EA Admin Sync", improvedTitle: "Q2 Licensing Governance Sync", sourceTitle: "Q2 Admin Sync", filed: true });
  });
});

describe("parseReportRows", () => {
  it("reads a saved report back as complete, editable rows", () => {
    const rows = [
      { ...ROW, filed: true, improvedTitle: "Q2 Licensing Governance Sync", comments: "Summary: Met Dana | Voss. Contribution: CSM advised." },
      { ...ROW, title: "RF User Group", type: "User Groups", subtype: "Demo Days", eventDate: "2026-05-02", status: "Planned" },
    ];
    const reopened = parseReportRows(rowsToMarkdown(rows));

    expect(reopened).toHaveLength(2);
    expect(reopened[0]).toMatchObject({
      eventDate: "2026-04-12",
      title: "EA Admin Sync",
      improvedTitle: "Q2 Licensing Governance Sync",
      type: "Strategic Relationship Management",
      subtype: "EA Admin Sync",
      sourceTitle: "Q2 Admin Sync",
      status: "Completed",
      filed: true,
      // A saved report was reviewed once already.
      origin: "note",
    });
    // The escaped pipe survives the round trip.
    expect(reopened[0].comments).toBe("Summary: Met Dana | Voss. Contribution: CSM advised.");
    expect(reopened[1]).toMatchObject({ status: "Planned", subtype: "Demo Days", filed: false });
  });

  it("reads an older report written before Filed and Status existed", () => {
    const legacy = [
      "| Event Date | Title | Type | Subtype | EA/EP | Source Note | Comments |",
      "|---|---|---|---|---|---|---|",
      "| 2026-04-12 | EA Admin Sync | Strategic Relationship Management | EA Admin Sync | EA 15552 | Q2 Admin Sync | Summary: x. |",
    ].join("\n");
    const rows = parseReportRows(legacy);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "Completed", filed: false, agreement: "EA 15552" });
  });

  it("returns nothing for prose or a table that is not a report", () => {
    expect(parseReportRows("# EA Activity Report\n\nNo table here.")).toEqual([]);
    expect(parseReportRows("| A | B |\n|---|---|\n| 1 | 2 |")).toEqual([]);
    expect(parseReportRows("")).toEqual([]);
  });
});
