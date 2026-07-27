import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { textHasAlias } from "@/lib/accounts";
import { assertExistingChildDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

function parseDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateFromContent(content) {
  const match = content.match(/^#[^\n]*?(\d{4}-\d{2}-\d{2})/m);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

function readFolder(dir, threeMonthsAgo, source, sourceLabel) {
  const notes = [];
  if (!fs.existsSync(dir)) return notes;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return notes; }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    let content;
    try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }

    const date = parseDateFromFilename(entry.name) || parseDateFromContent(content);
    if (!date || date < threeMonthsAgo) continue;

    notes.push({
      filename: entry.name,
      date: date.toISOString().split("T")[0],
      title: entry.name.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, "").replace(/\.md$/, ""),
      content,
      source,
      sourceLabel,
    });
  }
  return notes;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const vaultPath = searchParams.get("vaultPath");
  const folderPath = searchParams.get("folderPath") || "";
  const accountAliases = (searchParams.get("accountAliases") || searchParams.get("accountKeyword") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!vaultPath) {
    return NextResponse.json({ error: "vaultPath is required" }, { status: 400 });
  }

  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid local session" },
      { status: error?.status || 403 }
    );
  }

  let resolvedVault;
  let targetDir;
  try {
    resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Folder");
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid folder" },
      { status: error?.status || 500 }
    );
  }

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  // 1. Primary Obsidian folder notes
  const primaryNotes = readFolder(targetDir, threeMonthsAgo, "obsidian", folderPath || "Vault root");

  // 2. Cross-vault keyword search (other Obsidian subfolders, skipping transcript folders).
  // A note matches if any account alias appears as a whole word in its content.
  let crossVaultNotes = [];
  if (accountAliases.length) {
    let vaultEntries;
    try { vaultEntries = fs.readdirSync(resolvedVault, { withFileTypes: true }); } catch {}
    if (vaultEntries) {
      const excludeName = folderPath.split("/")[0];
      for (const entry of vaultEntries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === excludeName) continue;
        if (entry.name.toLowerCase().includes("transcript")) continue;
        if (entry.name.toLowerCase().includes("todo")) continue;
        const subDir = path.join(resolvedVault, entry.name);
        const candidates = readFolder(subDir, threeMonthsAgo, "cross-vault", entry.name);
        for (const note of candidates) {
          if (accountAliases.some((a) => textHasAlias(note.content, a))) {
            crossVaultNotes.push(note);
          }
        }
      }
    }
  }

  const all = [...primaryNotes, ...crossVaultNotes];
  all.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    // Same day: sort by filename ascending so meeting 1 < 2 < 3 (oldest → newest)
    return a.filename.localeCompare(b.filename);
  });

  return NextResponse.json({
    notes: all,
    total: all.length,
    counts: {
      obsidian: primaryNotes.length,
      crossVault: crossVaultNotes.length,
    },
  });
}
