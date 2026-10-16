import { describe, expect, it } from "vitest";
import { prepareSanitizeScan } from "./route";

describe("prepareSanitizeScan", () => {
  it("replaces emails before constructing the AI privacy-scan prompt", () => {
    const prepared = prepareSanitizeScan(
      "From: admin@acme.test\nCC: ops@acme.test",
      ["EMAIL_1"]
    );

    expect(prepared.emailEntities).toEqual([
      { text: "admin@acme.test", type: "email" },
      { text: "ops@acme.test", type: "email" },
    ]);
    expect(prepared.scanText).toMatch(/^From: PRIVATE_[A-F0-9]{12}\nCC: PRIVATE_[A-F0-9]{12}$/);
    expect(prepared.scanText).not.toContain("@acme.test");
    expect(prepared.scanAliases[0]).toBe("EMAIL_1");
    expect(prepared.scanAliases.slice(1)).toEqual([
      expect.stringMatching(/^PRIVATE_[A-F0-9]{12}$/),
      expect.stringMatching(/^PRIVATE_[A-F0-9]{12}$/),
    ]);
  });

  it("removes locally detectable PII before constructing the AI scan", () => {
    const prepared = prepareSanitizeScan(
      "Jane Doe: call (512) 555-0199 or visit https://private.example/case/1",
      []
    );

    expect(prepared.localEntities).toEqual(expect.arrayContaining([
      { text: "Jane Doe", type: "person" },
      { text: "(512) 555-0199", type: "phone" },
      { text: "https://private.example/case/1", type: "url" },
    ]));
    expect(prepared.scanText).not.toContain("Jane Doe");
    expect(prepared.scanText).not.toContain("555-0199");
    expect(prepared.scanText).not.toContain("private.example");
    expect(prepared.scanText.match(/PRIVATE_[A-F0-9]{12}/g)).toHaveLength(3);
  });
});
