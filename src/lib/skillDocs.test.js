import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { SKILL_FILES } from "./skillDocs";
import { LINT_RULES } from "./activityLint";

const SKILL_DIR = path.resolve(process.cwd(), "skills", "ea-activity-report");
const UPDATE = process.env.UPDATE_SKILL === "1";

describe("EA Activity skill reference documents", () => {
  // With UPDATE_SKILL=1 (npm run skill) this test writes the files instead of
  // asserting them, so there is exactly one way to regenerate them.
  it.each(Object.keys(SKILL_FILES))("%s matches the app's own definitions", (relativePath) => {
    const expected = SKILL_FILES[relativePath]();
    const filePath = path.join(SKILL_DIR, relativePath);

    if (UPDATE) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, expected, "utf-8");
      return;
    }

    expect(fs.existsSync(filePath), `${relativePath} is missing — run \`npm run skill\``).toBe(true);
    expect(fs.readFileSync(filePath, "utf-8"), `${relativePath} is stale — run \`npm run skill\``).toBe(expected);
  });

  it("documents every check the linter can actually raise", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src", "lib", "activityLint.js"), "utf-8");
    const raised = new Set([...source.matchAll(/push\("([a-z-]+)"/g)].map((m) => m[1]));
    const documented = new Set(LINT_RULES.map((rule) => rule.code));

    expect([...raised].filter((code) => !documented.has(code))).toEqual([]);
    expect([...documented].filter((code) => !raised.has(code))).toEqual([]);
  });

  it("ships a skill definition with a description that says when to use it", () => {
    const skill = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf-8");
    expect(skill.startsWith("---\n")).toBe(true);
    expect(skill).toMatch(/^name: ea-activity-report$/m);
    expect(skill).toMatch(/^description: .{80,}$/m);
    // The reference files it points at must exist.
    for (const relativePath of Object.keys(SKILL_FILES)) {
      expect(skill).toContain(relativePath);
      expect(fs.existsSync(path.join(SKILL_DIR, relativePath))).toBe(true);
    }
  });
});
