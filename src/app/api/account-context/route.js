import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertExistingChildDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { folderMarkdownFiles, EXCLUDED_FILE_PATTERNS } from "@/lib/vaultScan";
import { buildAccountContext } from "@/lib/accountContext";
import { emailThreadKey } from "@/lib/emailThreads";

// A digest of the account's recent notes, so a drafted reply can take the
// account's history into account. Nothing here reaches a model directly: the
// client runs the digest through Privacy Review with the rest of the thread.
export async function GET(request) {
  try {
    assertTrustedRequest(request);

    const { searchParams } = new URL(request.url);
    const vaultPath = searchParams.get("vaultPath") || "";
    const folderPath = searchParams.get("folderPath") || "";
    const threadTitle = searchParams.get("threadTitle") || "";

    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    // The vault root is every account at once; a reply only draws on its own.
    if (!folderPath.trim()) return NextResponse.json({ context: "", sources: [] });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Account folder");
    if (path.resolve(targetDir) === path.resolve(resolvedVault)) {
      return NextResponse.json({ context: "", sources: [] });
    }

    const notes = folderMarkdownFiles(resolvedVault, targetDir, { skipFilePatterns: EXCLUDED_FILE_PATTERNS })
      .map((entry) => ({ filename: entry.filename, content: fs.readFileSync(entry.filePath, "utf-8") }));

    // The thread's own note is sent to the reply in full already.
    const ownKey = emailThreadKey(threadTitle);
    const exclude = (note) => {
      const title = path.basename(note.filename, ".md").match(/^\d{4}-\d{2}-\d{2} - (?:Email|Teams) - (.+?)(?: \(\d+\))?$/i)?.[1];
      return !!ownKey && !!title && emailThreadKey(title) === ownKey;
    };

    return NextResponse.json(buildAccountContext(notes, { exclude }));
  } catch (error) {
    console.error("Account context error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to read account context" },
      { status: error?.status || 500 }
    );
  }
}
