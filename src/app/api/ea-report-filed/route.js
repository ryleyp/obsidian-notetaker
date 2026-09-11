import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertExistingChildDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { parseReportTable } from "@/lib/activityRows";

// The Filed column of the most recent saved EA Activity Report in a folder —
// so a report edited in Obsidian (or saved from another machine) still tells
// the next run which rows are already logged in Salesforce.
export async function GET(request) {
  try {
    assertTrustedRequest(request);
    const { searchParams } = new URL(request.url);
    const vaultPath = searchParams.get("vaultPath");
    const folderPath = searchParams.get("folderPath") || "";
    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const dir = assertExistingChildDirectory(resolvedVault, folderPath, "Target folder");

    const reports = fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && /^EA Activity Report\b.*\.md$/i.test(e.name))
      .map((e) => {
        const filePath = path.join(dir, e.name);
        const dateInName = e.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "";
        return { filePath, name: e.name, dateInName, mtimeMs: fs.statSync(filePath).mtimeMs };
      })
      // Newest report first: by the date in its name, then by modification time
      // so "(1)" re-saves of the same day win over the original.
      .sort((a, b) => b.dateInName.localeCompare(a.dateInName) || b.mtimeMs - a.mtimeMs);

    if (!reports.length) return NextResponse.json({ report: null, rows: [] });

    const latest = reports[0];
    const rows = parseReportTable(fs.readFileSync(latest.filePath, "utf-8"));
    return NextResponse.json({
      report: { filename: latest.name, relativePath: path.relative(resolvedVault, latest.filePath) },
      rows,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to read report" }, { status: error?.status || 500 });
  }
}
