import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeVault() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-account-context-"));
  const vault = path.join(tmpRoot, "vault");
  fs.mkdirSync(path.join(vault, "Acme", "FY2027"), { recursive: true });
  fs.mkdirSync(path.join(vault, "Other"), { recursive: true });
  fs.writeFileSync(path.join(vault, "Acme", "FY2027", "2026-10-03 - Acme Sync.md"), "## Next Steps\n\n- Pilot in November.");
  fs.writeFileSync(path.join(vault, "Acme", "2026-10-06 - Email - Count check.md"), "## Thread Summary\n\n- Count requested.");
  fs.writeFileSync(path.join(vault, "Acme", "Customer Facts & Callouts.md"), "## Customer Facts\n\nRollup.");
  fs.writeFileSync(path.join(vault, "Other", "2026-10-04 - Other Sync.md"), "## Next Steps\n\n- Unrelated account.");
  return vault;
}

function get(params, headers = { "x-notetaker-session": getSessionToken() }) {
  return GET(new Request(`http://localhost/api/account-context?${new URLSearchParams(params)}`, { headers }));
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/account-context", () => {
  it("digests the account folder and its fiscal years, leaving out the thread's own note", async () => {
    const vault = makeVault();
    allowDirectory(vault, "Vault path");

    const res = await get({ vaultPath: vault, folderPath: "Acme", threadTitle: "RE: Count check" });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.sources).toEqual(["2026-10-03 - Acme Sync.md"]);
    expect(data.context).toContain("Pilot in November.");
    expect(data.context).not.toContain("Unrelated account");
  });

  it("returns nothing at the vault root, where accounts would mix", async () => {
    const vault = makeVault();
    allowDirectory(vault, "Vault path");

    const data = await (await get({ vaultPath: vault, folderPath: "" })).json();
    expect(data).toEqual({ context: "", sources: [] });
  });

  it("rejects a missing session token and an unapproved vault", async () => {
    const vault = makeVault();
    expect((await get({ vaultPath: vault, folderPath: "Acme" }, {})).status).toBeGreaterThanOrEqual(400);
    expect((await get({ vaultPath: vault, folderPath: "Acme" })).status).toBe(403);
  });
});
