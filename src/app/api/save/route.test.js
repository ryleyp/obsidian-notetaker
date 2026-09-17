import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-save-route-"));
  return tmpRoot;
}

function postSave(body, origin = "http://localhost:3000") {
  return POST(new Request("http://localhost/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-notetaker-session": getSessionToken(),
    },
    body: JSON.stringify(body),
  }));
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/save fiscal-year filing", () => {
  it("files a dated note into its fiscal-year folder, creating it", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "Acme"), { recursive: true });
    allowDirectory(vault, "Vault path");

    const data = await (await postSave({
      notes: "# Sync",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-10-02 - Acme Kickoff",
      fiscalYearFolders: true,
    })).json();

    expect(data.savedPath).toBe(path.join("Acme", "FY2027", "2026-10-02 - Acme Kickoff.md"));
  });

  it("leaves an undated note in the account folder, but files a rollup in the open year", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "Acme"), { recursive: true });
    allowDirectory(vault, "Vault path");

    const note = await (await postSave({
      notes: "# Contact", vaultPath: vault, folderPath: "Acme",
      meetingTitle: "Contact Notes", fiscalYearFolders: true,
    })).json();
    expect(note.savedPath).toBe(path.join("Acme", "Contact Notes.md"));

    const rollup = await (await postSave({
      notes: "# Facts", vaultPath: vault, folderPath: "Acme",
      meetingTitle: "Customer Facts", fiscalYearFolders: true, fiscalYearFallback: "current",
    })).json();
    expect(rollup.savedPath).toMatch(/^Acme[/\\]FY\d{4}[/\\]Customer Facts\.md$/);
  });

  it("keeps a dated period report in the selected folder when filing is off for it", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "Acme"), { recursive: true });
    allowDirectory(vault, "Vault path");

    // A report's title carries a date, so without this the fiscal-year router
    // would file it under one year even though its range can span two.
    const data = await (await postSave({
      notes: "# EA Activity Report 2026-09-17",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "EA Activity Report 2026-09-17",
      fiscalYearFolders: false,
    })).json();

    expect(data.savedPath).toBe(path.join("Acme", "EA Activity Report 2026-09-17.md"));
    expect(fs.existsSync(path.join(vault, "Acme", "FY2026"))).toBe(false);
  });

  it("keeps an email thread in the folder it already lives in across a year boundary", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const fy26 = path.join(vault, "Acme", "FY2026");
    fs.mkdirSync(fy26, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(fy26, "2026-09-20 - Email - Renewal.md"), "# first reply");

    const data = await (await postSave({
      notes: "# second reply",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-10-05 - Email - Renewal",
      upsertEmailThreadTitle: "RE: Renewal",
      fiscalYearFolders: true,
    })).json();

    // Updated in place and renamed to the newest date, still under FY2026 —
    // one thread, not a second copy in FY2027.
    expect(data.updated).toBe(true);
    expect(data.matchedByTitle).toBe(true);
    expect(data.savedPath).toBe(path.join("Acme", "FY2026", "2026-10-05 - Email - Renewal.md"));
    expect(fs.existsSync(path.join(vault, "Acme", "FY2027"))).toBe(false);
  });

  it("updates an existing note that lives in a fiscal-year subfolder", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const fy26 = path.join(vault, "Acme", "FY2026");
    fs.mkdirSync(fy26, { recursive: true });
    allowDirectory(vault, "Vault path");
    const relativePath = path.join("Acme", "FY2026", "2026-09-08 - Acme Sync.md");
    fs.writeFileSync(path.join(vault, relativePath), "# old");

    const data = await (await postSave({
      notes: "# new",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-09-08 - Acme Sync",
      existingRelativePath: relativePath,
      fiscalYearFolders: true,
    })).json();

    expect(data.updated).toBe(true);
    expect(data.savedPath).toBe(relativePath);
    expect(fs.readFileSync(path.join(vault, relativePath), "utf-8")).toBe("# new");
    expect(data.backupPath).toBeTruthy();
  });

  it("finds a duplicate transcript already filed in a fiscal-year subfolder", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const fy26 = path.join(vault, "Acme", "FY2026");
    fs.mkdirSync(fy26, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(fy26, "2026-09-08 - Acme Sync.md"), "# 2026-09-08 - Acme Sync\n\nSam said hello.");

    const data = await (await postSave({
      notes: "# Another Title\n\nSam said hello.",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "Another Title",
      dedupeContent: true,
      fiscalYearFolders: true,
    })).json();

    expect(data.alreadyExists).toBe(true);
    expect(data.savedPath).toBe(path.join("Acme", "FY2026", "2026-09-08 - Acme Sync.md"));
  });
});

describe("/api/save", () => {
  it("saves notes and avoids overwriting an existing file", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Notes");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "Weekly Sync.md"), "old");

    const response = await postSave({
      notes: "# Weekly Sync",
      vaultPath: vault,
      folderPath: "Notes",
      meetingTitle: "Weekly Sync",
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.savedPath).toBe(path.join("Notes", "Weekly Sync (1).md"));
    expect(fs.readFileSync(path.join(notesDir, "Weekly Sync (1).md"), "utf-8")).toBe("# Weekly Sync");
  });

  it("reuses an identical file when content deduplication is requested", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "Transcript.md"), "# Transcript\r\n\r\nSame words\n");

    const response = await postSave({
      notes: "# Transcript\n\nSame words",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "Transcript",
      dedupeContent: true,
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.alreadyExists).toBe(true);
    expect(data.savedPath).toBe(path.join("Acme", "Transcript.md"));
    expect(fs.readdirSync(notesDir)).toEqual(["Transcript.md"]);
  });

  it("recognizes duplicate transcript content even when the title changes", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "Original title.md"), "# Original title\n\nSame transcript body\n");

    const response = await postSave({
      notes: "# Renamed title\n\nSame transcript body",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "Renamed title",
      dedupeContent: true,
    });
    const data = await response.json();

    expect(data.alreadyExists).toBe(true);
    expect(data.savedPath).toBe(path.join("Acme", "Original title.md"));
    expect(fs.readdirSync(notesDir)).toEqual(["Original title.md"]);
  });

  it("keeps normal note saves non-destructively unique", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "Meeting.md"), "same content");

    const response = await postSave({
      notes: "same content",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "Meeting",
    });
    const data = await response.json();

    expect(data.alreadyExists).toBeUndefined();
    expect(data.savedPath).toBe(path.join("Acme", "Meeting (1).md"));
  });

  it("backs up and replaces an explicitly selected existing note", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "2025-01-10 - Sync.md"), "old note");

    const response = await postSave({
      notes: "# 2025-01-10 - Sync\n\nnew format",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2025-01-10 - Sync",
      existingRelativePath: path.join("Acme", "2025-01-10 - Sync.md"),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.updated).toBe(true);
    expect(data.savedPath).toBe(path.join("Acme", "2025-01-10 - Sync.md"));
    expect(fs.readFileSync(path.join(notesDir, "2025-01-10 - Sync.md"), "utf-8")).toContain("new format");
    expect(data.backupPath).toMatch(/\.notetaker.*backups.*2025-01-10 - Sync\.backup-/);
    expect(fs.readFileSync(path.join(vault, data.backupPath), "utf-8")).toBe("old note");
  });

  it("updates an existing email note when the thread title matches", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    const existingName = "2026-05-01 - Email - License cleanup.md";
    fs.writeFileSync(path.join(notesDir, existingName), "old email note");

    const response = await postSave({
      notes: "# updated email note",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-05-08 - Email - License cleanup",
      upsertEmailThreadTitle: "  LICENSE   cleanup ",
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.updated).toBe(true);
    expect(data.matchedByTitle).toBe(true);
    // The file is renamed so its date tracks the latest response.
    expect(data.savedPath).toBe(path.join("Acme", "2026-05-08 - Email - License cleanup.md"));
    expect(data.previousMeetingTitle).toBe("2026-05-01 - Email - License cleanup");
    expect(fs.readFileSync(path.join(notesDir, "2026-05-08 - Email - License cleanup.md"), "utf-8")).toBe("# updated email note");
    expect(fs.existsSync(path.join(notesDir, existingName))).toBe(false);
    expect(fs.readFileSync(path.join(vault, data.backupPath), "utf-8")).toBe("old email note");
  });

  it("strips source citation markers before writing to the vault", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");

    const response = await postSave({
      notes: "# 2026-09-01 - Sync\n\n## Meeting Notes\n\n- Dana approved the rollout. [T1]\n- Budget is 40 seats [T2] [N1]\n\n## Action Items\n\n- [ ] Send runbook — **Owner:** Ryley | **Due:** TBD [T3]\n",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-09-01 - Sync",
    });
    const data = await response.json();
    const saved = fs.readFileSync(path.join(vault, data.savedPath), "utf-8");

    expect(saved).not.toMatch(/\[[TNEO]\d+\]/);
    expect(saved).toContain("- Dana approved the rollout.\n");
    expect(saved).toContain("- [ ] Send runbook — **Owner:** Ryley | **Due:** TBD\n");
  });

  it("matches an existing thread through stacked reply prefixes", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "2026-05-01 - Email - License cleanup.md"), "old email note");

    const response = await postSave({
      notes: "# updated email note",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-05-08 - Email - RE: RE: FW: License cleanup",
      upsertEmailThreadTitle: "RE: RE: FW: License cleanup",
    });
    const data = await response.json();

    expect(data.updated).toBe(true);
    expect(data.matchedByTitle).toBe(true);
  });

  it("does not merge different email thread titles", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Acme");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "2026-05-01 - Email - License cleanup.md"), "old email note");

    const response = await postSave({
      notes: "new thread",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "2026-05-08 - Email - Training plan",
      upsertEmailThreadTitle: "Training plan",
    });
    const data = await response.json();

    expect(data.updated).toBe(false);
    expect(data.savedPath).toBe(path.join("Acme", "2026-05-08 - Email - Training plan.md"));
  });

  it("does not update a note outside the selected folder", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "Acme"), { recursive: true });
    fs.mkdirSync(path.join(vault, "Other"), { recursive: true });
    fs.writeFileSync(path.join(vault, "Other", "Sync.md"), "old");
    allowDirectory(vault, "Vault path");

    const response = await postSave({
      notes: "replacement",
      vaultPath: vault,
      folderPath: "Acme",
      meetingTitle: "Sync",
      existingRelativePath: path.join("Other", "Sync.md"),
    });

    expect(response.status).toBe(400);
    expect(fs.readFileSync(path.join(vault, "Other", "Sync.md"), "utf-8")).toBe("old");
  });

  it("blocks sibling path traversal that shares the vault path prefix", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const sibling = path.join(root, "vault2");
    fs.mkdirSync(vault);
    fs.mkdirSync(sibling);
    allowDirectory(vault, "Vault path");

    const response = await postSave({
      notes: "outside",
      vaultPath: vault,
      folderPath: "../vault2",
      meetingTitle: "Escape",
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/outside/);
    expect(fs.existsSync(path.join(sibling, "Escape.md"))).toBe(false);
  });

  it("rejects untrusted browser origins", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    allowDirectory(vault, "Vault path");

    const response = await postSave({
      notes: "nope",
      vaultPath: vault,
      meetingTitle: "Blocked",
    }, "https://example.com");

    expect(response.status).toBe(403);
  });

  it("rejects unapproved local roots even with a valid token", async () => {
    const root = makeTmp();
    const vault = path.join(root, "unapproved");
    fs.mkdirSync(vault);

    const response = await postSave({
      notes: "nope",
      vaultPath: vault,
      meetingTitle: "Blocked",
    });

    expect(response.status).toBe(403);
  });
});
