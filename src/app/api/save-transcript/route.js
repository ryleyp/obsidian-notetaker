import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { detectAccount } from "@/lib/accounts";
import {
  resolveInsideDirectory,
  sanitizeFilename,
  uniqueFilePath,
} from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

// Legacy fallback when the caller doesn't send the accounts config.
function mapFolder(selectedFolder) {
  const f = (selectedFolder || "").toLowerCase();
  if (f.includes("lockheed")) return "LM Transcripts";
  if (f.includes("l3harris") || f.includes("l3 harris")) return "L3 Transcripts";
  if (f.includes("northrop")) return "NGC Transcripts";
  if (f.includes("frontgrade")) return "Frontgrade Transcripts";
  return "Internal Transcripts";
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
      (accounts?.length ? detectAccount(folder, accounts).archiveFolder : null) || mapFolder(folder);

    const resolvedBase = assertAllowedRoot(transcriptsPath, "Transcripts archive path");
    const dir = resolveInsideDirectory(resolvedBase, archiveFolder, "Archive folder");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const safeTitle = sanitizeFilename(meetingTitle, "Transcript");
    const filePath = uniqueFilePath(path.join(dir, `${safeTitle}.md`));
    fs.writeFileSync(filePath, `# ${meetingTitle}\n\n${transcript}\n`, "utf-8");

    return NextResponse.json({ ok: true, savedPath: path.relative(resolvedBase, filePath) });
  } catch (error) {
    console.error("Save transcript error:", error);
    return NextResponse.json({ ok: true, skipped: true, error: error?.message || "Transcript archive failed" });
  }
}
