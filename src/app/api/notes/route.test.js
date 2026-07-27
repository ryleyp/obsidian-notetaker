import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-notes-route-"));
  return tmpRoot;
}

function recentDate(daysAgo = 7) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function getNotes(params) {
  return GET(new Request(`http://localhost/api/notes?${params}`, {
    headers: { "x-notetaker-session": getSessionToken() },
  }));
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/notes", () => {
  it("includes recent transcript archive files for the selected account", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const accountDir = path.join(vault, "Acme");
    const transcripts = path.join(root, "transcripts");
    const transcriptDir = path.join(transcripts, "Acme Transcripts");
    fs.mkdirSync(accountDir, { recursive: true });
    fs.mkdirSync(transcriptDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    allowDirectory(transcripts, "Transcripts archive path");

    const d = recentDate();
    const iso = d.toISOString().split("T")[0];
    fs.writeFileSync(path.join(accountDir, `${iso} - Planning.md`), "# Planning\n\nMet Sam at Acme.");
    const transcriptPath = path.join(transcriptDir, "Quarterly Transcript.md");
    fs.writeFileSync(transcriptPath, "# Quarterly Transcript\n\nSam mentioned the Dallas lab.");
    fs.utimesSync(transcriptPath, d, d);

    const params = new URLSearchParams({
      vaultPath: vault,
      folderPath: "Acme",
      accountAliases: "acme",
      transcriptsPath: transcripts,
      transcriptFolder: "Acme Transcripts",
    });
    const response = await getNotes(params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.counts).toEqual({ obsidian: 1, transcripts: 1, crossVault: 0 });
    expect(data.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Quarterly Transcript",
        source: "transcript",
        sourceLabel: "Acme Transcripts",
      }),
    ]));
  });
});
