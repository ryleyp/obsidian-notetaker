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
});
