import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";
import { parseGoalContributions } from "@/lib/goals";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create }; } }));

function mockAnswer(entries) {
  create.mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(entries) }],
    usage: { input_tokens: 100, output_tokens: 20 },
  });
}

const goals = [{ name: "Case studies", target: "4 completed" }, { name: "Training credit utilization", target: "15%" }];

let vault = null;

function makeVault() {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-goal-backfill-"));
  fs.mkdirSync(path.join(vault, "Acme"), { recursive: true });
  allowDirectory(vault, "Vault path");
  return vault;
}

function writeNote(name, body) {
  const filePath = path.join(vault, "Acme", name);
  fs.writeFileSync(filePath, body, "utf-8");
  return path.relative(vault, filePath);
}

function post(body, token = getSessionToken()) {
  return POST(new Request("http://localhost/api/goal-backfill", {
    method: "POST",
    headers: { "content-type": "application/json", "x-notetaker-session": token },
    body: JSON.stringify({ vaultPath: vault, goals, apiKey: "test-key", ...body }),
  }));
}

const noteBody = (title) => `# ${title}

## Meeting Notes

- Kicked off the SystemLink case study.

---

## SFDC Activity Entry

**Type:** Strategic Relationship Management
`;

beforeEach(() => {
  create.mockReset();
  mockAnswer([{ id: 0, goal: "Case studies", contribution: "Kicked off the case study", metric: "1 of 4" }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (vault) fs.rmSync(vault, { recursive: true, force: true });
  vault = null;
});

describe("/api/goal-backfill preview", () => {
  it("proposes contributions for notes missing the section and writes nothing", async () => {
    makeVault();
    const relativePath = writeNote("2026-03-04 - Acme Sync.md", noteBody("2026-03-04 - Acme Sync"));
    const before = fs.readFileSync(path.join(vault, relativePath), "utf-8");

    const response = await post({});
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.notes).toHaveLength(1);
    expect(data.notes[0].contributions).toEqual([
      { goal: "Case studies", contribution: "Kicked off the case study", metric: "1 of 4" },
    ]);
    expect(data.stats).toMatchObject({ candidates: 1, alreadyRecorded: 0, withContributions: 1, contributions: 1 });
    expect(fs.readFileSync(path.join(vault, relativePath), "utf-8")).toBe(before);
  });

  it("skips notes that already record contributions instead of re-reading them", async () => {
    makeVault();
    writeNote("2026-03-05 - Acme Recorded.md", "# Recorded\n\n## Goal Contributions\n\nNothing noted.\n");
    const response = await post({});
    const data = await response.json();
    expect(data.stats).toMatchObject({ candidates: 0, alreadyRecorded: 1 });
    expect(create).not.toHaveBeenCalled();
  });

  it("drops a proposal naming a goal that is not configured", async () => {
    makeVault();
    writeNote("2026-03-06 - Acme Talk.md", noteBody("2026-03-06 - Acme Talk"));
    mockAnswer([{ id: 0, goal: "Thought leadership", contribution: "Spoke at an event" }]);
    const data = await (await post({})).json();
    expect(data.notes[0].contributions).toEqual([]);
    expect(data.stats.dropped).toBe(1);
  });

  it("pseudonymizes the notes it sends and restores names in what comes back", async () => {
    makeVault();
    writeNote("2026-03-07 - Acme Review.md", "# Review\n\n## Meeting Notes\n\n- Dana drove the case study.\n");
    mockAnswer([{ id: 0, goal: "Case studies", contribution: "PERSON_1 drove the case study" }]);
    const data = await (await post({ replacements: [{ original: "Dana", alias: "PERSON_1" }] })).json();
    expect(JSON.stringify(create.mock.calls[0][0])).not.toContain("Dana");
    expect(data.notes[0].contributions[0].contribution).toBe("Dana drove the case study");
  });

  it("refuses without goals, and without a session token", async () => {
    makeVault();
    expect((await post({ goals: [] })).status).toBe(400);
    expect((await post({}, "wrong-token")).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("/api/goal-backfill apply", () => {
  it("writes the approved section, backs the note up, and keeps it harvestable", async () => {
    makeVault();
    const relativePath = writeNote("2026-03-08 - Acme Sync.md", noteBody("2026-03-08 - Acme Sync"));

    const response = await post({
      mode: "apply",
      files: [{ relativePath, contributions: [{ goal: "Case studies", contribution: "Kicked off the case study", metric: "1 of 4" }] }],
    });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ notesUpdated: 1, notesSkipped: 0 });

    const updated = fs.readFileSync(path.join(vault, relativePath), "utf-8");
    expect(parseGoalContributions(updated)).toEqual([
      { goal: "Case studies", contribution: "Kicked off the case study", metric: "1 of 4" },
    ]);
    expect(updated).toContain("**Type:** Strategic Relationship Management");
    expect(fs.existsSync(path.join(vault, data.updatedFiles[0].backupPath))).toBe(true);
  });

  it("skips a note that gained a section since the preview rather than duplicating it", async () => {
    makeVault();
    const relativePath = writeNote("2026-03-09 - Acme Sync.md", "# Sync\n\n## Goal Contributions\n\nNothing noted.\n");
    const data = await (await post({ mode: "apply", files: [{ relativePath, contributions: [] }] })).json();
    expect(data).toMatchObject({ notesUpdated: 0, notesSkipped: 1 });
  });

  it("refuses a path outside the vault", async () => {
    makeVault();
    const response = await post({ mode: "apply", files: [{ relativePath: "../escape.md", contributions: [] }] });
    expect(response.status).toBe(403);
  });
});
