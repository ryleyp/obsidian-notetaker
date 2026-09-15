import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  assertExistingChildDirectory,
  isPathInside,
  resolveInsideDirectory,
  sanitizeFilename,
  uniqueFilePath,
} from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { stripCitationMarkers } from "@/lib/sourceBundle";
import { resolveFiscalYearDir } from "@/lib/fiscalYearPaths";
import { folderMarkdownFiles } from "@/lib/vaultScan";

// Both lookups below search the selected folder AND its fiscal-year
// subfolders: a note filed under FY2026 is still the same account's note, and
// an email thread that started last fiscal year must keep updating in place
// instead of forking a second copy in the new year.


function normalizedEmailThreadTitle(value) {
  // Reply prefixes stack up ("RE: RE: FW: subject"); strip them before
  // sanitizing so every reply matches the thread's original note.
  const withoutReplyPrefixes = String(value || "").replace(/^(\s*(re|fw|fwd|aw)\s*:\s*)+/i, "");
  return sanitizeFilename(withoutReplyPrefixes)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizedFileContent(value) {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
}

function normalizedTranscriptBody(value) {
  return normalizedFileContent(value).replace(/^#[^\n]*\n+/, "").trim();
}

export function findDuplicateContentFile(vaultRoot, targetDir, notes) {
  const wanted = normalizedTranscriptBody(notes);
  if (!wanted) return null;

  for (const entry of folderMarkdownFiles(vaultRoot, targetDir)) {
    if (normalizedTranscriptBody(fs.readFileSync(entry.filePath, "utf-8")) === wanted) return entry.filePath;
  }
  return null;
}

function emailThreadTitleFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename)).replace(/ \(\d+\)$/, "");
  return base.match(/^\d{4}-\d{2}-\d{2} - Email - (.+)$/i)?.[1] || "";
}

export function findExistingEmailThread(vaultRoot, targetDir, threadTitle, meetingTitle = "") {
  const wanted = normalizedEmailThreadTitle(threadTitle);
  if (!wanted) return null;

  const desiredFilename = `${sanitizeFilename(meetingTitle || "Email Thread")}.md`;
  const matches = folderMarkdownFiles(vaultRoot, targetDir)
    .filter((entry) => normalizedEmailThreadTitle(emailThreadTitleFromFilename(entry.filename)) === wanted)
    .map((entry) => ({ filePath: entry.filePath, filename: entry.filename, modified: fs.statSync(entry.filePath).mtimeMs }))
    .sort((a, b) => {
      if (a.filename === desiredFilename) return -1;
      if (b.filename === desiredFilename) return 1;
      return b.modified - a.modified || a.filename.localeCompare(b.filename);
    });

  return matches[0]?.filePath || null;
}

function replaceExistingNote(finalPath, resolvedVault, notes) {
  const relativeDir = path.dirname(path.relative(resolvedVault, finalPath));
  const backupDir = resolveInsideDirectory(resolvedVault, path.join(".notetaker", "backups", relativeDir), "Backup folder");
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(finalPath, path.extname(finalPath));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `${base}.backup-${stamp}.md`);
  fs.copyFileSync(finalPath, backupPath);

  const tempPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, notes, "utf-8");
    fs.renameSync(tempPath, finalPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
  return backupPath;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      notes: rawNotes,
      vaultPath,
      folderPath,
      meetingTitle,
      existingRelativePath,
      upsertEmailThreadTitle,
      dedupeContent,
      fiscalYearFolders = false,
      fiscalYearFallback = "none",
    } = body;

    // Source markers ([T1], [N2]...) only mean something inside the app's
    // source panel; the vault copy must never carry them.
    const notes = stripCitationMarkers(rawNotes);

    if (!notes) return NextResponse.json({ error: "Notes content is required" }, { status: 400 });
    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Target folder");

    if (dedupeContent && !existingRelativePath) {
      const duplicatePath = findDuplicateContentFile(resolvedVault, targetDir, notes);
      if (duplicatePath) {
        return NextResponse.json({
          savedPath: path.relative(resolvedVault, duplicatePath),
          filename: path.basename(duplicatePath),
          updated: false,
          alreadyExists: true,
          backupPath: null,
        });
      }
    }

    let finalPath;
    let backupPath = null;
    let updated = false;
    let previousTitle = null;

    const matchedEmailPath = !existingRelativePath && upsertEmailThreadTitle
      ? findExistingEmailThread(resolvedVault, targetDir, upsertEmailThreadTitle, meetingTitle)
      : null;

    if (existingRelativePath || matchedEmailPath) {
      finalPath = matchedEmailPath || resolveInsideDirectory(resolvedVault, existingRelativePath, "Existing note");
      // Inside the selected folder, or one of its fiscal-year subfolders.
      if (!isPathInside(targetDir, finalPath)) {
        return NextResponse.json({ error: "Existing note must be in the selected folder" }, { status: 400 });
      }
      if (path.extname(finalPath).toLowerCase() !== ".md") {
        return NextResponse.json({ error: "Existing note must be a Markdown file" }, { status: 400 });
      }
      if (!fs.existsSync(finalPath) || !fs.statSync(finalPath).isFile()) {
        return NextResponse.json({ error: "Existing note was not found" }, { status: 404 });
      }

      backupPath = replaceExistingNote(finalPath, resolvedVault, notes);
      updated = true;
      previousTitle = path.basename(finalPath, path.extname(finalPath));

      // An email-thread update may carry a newer note date. Rename the file so
      // the dated filename tracks the latest response instead of the first one.
      if (matchedEmailPath && meetingTitle) {
        const desiredFilename = `${sanitizeFilename(meetingTitle)}.md`;
        if (desiredFilename !== path.basename(finalPath)) {
          // An updated thread stays in the folder it already lives in, even
          // when its newest date has crossed into the next fiscal year.
          const renamedPath = uniqueFilePath(path.join(path.dirname(finalPath), desiredFilename));
          fs.renameSync(finalPath, renamedPath);
          finalPath = renamedPath;
        }
      }
    } else {
      const title = sanitizeFilename(meetingTitle || "Meeting Notes");
      const filename = `${title}.md`;
      const writeDir = resolveFiscalYearDir(resolvedVault, targetDir, {
        enabled: !!fiscalYearFolders,
        title: meetingTitle,
        fallback: fiscalYearFallback,
      });
      const filePath = path.join(writeDir, filename);
      finalPath = uniqueFilePath(filePath);
      fs.writeFileSync(finalPath, notes, "utf-8");
    }

    const relativeSavedPath = path.relative(resolvedVault, finalPath);
    return NextResponse.json({
      savedPath: relativeSavedPath,
      filename: path.basename(finalPath),
      updated,
      matchedByTitle: !!matchedEmailPath,
      previousMeetingTitle: previousTitle,
      backupPath: backupPath ? path.relative(resolvedVault, backupPath) : null,
    });
  } catch (error) {
    console.error("Error saving note:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save note" },
      { status: error?.status || 500 }
    );
  }
}
