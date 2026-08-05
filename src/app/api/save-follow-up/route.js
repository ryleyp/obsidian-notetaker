import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveInsideDirectory, sanitizeFilename, uniqueFilePath } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

const FOLLOW_UP_FOLDER = "Follow Up Emails";

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const { draft, vaultPath, meetingTitle } = await request.json();
    if (!draft?.trim()) {
      return NextResponse.json({ error: "Follow-up draft is required" }, { status: 400 });
    }
    if (!vaultPath) {
      return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    }

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const followUpDir = resolveInsideDirectory(resolvedVault, FOLLOW_UP_FOLDER, "Follow-up email folder");
    if (!fs.existsSync(followUpDir)) fs.mkdirSync(followUpDir, { recursive: true });
    if (!fs.statSync(followUpDir).isDirectory()) {
      return NextResponse.json({ error: "Follow Up Emails exists but is not a folder" }, { status: 400 });
    }

    const title = sanitizeFilename(meetingTitle || "Meeting");
    const filePath = uniqueFilePath(path.join(followUpDir, `${title}.md`));
    const content = `# ${title}\n\n${draft.trim()}\n`;
    fs.writeFileSync(filePath, content, "utf-8");

    return NextResponse.json({
      savedPath: path.relative(resolvedVault, filePath),
      filename: path.basename(filePath),
    });
  } catch (error) {
    console.error("Follow-up save error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save follow-up email" },
      { status: error?.status || 500 }
    );
  }
}
