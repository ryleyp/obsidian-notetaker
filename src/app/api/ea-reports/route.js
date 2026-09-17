import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertExistingChildDirectory, resolveInsideDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { folderMarkdownFiles } from "@/lib/vaultScan";
import { parseReportRows } from "@/lib/activityRows";

// The EA Activity reports already saved in a folder, so a report filed weeks
// ago can be reopened and run back through the same lint, verification, and
// improvement passes as a fresh one. Searches the account's fiscal-year
// subfolders too — a report filed last year is still this account's report.
//
//   GET ?vaultPath&folderPath            → the reports in that folder
//   GET ?vaultPath&folderPath&file=<rel> → that report's rows

const REPORT_NAME = /^EA Activity Report\b.*\.md$/i;

export async function GET(request) {
  try {
    assertTrustedRequest(request);
    const { searchParams } = new URL(request.url);
    const vaultPath = searchParams.get("vaultPath");
    const folderPath = searchParams.get("folderPath") || "";
    const file = searchParams.get("file");

    if (!vaultPath) return NextResponse.json({ error: "vaultPath is required" }, { status: 400 });
    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const dir = assertExistingChildDirectory(resolvedVault, folderPath, "Target folder");

    if (file) {
      const filePath = resolveInsideDirectory(resolvedVault, file, "Report");
      if (!fs.existsSync(filePath) || path.extname(filePath).toLowerCase() !== ".md") {
        return NextResponse.json({ error: "That report no longer exists." }, { status: 404 });
      }
      if (!REPORT_NAME.test(path.basename(filePath))) {
        return NextResponse.json({ error: "That file is not an EA Activity Report." }, { status: 400 });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      const rows = parseReportRows(content);
      if (!rows.length) {
        return NextResponse.json({ error: "No activity table found in that report." }, { status: 422 });
      }
      return NextResponse.json({ file, filename: path.basename(filePath), rows });
    }

    const reports = folderMarkdownFiles(resolvedVault, dir)
      .filter((entry) => REPORT_NAME.test(entry.filename))
      .map((entry) => {
        const content = fs.readFileSync(entry.filePath, "utf-8");
        const rows = parseReportRows(content);
        return {
          file: path.relative(resolvedVault, entry.filePath),
          filename: entry.filename,
          folder: entry.folder,
          dateInName: entry.filename.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "",
          modified: fs.statSync(entry.filePath).mtimeMs,
          rowCount: rows.length,
          filedCount: rows.filter((row) => row.filed).length,
        };
      })
      // Newest first by the date in the name, then by modification time so a
      // same-day re-save wins over the original.
      .sort((a, b) => b.dateInName.localeCompare(a.dateInName) || b.modified - a.modified);

    return NextResponse.json({ reports });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Could not read saved reports" }, { status: error?.status || 500 });
  }
}
