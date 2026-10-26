import { describe, expect, it } from "vitest";
import {
  anonymizeOutboundParams,
  assertOutboundPrivacy,
  inspectOutboundPrivacy,
  outboundHasImages,
  outboundPromptText,
  pseudonymizeEmails,
  restoreEmails,
  createEmailRestorer,
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

  it("can skip the text scan for an approved screenshot read while still requiring image approval", () => {
    const withLink = {
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
        { type: "text", text: "The transcription so far ends with: see https://example.test/doc" },
      ] }],
    };
    expect(() => assertOutboundPrivacy(withLink, { allowImages: true })).toThrow(/blocked this AI request/);
    expect(() => assertOutboundPrivacy(withLink, { allowImages: true, scanText: false })).not.toThrow();
    expect(() => assertOutboundPrivacy(withLink, { scanText: false })).toThrow(/blocked an image request/);
  });

  describe("email repair", () => {
    it("swaps each distinct address for a placeholder and restores it exactly", () => {
      const params = { system: "Cc: pat@example.test", messages: [{ role: "user", content: [
        { type: "text", text: "From dana.okafor@example.test, again Dana.Okafor@Example.TEST, and pat@example.test." },
        { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
      ] }] };
      const { params: safe, restorations } = pseudonymizeEmails(params);

      expect(restorations).toHaveLength(2);
      expect(outboundPromptText(safe)).not.toMatch(/@/);
      expect(safe.messages[0].content[1]).toEqual(params.messages[0].content[1]);
      expect(inspectOutboundPrivacy(safe, {})).toEqual([]);

      const echoed = outboundPromptText(safe);
      const restored = restoreEmails(echoed, restorations);
      expect(restored).toContain("dana.okafor@example.test");
      expect(restored).toContain("pat@example.test");
      expect(restored).not.toContain("PRIVATE_");
    });

    it("leaves a request with no email address untouched", () => {
      const params = request("No addresses here.");
      expect(pseudonymizeEmails(params)).toEqual({ params, restorations: [] });
    });

    it("uses a fresh random placeholder each time", () => {
      const first = pseudonymizeEmails(request("a@example.test")).restorations[0].alias;
      const second = pseudonymizeEmails(request("a@example.test")).restorations[0].alias;
      expect(first).toMatch(/^PRIVATE_[A-F0-9]{12}$/);
      expect(first).not.toBe(second);
    });
  });

  describe("streaming email restore", () => {
    const restorations = [{ original: "dana.okafor@example.test", alias: "PRIVATE_0123456789AB" }];
    const run = (chunks) => {
      const restorer = createEmailRestorer(restorations);
      return chunks.map((chunk) => restorer.push(chunk)).join("") + restorer.flush();
    };

    it("restores a placeholder that arrives whole", () => {
      expect(run(["Contact: PRIVATE_0123456789AB today."])).toBe("Contact: dana.okafor@example.test today.");
    });

    it("restores a placeholder split at every possible position", () => {
      const text = "Contact: PRIVATE_0123456789AB, thanks.";
      for (let cut = 1; cut < text.length; cut += 1) {
        expect(run([text.slice(0, cut), text.slice(cut)]), `split at ${cut}`).toBe("Contact: dana.okafor@example.test, thanks.");
      }
    });

    it("restores a placeholder fed one character at a time", () => {
      expect(run([..."a PRIVATE_0123456789AB b"])).toBe("a dana.okafor@example.test b");
    });

    it("releases text that only looks like the start of a placeholder", () => {
      expect(run(["Seen in PRIV", "ATE data", " and PRIVATE_"])).toBe("Seen in PRIVATE data and PRIVATE_");
    });

    it("passes everything through unchanged when there is nothing to restore", () => {
      const restorer = createEmailRestorer([]);
      expect(restorer.push("PRIVATE_0123456789AB")).toBe("PRIVATE_0123456789AB");
      expect(restorer.flush()).toBe("");
    });
  });
});
