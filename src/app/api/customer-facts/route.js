import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertExistingChildDirectory, sanitizeFilename } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { buildCustomerFactsRollup, CUSTOMER_FACTS_FILENAME } from "@/lib/customerFacts";

function readMarkdownNotes(targetDir) {
  const notes = fs.readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== CUSTOMER_FACTS_FILENAME)
    .map((entry) => {
      const filePath = path.join(targetDir, entry.name);
      return {
        filename: entry.name,
        content: fs.readFileSync(filePath, "utf-8"),
        modified: fs.statSync(filePath).mtimeMs,
      };
    });

  // Old versions created "(1)" copies when the same email thread was run
  // again. Keep those source files untouched, but only use the newest copy in
  // the generated rollup so stale callouts do not survive a refresh.
  const newestEmailByTitle = new Map();
  const output = [];
  for (const note of notes) {
    const base = path.basename(note.filename, ".md").replace(/ \(\d+\)$/, "");
    const emailTitle = base.match(/^\d{4}-\d{2}-\d{2} - Email - (.+)$/i)?.[1];
    if (!emailTitle) {
      output.push(note);
      continue;
    }
    const key = emailTitle.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    const current = newestEmailByTitle.get(key);
    if (!current || note.modified > current.modified) newestEmailByTitle.set(key, note);
  }

  return [...output, ...newestEmailByTitle.values()].map(({ filename, content }) => ({ filename, content }));
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const { vaultPath, folderPath = "", accountName = "Selected Customer" } = await request.json();
    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Customer folder");
    const notes = readMarkdownNotes(targetDir);
    const safeAccountName = sanitizeFilename(accountName, "Selected Customer");
    const content = buildCustomerFactsRollup(notes, safeAccountName);
    const filePath = path.join(targetDir, CUSTOMER_FACTS_FILENAME);
    const tempPath = path.join(targetDir, `.${CUSTOMER_FACTS_FILENAME}.${process.pid}.${Date.now()}.tmp`);

    try {
      fs.writeFileSync(tempPath, content, "utf-8");
      fs.renameSync(tempPath, filePath);
    } finally {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }

    return NextResponse.json({
      ok: true,
      savedPath: path.relative(resolvedVault, filePath),
      sourceCount: notes.length,
    });
  } catch (error) {
    console.error("Customer facts rollup error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to rebuild customer facts rollup" },
      { status: error?.status || 500 }
    );
  }
}

export { readMarkdownNotes };
