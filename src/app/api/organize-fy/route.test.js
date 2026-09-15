import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let vault = null;

function makeVault(files) {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-organize-fy-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(vault, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  }
  allowDirectory(vault, "Vault path");
  return vault;
}

function post(body, token = getSessionToken()) {
  return POST(new Request("http://localhost/api/organize-fy", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": token },
    body: JSON.stringify({ vaultPath: vault, ...body }),
  }));
}

const exists = (relativePath) => fs.existsSync(path.join(vault, relativePath));

afterEach(() => {
  if (vault) fs.rmSync(vault, { recursive: true, force: true });
  vault = null;
});

describe("/api/organize-fy", () => {
  it("previews the moves without touching a single file", async () => {
    makeVault({
      "1. Acme/2026-09-08 - Acme Sync.md": "# Sync",
      "1. Acme/2026-10-02 - Acme Kickoff.md": "# Kickoff",
      "1. Acme/Contact Notes.md": "# Contact",
      "1. Acme/FY2026/2026-08-01 - Already.md": "# Already",
      "Reports/2026-09-07 - SFDC Activity Report.md": "# Weekly",
      "Inbox.md": "# Loose",
    });

    const data = await (await post({ mode: "preview" })).json();

    expect(data.moves.map((m) => m.to).sort()).toEqual([
      "1. Acme/FY2026/2026-09-08 - Acme Sync.md",
      "1. Acme/FY2027/2026-10-02 - Acme Kickoff.md",
    ]);
    expect(data.accounts).toEqual([
      { account: "1. Acme", total: 2, years: [{ fiscalYear: "FY2026", count: 1 }, { fiscalYear: "FY2027", count: 1 }] },
    ]);
    expect(data.alreadyFiled).toBe(1);
    expect(data.skipped).toEqual([{ relativePath: "1. Acme/Contact Notes.md", reason: "undated" }]);
    // Nothing moved, and the weekly report folder is left out entirely.
    expect(exists("1. Acme/2026-09-08 - Acme Sync.md")).toBe(true);
    expect(exists("Reports/2026-09-07 - SFDC Activity Report.md")).toBe(true);
  });

  it("moves the approved files and can put every one of them back", async () => {
    makeVault({
      "1. Acme/2026-09-08 - Acme Sync.md": "# Sync",
      "1. Acme/2026-10-02 - Acme Kickoff.md": "# Kickoff",
    });
    const preview = await (await post({ mode: "preview" })).json();

    const applied = await (await post({ mode: "apply", moves: preview.moves })).json();
    expect(applied).toMatchObject({ moved: 2, skipped: 0, canUndo: true });
    expect(exists("1. Acme/FY2026/2026-09-08 - Acme Sync.md")).toBe(true);
    expect(exists("1. Acme/FY2027/2026-10-02 - Acme Kickoff.md")).toBe(true);
    expect(exists("1. Acme/2026-09-08 - Acme Sync.md")).toBe(false);
    expect(fs.readFileSync(path.join(vault, "1. Acme/FY2026/2026-09-08 - Acme Sync.md"), "utf-8")).toBe("# Sync");

    const undone = await (await post({ mode: "undo" })).json();
    expect(undone).toMatchObject({ restored: 2, skipped: 0, canUndo: false });
    expect(exists("1. Acme/2026-09-08 - Acme Sync.md")).toBe(true);
    expect(exists("1. Acme/2026-10-02 - Acme Kickoff.md")).toBe(true);
    // The emptied year folders are cleaned up behind the undo.
    expect(exists("1. Acme/FY2026")).toBe(false);
  });

  it("files beside a same-named note instead of overwriting it", async () => {
    makeVault({
      "1. Acme/2026-09-08 - Acme Sync.md": "# newer",
      "1. Acme/FY2026/2026-09-08 - Acme Sync.md": "# already there",
    });
    const preview = await (await post({ mode: "preview" })).json();
    await post({ mode: "apply", moves: preview.moves });

    expect(fs.readFileSync(path.join(vault, "1. Acme/FY2026/2026-09-08 - Acme Sync.md"), "utf-8")).toBe("# already there");
    expect(fs.readFileSync(path.join(vault, "1. Acme/FY2026/2026-09-08 - Acme Sync (1).md"), "utf-8")).toBe("# newer");
  });

  it("moves the undated rollups only when asked to", async () => {
    makeVault({ "1. Acme/Customer Facts & Callouts.md": "# Facts" });

    const without = await (await post({ mode: "preview" })).json();
    expect(without.moves).toEqual([]);

    const withRollups = await (await post({ mode: "preview", includeRollups: true })).json();
    expect(withRollups.moves[0].to).toMatch(/^1\. Acme[/\\]FY\d{4}[/\\]Customer Facts & Callouts\.md$/);
  });

  it("skips a file that moved since the preview instead of failing the run", async () => {
    makeVault({ "1. Acme/2026-09-08 - Acme Sync.md": "# Sync" });
    const preview = await (await post({ mode: "preview" })).json();
    fs.rmSync(path.join(vault, "1. Acme/2026-09-08 - Acme Sync.md"));

    const applied = await (await post({ mode: "apply", moves: preview.moves })).json();
    expect(applied).toMatchObject({ moved: 0, skipped: 1, canUndo: false });
  });

  it("refuses a destination outside the vault and an untrusted caller", async () => {
    makeVault({ "1. Acme/2026-09-08 - Acme Sync.md": "# Sync" });
    const escape = await post({ mode: "apply", moves: [{ from: "1. Acme/2026-09-08 - Acme Sync.md", to: "../escaped.md" }] });
    expect(escape.status).toBe(403);
    expect((await post({ mode: "preview" }, "wrong-token")).status).toBe(401);
    expect(exists("1. Acme/2026-09-08 - Acme Sync.md")).toBe(true);
  });

  it("reports that there is nothing to undo rather than throwing", async () => {
    makeVault({ "1. Acme/2026-09-08 - Acme Sync.md": "# Sync" });
    expect((await post({ mode: "undo" })).status).toBe(400);
  });
});
