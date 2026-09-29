import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let vault = null;

function makeVault() {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-thread-note-"));
  fs.mkdirSync(path.join(vault, "Acme", "FY2026"), { recursive: true });
  fs.mkdirSync(path.join(vault, "Beacon"), { recursive: true });
  allowDirectory(vault, "Vault path");
  return vault;
}

function get(params, token = getSessionToken()) {
  const search = new URLSearchParams({ vaultPath: vault, ...params });
  return GET(new Request(`http://localhost/api/email-thread-note?${search}`, { headers: { "x-notetaker-session": token } }));
}

afterEach(() => {
  if (vault) fs.rmSync(vault, { recursive: true, force: true });
  vault = null;
});

describe("/api/email-thread-note", () => {
  it("finds the thread's note however the pasted subject is dressed", async () => {
    makeVault();
    const notePath = path.join(vault, "Acme", "FY2026", "2026-09-01 - Email - Q3 license server migration.md");
    fs.writeFileSync(notePath, "# thread so far");

    for (const threadTitle of [
      "Q3 license server migration",
      "RE: Q3 license server migration",
      "[EXTERNAL] FW: Q3 license server migration",
      "[ext] re- Q3 license server migration",
    ]) {
      const data = await (await get({ folderPath: "Acme", threadTitle })).json();
      expect(data.note?.filename, threadTitle).toBe("2026-09-01 - Email - Q3 license server migration.md");
      expect(data.note?.content, threadTitle).toBe("# thread so far");
    }
  });

  it("treats a tag the sender chose as a different thread", async () => {
    makeVault();
    fs.writeFileSync(path.join(vault, "Acme", "2026-09-01 - Email - Q3 license server migration.md"), "# thread");
    const data = await (await get({ folderPath: "Acme", threadTitle: "[NI INTERNAL] Q3 license server migration" })).json();
    expect(data.note).toBeNull();
  });

  it("finds a thread first saved in another folder", async () => {
    makeVault();
    fs.writeFileSync(path.join(vault, "Beacon", "2026-09-01 - Email - Shared portal access.md"), "# thread");
    const data = await (await get({ folderPath: "Acme", threadTitle: "RE: Shared portal access" })).json();
    expect(data.note?.folder).toBe("Beacon");
  });

  it("returns nothing for an unknown thread, and rejects an untrusted caller", async () => {
    makeVault();
    expect((await (await get({ folderPath: "Acme", threadTitle: "Never discussed" })).json()).note).toBeNull();
    expect((await (await get({ folderPath: "Acme", threadTitle: "" })).json()).note).toBeNull();
    expect((await get({ folderPath: "Acme", threadTitle: "x" }, "wrong-token")).status).toBe(401);
  });
});
