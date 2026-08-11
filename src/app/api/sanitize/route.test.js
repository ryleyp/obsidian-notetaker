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
    expect(prepared.scanText).toBe("From: EMAIL_2\nCC: EMAIL_3");
    expect(prepared.scanText).not.toContain("@acme.test");
    expect(prepared.scanAliases).toEqual(["EMAIL_1", "EMAIL_2", "EMAIL_3"]);
  });
});
