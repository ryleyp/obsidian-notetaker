import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveInsideDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

// Weekly SFDC activity report: mirrors the Todos flow. When a note is saved,
// its "## SFDC Activity Entry" section is appended to a weekly file (named
// after that week's Monday) in the vault's "Reports" folder, so a week's
// Salesforce entries live in one place.

function getMondayOfWeek(dateStr) {
  // Week = Sunday–Saturday; file is named after that Monday (same as Todos)
  const date = new Date((dateStr || new Date().toISOString().split("T")[0]) + "T12:00:00");
  const day = date.getDay(); // 0=Sun … 6=Sat
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - day);
  const monday = new Date(sunday);
  monday.setDate(sunday.getDate() + 1);
  return monday.toISOString().split("T")[0];
}

function extractDateFromTitle(title) {
  const match = title && title.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

// Pull the SFDC Activity Entry section out of the generated note.
function extractSfdcSection(notes) {
  const m = (notes || "").match(/## SFDC Activity Entry\s*\n([\s\S]*?)(?=\n## |$)/);
  if (!m) return null;
  const body = m[1].replace(/\n---\s*$/, "").trim();
  return body || null;
}

// Meeting blocks are separated by a horizontal rule so the bold field labels
// inside an entry (**Type:**, **Summary/Notes:**) never get mistaken for a
// new block boundary.
const BLOCK_SEP = "\n\n---\n\n";

function meetingBlock(section, meetingTitle) {
  return `**${meetingTitle}**\n\n${section}`;
}

function blockDate(block) {
  const m = block.match(/\*\*[^\n]*?(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "0000-00-00";
}

function blockTitle(block) {
  return block.match(/^\*\*(.+?)\*\*(?:\n|$)/)?.[1]?.trim() || "";
}

function normalizeIdentity(value) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}

function emailThreadTitleFromMeetingTitle(value) {
  return String(value || "").match(/^\d{4}-\d{2}-\d{2} - Email - (.+)$/i)?.[1] || "";
}

function matchingActivityBlock(block, meetingTitle, emailThreadTitle) {
  const existingTitle = blockTitle(block);
  if (normalizeIdentity(existingTitle) === normalizeIdentity(meetingTitle)) return true;
  if (!emailThreadTitle) return false;
  return normalizeIdentity(emailThreadTitleFromMeetingTitle(existingTitle)) === normalizeIdentity(emailThreadTitle);
}

function parseReport(content, fallbackHeader) {
  const headerMatch = String(content || "").match(/^# .+\n/);
  const header = headerMatch ? headerMatch[0] : fallbackHeader;
  const bodyText = String(content || "").slice(headerMatch ? header.length : 0).trim();
  return { header, blocks: bodyText ? bodyText.split(BLOCK_SEP).filter((block) => block.trim()) : [] };
}

function reportContent(header, blocks) {
  return blocks.length ? `${header}\n${blocks.join(BLOCK_SEP)}\n` : `${header}\n`;
}

// Insert the new meeting block, newest date first (same ordering as Todos).
function insertInOrder(blocks, newBlock, meetingTitle) {
  const newDate = (meetingTitle.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "0000-00-00";
  let insertAt = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    if (newDate >= blockDate(blocks[i])) {
      insertAt = i;
      break;
    }
  }
  blocks.splice(insertAt, 0, newBlock);
  return blocks;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const { notes, vaultPath, meetingTitle, emailThreadTitle } = await request.json();
    if (!notes || !vaultPath) return NextResponse.json({ ok: true });

    const section = extractSfdcSection(notes);
    if (!section) return NextResponse.json({ ok: true, skipped: true });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const reportsDir = resolveInsideDirectory(resolvedVault, "Reports", "Reports folder");
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const monday = getMondayOfWeek(extractDateFromTitle(meetingTitle));
    const filePath = path.join(reportsDir, `${monday} - SFDC Activity Report.md`);
    const title = meetingTitle || "Untitled Meeting";

    let updated = false;
    let targetReport = fs.existsSync(filePath)
      ? parseReport(fs.readFileSync(filePath, "utf-8"), `# ${monday} - SFDC Activity Report\n`)
      : { header: `# ${monday} - SFDC Activity Report\n`, blocks: [] };

    // Remove the previous version before inserting the new one. For email
    // threads, the user-entered subject is the stable identity even when the
    // note date (and therefore weekly report) changes between uploads.
    const reportFiles = fs.readdirSync(reportsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2} - SFDC Activity Report\.md$/.test(entry.name));

    for (const entry of reportFiles) {
      const candidatePath = path.join(reportsDir, entry.name);
      const candidate = candidatePath === filePath
        ? targetReport
        : parseReport(fs.readFileSync(candidatePath, "utf-8"), `# ${path.basename(entry.name, ".md")}\n`);
      const remaining = candidate.blocks.filter((block) => !matchingActivityBlock(block, title, emailThreadTitle));
      if (remaining.length === candidate.blocks.length) continue;
      updated = true;
      if (candidatePath === filePath) {
        targetReport = { ...candidate, blocks: remaining };
      } else {
        fs.writeFileSync(candidatePath, reportContent(candidate.header, remaining), "utf-8");
      }
    }

    insertInOrder(targetReport.blocks, meetingBlock(section, title), title);
    fs.writeFileSync(filePath, reportContent(targetReport.header, targetReport.blocks), "utf-8");
    return NextResponse.json({
      ok: true,
      savedPath: path.relative(resolvedVault, filePath),
      updated,
    });
  } catch (error) {
    // Best-effort side effect of saving a note: never fail the save. Surface
    // the reason so an auth/allowlist rejection is diagnosable, not silent.
    console.error("SFDC report error:", error);
    return NextResponse.json({ ok: true, skipped: true, error: error?.message || "SFDC report append failed" });
  }
}
