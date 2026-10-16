import { describe, expect, it } from "vitest";
import {
  assertOutboundPrivacy,
  inspectOutboundPrivacy,
  outboundHasImages,
  outboundPromptText,
  privacyAuditRecord,
} from "./privacyBoundary";

const request = (text) => ({ system: "Follow instructions.", messages: [{ role: "user", content: text }] });

describe("outbound privacy boundary", () => {
  it("inspects the final assembled system and message text", () => {
    expect(outboundPromptText(request("Contact jane@example.com"))).toContain("Follow instructions.\nContact jane@example.com");
    expect(inspectOutboundPrivacy(request("Contact jane@example.com"))).toEqual([
      { text: "jane@example.com", type: "email" },
    ]);
  });

  it("blocks deterministic PII and configured originals without echoing them", () => {
    expect(() => assertOutboundPrivacy(request("Call 512-555-0199"))).toThrow(/Privacy boundary blocked/);
    expect(() => assertOutboundPrivacy(request("ORG_1 update for Northwind"), {
      sensitiveTerms: [{ text: "Northwind", type: "org" }],
    })).toThrow(/1 org/);
    expect(() => assertOutboundPrivacy(request("ORG_1 update"), {
      sensitiveTerms: [{ text: "Northwind", type: "org" }],
    })).not.toThrow();
  });

  it("requires explicit approval for image content", () => {
    const params = { messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
      { type: "text", text: "Read it" },
    ] }] };
    expect(outboundHasImages(params)).toBe(true);
    expect(() => assertOutboundPrivacy(params)).toThrow(/blocked an image request/);
    expect(() => assertOutboundPrivacy(params, { allowImages: true })).not.toThrow();
  });

  it("creates a useful audit record without retaining raw content", () => {
    const params = request("Contact jane@example.com");
    const record = privacyAuditRecord("blocked", params, [{ text: "jane@example.com", type: "email" }], "unresolved-sensitive-data");
    expect(record).toMatchObject({ decision: "blocked", reason: "unresolved-sensitive-data", findings: { email: 1 } });
    expect(record.requestHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(record)).not.toContain("jane@example.com");
  });
});
