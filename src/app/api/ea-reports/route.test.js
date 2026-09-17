import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";
import { rowsToMarkdown } from "@/lib/activityRows";

let vault = null;

const row = (over = {}) => ({
  eventDate: "2026-08-12",
  title: "Acme EA Admin Sync - License Server",
  type: "Strategic Relationship Management",
  subtype: "EA Admin Sync",
  agreement: "EA 15552",
  sourceTitle: "2026-08-12 - Acme Sync",
  comments: "Summary: Dana Whitfield, IT Admin Lead, raised the outage. Contribution: CSM escalated it. Outcomes: Cert renewed.",
  status: "Completed",
  ...over,
});

function makeVault() {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-ea-reports-"));
  fs.mkdirSync(path.join(vault, "Acme", "FY2026"), { recursive: true });
  allowDirectory(vault, "Vault path");
  return vault;
}

function write(relativePath, rows) {
  const filePath = path.join(vault, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `# EA Activity Report\n\n${rowsToMarkdown(rows)}\n`, "utf-8");
}

function get(params, token = getSessionToken()) {
  const search = new URLSearchParams({ vaultPath: vault, ...params });
  return GET(new Request(`http://localhost/api/ea-reports?${search}`, { headers: { "x-notetaker-session": token } }));
}

afterEach(() => {
  if (vault) fs.rmSync(vault, { recursive: true, force: true });
  vault = null;
});

describe("/api/ea-reports", () => {
  it("lists the account's saved reports newest first, across fiscal-year folders", async () => {
    makeVault();
    write("Acme/EA Activity Report 2026-06-30.md", [row({ filed: true })]);
    write("Acme/FY2026/EA Activity Report 2026-09-14.md", [row(), row({ title: "RF User Group", filed: true })]);
    write("Acme/FY2026/2026-08-12 - Acme Sync.md", [row()]); // not a report

    const data = await (await get({ folderPath: "Acme" })).json();

    expect(data.reports.map((r) => r.filename)).toEqual([
      "EA Activity Report 2026-09-14.md",
      "EA Activity Report 2026-06-30.md",
    ]);
    expect(data.reports[0]).toMatchObject({ rowCount: 2, filedCount: 1, folder: "FY2026" });
  });

  it("opens one report as complete, editable rows", async () => {
    makeVault();
    write("Acme/FY2026/EA Activity Report 2026-09-14.md", [row({ filed: true }), row({ title: "Planned QBR", status: "Planned", eventDate: "2026-10-01" })]);

    const data = await (await get({ folderPath: "Acme", file: path.join("Acme", "FY2026", "EA Activity Report 2026-09-14.md") })).json();

    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toMatchObject({
      title: "Acme EA Admin Sync - License Server",
      type: "Strategic Relationship Management",
      filed: true,
      status: "Completed",
      origin: "note",
    });
    expect(data.rows[1]).toMatchObject({ status: "Planned", filed: false });
  });

  it("refuses a file that is not a report, a missing one, and a path outside the vault", async () => {
    makeVault();
    write("Acme/FY2026/2026-08-12 - Acme Sync.md", [row()]);
    expect((await get({ folderPath: "Acme", file: path.join("Acme", "FY2026", "2026-08-12 - Acme Sync.md") })).status).toBe(400);
    expect((await get({ folderPath: "Acme", file: path.join("Acme", "EA Activity Report gone.md") })).status).toBe(404);
    expect((await get({ folderPath: "Acme", file: "../escape.md" })).status).toBe(403);
  });

  it("says so when a report carries no table, and rejects an untrusted caller", async () => {
    makeVault();
    fs.writeFileSync(path.join(vault, "Acme", "EA Activity Report 2026-01-01.md"), "# EA Activity Report\n\nNothing logged.\n");
    expect((await get({ folderPath: "Acme", file: path.join("Acme", "EA Activity Report 2026-01-01.md") })).status).toBe(422);
    expect((await get({ folderPath: "Acme" }, "wrong-token")).status).toBe(401);
  });
});
