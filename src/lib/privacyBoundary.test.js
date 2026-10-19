import { describe, expect, it } from "vitest";
import {
  anonymizeOutboundParams,
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

  it("repairs a known glossary leak with its existing alias before sending", () => {
    const policy = {
      sensitiveTerms: [
        { text: "Northwind Aerospace", alias: "PRIVATE_AAAAAAAAAAAA", type: "org" },
        { text: "Northwind", alias: "PRIVATE_AAAAAAAAAAAA", type: "org" },
      ],
    };
    const repaired = anonymizeOutboundParams(request("Northwind Aerospace met Northwind"), policy);

    expect(outboundPromptText(repaired)).toContain("PRIVATE_AAAAAAAAAAAA met PRIVATE_AAAAAAAAAAAA");
    expect(outboundPromptText(repaired)).not.toContain("Northwind");
    expect(() => assertOutboundPrivacy(repaired, policy)).not.toThrow();
  });

  it("repairs text blocks without changing image blocks", () => {
    const image = { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } };
    const repaired = anonymizeOutboundParams({ messages: [{ role: "user", content: [
      image,
      { type: "text", text: "Northwind update" },
    ] }] }, { sensitiveTerms: [{ text: "Northwind", alias: "PRIVATE_AAAAAAAAAAAA", type: "org" }] });

    expect(repaired.messages[0].content[0]).toBe(image);
    expect(repaired.messages[0].content[1].text).toBe("PRIVATE_AAAAAAAAAAAA update");
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

  // Instruction text carries example names. A glossary term that happens to
  // match one must not block every request, but the same term in the user's
  // own content must still be caught.
  it("ignores fixed template lines but still scans lines that carry user content", () => {
    const templateText = 'Example: "Dana pushed back on the timeline."\nMeeting Title:';
    const policy = { sensitiveTerms: ["Dana"], templateText };

    const clean = request('Example: "Dana pushed back on the timeline."\nMeeting Title: PRIVATE_AAAAAAAAAAAA sync');
    expect(inspectOutboundPrivacy(clean, policy)).toEqual([]);
    expect(() => assertOutboundPrivacy(clean, policy)).not.toThrow();

    const leaked = request('Example: "Dana pushed back on the timeline."\nMeeting Title: Dana sync');
    expect(inspectOutboundPrivacy(leaked, policy)).toEqual([{ text: "Dana", type: "org" }]);
    expect(() => assertOutboundPrivacy(leaked, policy)).toThrow(/blocked this AI request/);

    // Without a template the example line itself is scanned, as before.
    expect(inspectOutboundPrivacy(clean, { sensitiveTerms: ["Dana"] })).toHaveLength(1);
  });
});
