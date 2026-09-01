import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertExistingChildDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { findExistingEmailThread } from "../save/route";

// Looks up the existing Obsidian note for an email thread (same matcher the
// save upsert uses) so the client can feed it into regeneration as a source
// and tell the CSM which file will be updated.
export async function GET(request) {
  try {
    assertTrustedRequest(request);

    const { searchParams } = new URL(request.url);
    const vaultPath = searchParams.get("vaultPath") || "";
    const folderPath = searchParams.get("folderPath") || "";
    const threadTitle = searchParams.get("threadTitle") || "";

    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });
    if (!threadTitle.trim()) return NextResponse.json({ note: null });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Target folder");

    const matchedPath = findExistingEmailThread(targetDir, threadTitle);
    if (!matchedPath) return NextResponse.json({ note: null });

    const content = fs.readFileSync(matchedPath, "utf-8");
    return NextResponse.json({
      note: {
        relativePath: path.relative(resolvedVault, matchedPath),
        filename: path.basename(matchedPath),
        content,
      },
    });
  } catch (error) {
    console.error("Email thread note lookup error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to look up existing email note" },
      { status: error?.status || 500 }
    );
  }
}
