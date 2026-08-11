import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function post(body) {
  return POST(new Request("http://localhost/api/save-transcript", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-notetaker-session": getSessionToken(),
    },
    body: JSON.stringify(body),
  }));
}

function setup() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-transcript-route-"));
  const transcriptsPath = path.join(tmpRoot, "transcripts");
  fs.mkdirSync(transcriptsPath, { recursive: true });
  allowDirectory(transcriptsPath, "Transcripts archive path");
  return {
    transcriptsPath,
    body: {
      transcript: "Speaker 1: Reviewed the rollout.",
      meetingTitle: "2026-08-11 - Account Sync - Acme",
      transcriptsPath,
      folder: "Acme",
      accounts: [{ name: "Acme", archiveFolder: "Acme Transcripts", aliases: ["acme"] }],
    },
  };
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/save-transcript", () => {
  it("does not create a duplicate when the transcript already exists", async () => {
    const { transcriptsPath, body } = setup();
    const first = await post(body);
    const firstData = await first.json();
    const second = await post(body);
    const secondData = await second.json();

    expect(firstData.updated).toBe(false);
    expect(secondData.alreadyExists).toBe(true);
    expect(secondData.savedPath).toBe(firstData.savedPath);
    const files = fs.readdirSync(path.join(transcriptsPath, "Acme Transcripts"));
    expect(files).toEqual(["2026-08-11 - Account Sync - Acme.md"]);
  });

  it("updates the same-title archive file when transcript content changes", async () => {
    const { transcriptsPath, body } = setup();
    await post(body);
    const response = await post({ ...body, transcript: "Speaker 1: Final rollout was approved." });
    const data = await response.json();

    expect(data.updated).toBe(true);
    expect(data.alreadyExists).toBeUndefined();
    const archiveDir = path.join(transcriptsPath, "Acme Transcripts");
    expect(fs.readdirSync(archiveDir)).toEqual(["2026-08-11 - Account Sync - Acme.md"]);
    expect(fs.readFileSync(path.join(transcriptsPath, data.savedPath), "utf-8")).toContain("Final rollout was approved.");
  });

  it("reuses identical transcript content even when the supplied title differs", async () => {
    const { transcriptsPath, body } = setup();
    const firstData = await (await post(body)).json();
    const secondData = await (await post({ ...body, meetingTitle: "Renamed meeting" })).json();

    expect(secondData.alreadyExists).toBe(true);
    expect(secondData.savedPath).toBe(firstData.savedPath);
    expect(fs.readdirSync(path.join(transcriptsPath, "Acme Transcripts"))).toHaveLength(1);
  });
});
