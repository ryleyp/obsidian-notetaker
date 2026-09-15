import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { resolveInsideDirectory, uniqueFilePath } from "@/lib/fileSafety";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { EXCLUDED_FOLDERS, walkMarkdownFiles } from "@/lib/vaultScan";
import { groupMovesByAccount, planFiscalYearMoves } from "@/lib/fiscalYearOrganize";

// Filing existing notes into fiscal-year folders, in three modes:
//   "preview" — plan the moves and report them. Writes nothing.
//   "apply"   — carry out the planned moves, recording every one in a
//               manifest so the whole run can be reversed.
//   "undo"    — put the files from the most recent manifest back.
//
// Moving a note is not destructive, so there are no backup copies; the
// manifest is the safety net, and it is exact.

const MANIFEST_DIR = path.join(".notetaker", "organize-fy");
const MAX_MOVES = 5000;

function manifestDir(resolvedVault) {
  return resolveInsideDirectory(resolvedVault, MANIFEST_DIR, "Manifest folder");
}

function latestManifest(resolvedVault) {
  const dir = manifestDir(resolvedVault);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .reverse();
  if (!files.length) return null;
  const filePath = path.join(dir, files[0]);
  try {
    return { id: files[0], filePath, data: JSON.parse(fs.readFileSync(filePath, "utf-8")) };
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const {
      mode = "preview",
      vaultPath,
      includeRollups = false,
      moves: requestedMoves = [],
    } = await request.json();

    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");

    if (mode === "preview") {
      const relativePaths = walkMarkdownFiles(resolvedVault, { skipFolders: EXCLUDED_FOLDERS, maxDepth: 4 })
        .map((file) => path.relative(resolvedVault, file.filePath));
      const { moves, skipped } = planFiscalYearMoves(relativePaths, { includeRollups });
      const undated = skipped.filter((item) => item.reason === "undated" || item.reason === "rollup");

      return NextResponse.json({
        scanned: relativePaths.length,
        moves: moves.slice(0, MAX_MOVES),
        truncated: moves.length > MAX_MOVES,
        accounts: groupMovesByAccount(moves),
        alreadyFiled: skipped.filter((item) => item.reason === "already-filed").length,
        skipped: undated.slice(0, 200),
        skippedCount: undated.length,
        canUndo: !!latestManifest(resolvedVault),
      });
    }

    if (mode === "undo") {
      const manifest = latestManifest(resolvedVault);
      if (!manifest) return NextResponse.json({ error: "There is no organize run to undo." }, { status: 400 });

      let restored = 0;
      let skipped = 0;
      for (const move of [...(manifest.data.moves || [])].reverse()) {
        const from = resolveInsideDirectory(resolvedVault, move.to, "Note");
        const to = resolveInsideDirectory(resolvedVault, move.from, "Note");
        if (!fs.existsSync(from) || fs.existsSync(to)) {
          skipped += 1;
          continue;
        }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        restored += 1;
        // Leave the fiscal-year folder behind only if something else is in it.
        try { fs.rmdirSync(path.dirname(from)); } catch { /* not empty */ }
      }
      fs.rmSync(manifest.filePath, { force: true });
      return NextResponse.json({ restored, skipped, canUndo: !!latestManifest(resolvedVault) });
    }

    // ---- apply ----
    if (!Array.isArray(requestedMoves) || !requestedMoves.length) {
      return NextResponse.json({ error: "Nothing to move — preview first." }, { status: 400 });
    }
    if (requestedMoves.length > MAX_MOVES) {
      return NextResponse.json({ error: `Too many files in one run (limit ${MAX_MOVES}).` }, { status: 400 });
    }

    const applied = [];
    let movedCount = 0;
    let skippedCount = 0;
    for (const move of requestedMoves) {
      const from = resolveInsideDirectory(resolvedVault, move?.from || "", "Note");
      const wantedTo = resolveInsideDirectory(resolvedVault, move?.to || "", "Destination");
      if (path.extname(from).toLowerCase() !== ".md" || path.extname(wantedTo).toLowerCase() !== ".md") {
        skippedCount += 1;
        continue;
      }
      if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
        // Moved or renamed since the preview.
        skippedCount += 1;
        continue;
      }
      fs.mkdirSync(path.dirname(wantedTo), { recursive: true });
      // A same-named note already in that year keeps its file; this one is
      // filed beside it rather than overwriting it.
      const to = uniqueFilePath(wantedTo);
      fs.renameSync(from, to);
      movedCount += 1;
      applied.push({ from: path.relative(resolvedVault, from), to: path.relative(resolvedVault, to) });
    }

    let manifestId = null;
    if (applied.length) {
      const dir = manifestDir(resolvedVault);
      fs.mkdirSync(dir, { recursive: true });
      manifestId = `${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      fs.writeFileSync(
        path.join(dir, manifestId),
        JSON.stringify({ ranAt: new Date().toISOString(), moves: applied }, null, 2),
        "utf-8"
      );
    }

    return NextResponse.json({ moved: movedCount, skipped: skippedCount, manifestId, canUndo: !!manifestId });
  } catch (error) {
    console.error("Organize by fiscal year error:", error);
    return NextResponse.json({ error: error?.message || "Organize failed" }, { status: error?.status || 500 });
  }
}
