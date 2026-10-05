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

describe("email threads archive in their own folder", () => {
  it("puts an email thread inside the account's Emails folder", async () => {
    const { transcriptsPath, body } = setup();
    const data = await (await post({
      ...body,
      transcript: "## Email thread\n\nSubject: Q3 migration",
      meetingTitle: "2026-10-05 - Email - Q3 migration",
      subfolder: "Emails",
    })).json();

    expect(data.savedPath).toBe(path.join("Acme Transcripts", "Emails", "2026-10-05 - Email - Q3 migration.md"));
    expect(fs.existsSync(path.join(transcriptsPath, "Acme Transcripts", "Emails"))).toBe(true);
  });

  it("leaves meeting transcripts in the account folder itself", async () => {
    const { transcriptsPath, body } = setup();
    await post(body);
    expect(fs.readdirSync(path.join(transcriptsPath, "Acme Transcripts"))).toEqual(["2026-08-11 - Account Sync - Acme.md"]);
  });

  it("keeps an email and a meeting with the same title apart", async () => {
    const { transcriptsPath, body } = setup();
    await post({ ...body, transcript: "meeting body" });
    const email = await (await post({ ...body, transcript: "email body", subfolder: "Emails" })).json();

    expect(email.savedPath).toBe(path.join("Acme Transcripts", "Emails", "2026-08-11 - Account Sync - Acme.md"));
    expect(fs.readFileSync(path.join(transcriptsPath, "Acme Transcripts", "2026-08-11 - Account Sync - Acme.md"), "utf-8")).toContain("meeting body");
    expect(fs.readFileSync(path.join(transcriptsPath, email.savedPath), "utf-8")).toContain("email body");
  });

  it("updates the thread's own file when it is re-archived", async () => {
    const { transcriptsPath, body } = setup();
    const args = { ...body, meetingTitle: "2026-10-05 - Email - Q3 migration", subfolder: "Emails" };
    await post({ ...args, transcript: "first message" });
    const second = await (await post({ ...args, transcript: "first message\nsecond message" })).json();

    expect(second.updated).toBe(true);
    expect(fs.readdirSync(path.join(transcriptsPath, "Acme Transcripts", "Emails"))).toHaveLength(1);
  });

  it("cannot be walked out of the archive by the subfolder", async () => {
    const { transcriptsPath, body } = setup();
    const data = await (await post({ ...body, subfolder: "../../../etc" })).json();

    // Sanitized to a single folder name inside the account's archive.
    const parts = data.savedPath.split(path.sep);
    expect(parts[0]).toBe("Acme Transcripts");
    expect(parts).toHaveLength(3);
    expect(fs.existsSync(path.join(transcriptsPath, data.savedPath))).toBe(true);
  });
});
