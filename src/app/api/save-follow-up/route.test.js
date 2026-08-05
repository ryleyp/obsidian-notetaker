import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-follow-up-"));
  return tmpRoot;
}

function postFollowUp(body, origin = "http://localhost:3000") {
  return POST(new Request("http://localhost/api/save-follow-up", {
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

describe("/api/save-follow-up", () => {
  it("creates the Follow Up Emails folder and never overwrites a draft", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    allowDirectory(vault, "Vault path");

    const body = {
      draft: "Subject: Rollout follow-up\n\nThanks for meeting today.",
      vaultPath: vault,
      meetingTitle: "2026-08-04 - Rollout Sync",
    };
    const first = await postFollowUp(body);
    const second = await postFollowUp(body);
    const firstData = await first.json();
    const secondData = await second.json();

    expect(first.status).toBe(200);
    expect(firstData.savedPath).toBe(path.join("Follow Up Emails", "2026-08-04 - Rollout Sync.md"));
    expect(secondData.savedPath).toBe(path.join("Follow Up Emails", "2026-08-04 - Rollout Sync (1).md"));
    expect(fs.readFileSync(path.join(vault, firstData.savedPath), "utf-8")).toContain("Subject: Rollout follow-up");
  });

  it("rejects requests from an untrusted origin", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    allowDirectory(vault, "Vault path");

    const response = await postFollowUp({ draft: "Nope", vaultPath: vault }, "https://example.com");
    expect(response.status).toBe(403);
    expect(fs.existsSync(path.join(vault, "Follow Up Emails"))).toBe(false);
  });
});
