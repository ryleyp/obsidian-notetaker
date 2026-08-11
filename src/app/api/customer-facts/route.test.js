import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function post(body) {
  return POST(new Request("http://localhost/api/customer-facts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-notetaker-session": getSessionToken(),
    },
    body: JSON.stringify(body),
  }));
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/customer-facts", () => {
  it("rebuilds one stable rollup note without ingesting the previous rollup", async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-customer-facts-"));
    const vault = path.join(tmpRoot, "vault");
    const folder = path.join(vault, "Acme");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "2025-01-10 - Sync.md"), "## User-Level Callouts\n\n- **Dana** — admin");
    fs.writeFileSync(path.join(folder, "Customer Facts & Callouts.md"), "stale rollup");
    allowDirectory(vault, "Vault path");

    const response = await post({ vaultPath: vault, folderPath: "Acme", accountName: "Acme" });
    const data = await response.json();
    const output = fs.readFileSync(path.join(folder, "Customer Facts & Callouts.md"), "utf-8");

    expect(response.status).toBe(200);
    expect(data.sourceCount).toBe(1);
    expect(data.savedPath).toBe(path.join("Acme", "Customer Facts & Callouts.md"));
    expect(output).toContain("Dana");
    expect(output).not.toContain("stale rollup");
  });

  it("uses only the newest legacy copy of a repeated email thread", async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-customer-facts-"));
    const vault = path.join(tmpRoot, "vault");
    const folder = path.join(vault, "Acme");
    fs.mkdirSync(folder, { recursive: true });
    const oldPath = path.join(folder, "2026-05-10 - Email - License cleanup.md");
    const newPath = path.join(folder, "2026-05-10 - Email - License cleanup (1).md");
    fs.writeFileSync(oldPath, "## Customer Success Callouts\n\n- stale risk");
    fs.writeFileSync(newPath, "## Customer Success Callouts\n\n- latest plan");
    const now = Date.now() / 1000;
    fs.utimesSync(oldPath, now - 60, now - 60);
    fs.utimesSync(newPath, now, now);
    allowDirectory(vault, "Vault path");

    const response = await post({ vaultPath: vault, folderPath: "Acme", accountName: "Acme" });
    const data = await response.json();
    const output = fs.readFileSync(path.join(folder, "Customer Facts & Callouts.md"), "utf-8");

    expect(data.sourceCount).toBe(1);
    expect(output).toContain("latest plan");
    expect(output).not.toContain("stale risk");
  });
});
