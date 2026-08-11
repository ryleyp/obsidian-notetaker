import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { detectAccount } from "@/lib/accounts";
import {
  resolveInsideDirectory,
  sanitizeFilename,
} from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

// Fallback when the caller doesn't send the accounts config. Derives the
// archive folder from the configured account list rather than a hardcoded
// customer roster, so no real account names live in source.
function mapFolder(selectedFolder, accounts) {
  const { archiveFolder } = detectAccount(selectedFolder, accounts);
  return archiveFolder || "Internal Transcripts";
}

function normalizedContent(value) {
  return String(value || "").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trimEnd();
}

function normalizedTranscriptBody(value) {
  return normalizedContent(value).replace(/^#[^\n]*\n+/, "").trim();
}

function normalizedTitle(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function archivedTranscript(meetingTitle, transcript) {
  return `# ${meetingTitle}\n\n${transcript}\n`;
}

export function findArchivedTranscript(dir, meetingTitle, content) {
  const wantedContent = normalizedTranscriptBody(content);
  const wantedTitle = normalizedTitle(sanitizeFilename(meetingTitle, "Transcript"));
  const titleMatches = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".md") continue;
    const filePath = path.join(dir, entry.name);
    const existingContent = fs.readFileSync(filePath, "utf-8");
    if (normalizedTranscriptBody(existingContent) === wantedContent) {
      return { filePath, identical: true };
    }

    const base = path.basename(entry.name, path.extname(entry.name)).replace(/ \(\d+\)$/, "");
    if (normalizedTitle(base) === wantedTitle) {
      titleMatches.push({ filePath, modified: fs.statSync(filePath).mtimeMs });
    }
  }

  titleMatches.sort((a, b) => {
    const desired = `${sanitizeFilename(meetingTitle, "Transcript")}.md`;
    if (path.basename(a.filePath) === desired) return -1;
    if (path.basename(b.filePath) === desired) return 1;
    return b.modified - a.modified;
  });
  return titleMatches[0] ? { filePath: titleMatches[0].filePath, identical: false } : null;
}

function writeAtomic(filePath, content) {
  const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tempPath, content, "utf-8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const { transcript, meetingTitle, transcriptsPath, folder, accounts } = await request.json();
    if (!transcript || !meetingTitle || !transcriptsPath) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Subfolder comes from the matched account's "Archive folder" setting
    // (editable per account in Settings); hardcoded names are only a
    // fallback for callers that don't send the accounts config.
    const archiveFolder =
      (accounts?.length ? detectAccount(folder, accounts).archiveFolder : null) || mapFolder(folder, accounts);

    const resolvedBase = assertAllowedRoot(transcriptsPath, "Transcripts archive path");
    const dir = resolveInsideDirectory(resolvedBase, archiveFolder, "Archive folder");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const safeTitle = sanitizeFilename(meetingTitle, "Transcript");
    const content = archivedTranscript(meetingTitle, transcript);
    const existing = findArchivedTranscript(dir, meetingTitle, content);
    if (existing?.identical) {
      return NextResponse.json({
        ok: true,
        savedPath: path.relative(resolvedBase, existing.filePath),
        alreadyExists: true,
      });
    }

    const filePath = existing?.filePath || path.join(dir, `${safeTitle}.md`);
    writeAtomic(filePath, content);

    return NextResponse.json({
      ok: true,
      savedPath: path.relative(resolvedBase, filePath),
      updated: !!existing,
    });
  } catch (error) {
    console.error("Save transcript error:", error);
    return NextResponse.json({ ok: true, skipped: true, error: error?.message || "Transcript archive failed" });
  }
}
