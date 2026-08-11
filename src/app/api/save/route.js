import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  assertExistingChildDirectory,
  resolveInsideDirectory,
  sanitizeFilename,
  uniqueFilePath,
} from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { notes, vaultPath, folderPath, meetingTitle, existingRelativePath } = body;

    if (!notes) return NextResponse.json({ error: "Notes content is required" }, { status: 400 });
    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Target folder");

    let finalPath;
    let backupPath = null;
    let updated = false;

    if (existingRelativePath) {
      finalPath = resolveInsideDirectory(resolvedVault, existingRelativePath, "Existing note");
      if (path.dirname(finalPath) !== targetDir) {
        return NextResponse.json({ error: "Existing note must be in the selected folder" }, { status: 400 });
      }
      if (path.extname(finalPath).toLowerCase() !== ".md") {
        return NextResponse.json({ error: "Existing note must be a Markdown file" }, { status: 400 });
      }
      if (!fs.existsSync(finalPath) || !fs.statSync(finalPath).isFile()) {
        return NextResponse.json({ error: "Existing note was not found" }, { status: 404 });
      }

      const relativeDir = path.dirname(path.relative(resolvedVault, finalPath));
      const backupDir = resolveInsideDirectory(resolvedVault, path.join(".notetaker", "backups", relativeDir), "Backup folder");
      fs.mkdirSync(backupDir, { recursive: true });
      const base = path.basename(finalPath, path.extname(finalPath));
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      backupPath = path.join(backupDir, `${base}.backup-${stamp}.md`);
      fs.copyFileSync(finalPath, backupPath);

      const tempPath = path.join(targetDir, `.${path.basename(finalPath)}.${process.pid}.${Date.now()}.tmp`);
      try {
        fs.writeFileSync(tempPath, notes, "utf-8");
        fs.renameSync(tempPath, finalPath);
      } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
      updated = true;
    } else {
      const title = sanitizeFilename(meetingTitle || "Meeting Notes");
      const filename = `${title}.md`;
      const filePath = path.join(targetDir, filename);
      finalPath = uniqueFilePath(filePath);
      fs.writeFileSync(finalPath, notes, "utf-8");
    }

    const relativeSavedPath = path.relative(resolvedVault, finalPath);
    return NextResponse.json({
      savedPath: relativeSavedPath,
      filename: path.basename(finalPath),
      updated,
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
