import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeDir() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-config-route-"));
  allowDirectory(tmpRoot, "Config folder");
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

const headers = () => ({ "Content-Type": "application/json", "x-notetaker-session": getSessionToken() });

function post(dir, body) {
  return POST(new Request("http://localhost/api/config", {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ path: dir, ...body }),
  }));
}

async function load(dir) {
  const response = await GET(new Request(`http://localhost/api/config?${new URLSearchParams({ path: dir })}`, { headers: headers() }));
  return (await response.json()).config;
}

const glossaryOnDisk = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "notetaker-glossary.json"), "utf-8"));

describe("/api/config remembered privacy choices", () => {
  const replacements = [{ original: "Acme", alias: "PRIVATE_AAAAAAAAAAAA" }];
  const privacyDecisions = [
    { text: "Dana Whitfield", type: "person", decision: "anonymize" },
    { text: "Monday", type: "org", decision: "ignore" },
  ];

  it("round-trips the choices through the glossary file, not the config file", async () => {
    const dir = makeDir();
    await post(dir, { config: { accounts: [] }, glossary: { replacements, privacyDecisions } });

    expect(await load(dir)).toMatchObject({ replacements, privacyDecisions });
    expect(fs.readFileSync(path.join(dir, "notetaker-config.json"), "utf-8")).not.toContain("Dana Whitfield");
  });

  it("keeps the choices when a later save carries only replacements", async () => {
    const dir = makeDir();
    await post(dir, { glossary: { replacements, privacyDecisions } });
    await post(dir, { glossary: { replacements: [] } });

    expect(glossaryOnDisk(dir)).toEqual({ replacements: [], privacyDecisions });
  });

  it("clears the choices when an empty list is saved", async () => {
    const dir = makeDir();
    await post(dir, { glossary: { replacements, privacyDecisions } });
    await post(dir, { glossary: { replacements, privacyDecisions: [] } });

    expect((await load(dir)).privacyDecisions).toEqual([]);
  });

  it("reports no choice list for a glossary file written before the feature", async () => {
    const dir = makeDir();
    fs.writeFileSync(path.join(dir, "notetaker-glossary.json"), JSON.stringify({ replacements }), "utf-8");

    const config = await load(dir);
    expect(config.replacements).toEqual(replacements);
    expect(config.privacyDecisions).toBeUndefined();
  });
});
