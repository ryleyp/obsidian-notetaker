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
