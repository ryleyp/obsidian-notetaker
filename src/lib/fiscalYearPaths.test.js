import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveFiscalYearDir } from "./fiscalYearPaths";

let root = null;
function makeVault() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-fy-paths-"));
  fs.mkdirSync(path.join(root, "Acme"), { recursive: true });
  return root;
}

afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true });
  root = null;
});

describe("resolveFiscalYearDir", () => {
  it("files a dated note into its fiscal year and creates the folder", () => {
    const vault = makeVault();
    const account = path.join(vault, "Acme");
    const dir = resolveFiscalYearDir(vault, account, { enabled: true, title: "2026-09-08 - Acme Sync" });
    expect(dir).toBe(path.join(account, "FY2026"));
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("leaves an undated note alone unless the caller asks for the open year", () => {
    const vault = makeVault();
    const account = path.join(vault, "Acme");
    expect(resolveFiscalYearDir(vault, account, { enabled: true, title: "Customer Facts" })).toBe(account);
    const rollup = resolveFiscalYearDir(vault, account, { enabled: true, title: "Customer Facts", fallback: "current" });
    expect(path.basename(rollup)).toMatch(/^FY\d{4}$/);
  });

  it("does nothing when filing is off, or at the vault root", () => {
    const vault = makeVault();
    const account = path.join(vault, "Acme");
    expect(resolveFiscalYearDir(vault, account, { enabled: false, title: "2026-09-08 - x" })).toBe(account);
    expect(resolveFiscalYearDir(vault, vault, { enabled: true, title: "2026-09-08 - x" })).toBe(vault);
    expect(fs.existsSync(path.join(vault, "FY2026"))).toBe(false);
  });

  it("does not nest a year folder inside the year folder it belongs to", () => {
    const vault = makeVault();
    const fy = path.join(vault, "Acme", "FY2026");
    fs.mkdirSync(fy, { recursive: true });
    expect(resolveFiscalYearDir(vault, fy, { enabled: true, title: "2026-09-08 - Acme Sync" })).toBe(fy);
    expect(fs.existsSync(path.join(fy, "FY2026"))).toBe(false);
  });

  it("redirects to the right year when the selected folder is the wrong one", () => {
    const vault = makeVault();
    const fy26 = path.join(vault, "Acme", "FY2026");
    fs.mkdirSync(fy26, { recursive: true });
    const dir = resolveFiscalYearDir(vault, fy26, { enabled: true, title: "2026-10-02 - Acme Kickoff" });
    expect(dir).toBe(path.join(vault, "Acme", "FY2027"));
  });
});
