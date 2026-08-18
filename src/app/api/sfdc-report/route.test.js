import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-sfdc-route-"));
  return tmpRoot;
}

function postReport(body, { token = getSessionToken(), origin = "http://localhost:3000" } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  if (token) headers["x-notetaker-session"] = token;
  return POST(new Request("http://localhost/api/sfdc-report", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

const NOTE = `# Meeting

## SFDC Activity Entry

Summary: Reviewed rollout.
Outcomes: Approved.
Next steps: Schedule training.

## Other section
ignored
`;

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/sfdc-report", () => {
  it("appends the SFDC section to this week's report file", async () => {
    const vault = path.join(makeTmp(), "vault");
    fs.mkdirSync(vault, { recursive: true });
    allowDirectory(vault, "Vault path");

    const response = await postReport({
      notes: NOTE,
      vaultPath: vault,
      meetingTitle: "2026-05-14 - Acme Sync",
    });
    const data = await response.json();

    expect(data.savedPath).toMatch(/^Reports[\\/]/);
    const written = fs.readFileSync(path.join(vault, data.savedPath), "utf-8");
    expect(written).toContain("**2026-05-14 - Acme Sync**");
    expect(written).toContain("Summary: Reviewed rollout.");
    // Content outside the SFDC section must not leak into the report.
    expect(written).not.toContain("ignored");
  });

  it("replaces the activity when the same meeting is saved twice", async () => {
    const vault = path.join(makeTmp(), "vault");
    fs.mkdirSync(vault, { recursive: true });
    allowDirectory(vault, "Vault path");

    const body = { notes: NOTE, vaultPath: vault, meetingTitle: "2026-05-14 - Acme Sync" };
    await postReport(body);
    const second = await postReport({
      ...body,
      notes: NOTE.replace("Reviewed rollout.", "Reviewed the updated rollout plan."),
    });
    const data = await second.json();

    expect(data.updated).toBe(true);
    const written = fs.readFileSync(path.join(vault, data.savedPath), "utf-8");
    expect(written.match(/\*\*2026-05-14 - Acme Sync\*\*/g)).toHaveLength(1);
    expect(written).toContain("Reviewed the updated rollout plan.");
    expect(written).not.toContain("Summary: Reviewed rollout.");
  });

  it("moves and refreshes a same-title email activity when its date changes", async () => {
    const vault = path.join(makeTmp(), "vault");
    fs.mkdirSync(vault, { recursive: true });
    allowDirectory(vault, "Vault path");

    await postReport({
      notes: NOTE,
      vaultPath: vault,
      meetingTitle: "2026-05-14 - Email - License cleanup",
      emailThreadTitle: "License cleanup",
    });
    const second = await postReport({
      notes: NOTE.replace("Reviewed rollout.", "Captured the final license plan."),
      vaultPath: vault,
      meetingTitle: "2026-05-25 - Email - License cleanup",
      emailThreadTitle: " license   CLEANUP ",
    });
    const data = await second.json();

    expect(data.updated).toBe(true);
    expect(data.savedPath).toBe(path.join("Reports", "2026-05-25 - SFDC Activity Report.md"));
    const oldReport = fs.readFileSync(path.join(vault, "Reports", "2026-05-11 - SFDC Activity Report.md"), "utf-8");
    const newReport = fs.readFileSync(path.join(vault, data.savedPath), "utf-8");
    expect(oldReport).not.toContain("License cleanup");
    expect(newReport.match(/Email - License cleanup/g)).toHaveLength(1);
    expect(newReport).toContain("Captured the final license plan.");
  });

  it("skips notes with no SFDC Activity Entry section", async () => {
    const vault = path.join(makeTmp(), "vault");
    fs.mkdirSync(vault, { recursive: true });
    allowDirectory(vault, "Vault path");

    const response = await postReport({
      notes: "# Meeting\n\nNo SFDC section here.",
      vaultPath: vault,
      meetingTitle: "2026-05-14 - Acme Sync",
    });
    const data = await response.json();

    expect(data.skipped).toBe(true);
    expect(fs.existsSync(path.join(vault, "Reports"))).toBe(false);
  });

  // The route previously called path.resolve on the request-supplied vaultPath
  // with no session token and no allowlist, so an unauthenticated caller could
  // create a Reports/ directory and write a file anywhere on the filesystem.
  it("refuses a request without a valid session token", async () => {
    const vault = path.join(makeTmp(), "vault");
    fs.mkdirSync(vault, { recursive: true });
    allowDirectory(vault, "Vault path");

    const response = await postReport(
      { notes: NOTE, vaultPath: vault, meetingTitle: "2026-05-14 - Acme Sync" },
      { token: null }
    );
    const data = await response.json();

    expect(data.savedPath).toBeUndefined();
    expect(data.error).toBeTruthy();
    expect(fs.existsSync(path.join(vault, "Reports"))).toBe(false);
  });

  it("refuses a vault path that was never approved for this session", async () => {
    const root = makeTmp();
    const approved = path.join(root, "vault");
    const unapproved = path.join(root, "elsewhere");
    fs.mkdirSync(approved, { recursive: true });
    fs.mkdirSync(unapproved, { recursive: true });
    allowDirectory(approved, "Vault path");

    const response = await postReport({
      notes: NOTE,
      vaultPath: unapproved,
      meetingTitle: "2026-05-14 - Acme Sync",
    });
    const data = await response.json();

    expect(data.savedPath).toBeUndefined();
    expect(data.error).toBeTruthy();
    expect(fs.existsSync(path.join(unapproved, "Reports"))).toBe(false);
  });

  it("refuses a request from an untrusted origin", async () => {
    const vault = path.join(makeTmp(), "vault");
    fs.mkdirSync(vault, { recursive: true });
    allowDirectory(vault, "Vault path");

    const response = await postReport(
      { notes: NOTE, vaultPath: vault, meetingTitle: "2026-05-14 - Acme Sync" },
      { origin: "https://evil.example.com" }
    );
    const data = await response.json();

    expect(data.savedPath).toBeUndefined();
    expect(fs.existsSync(path.join(vault, "Reports"))).toBe(false);
  });
});
