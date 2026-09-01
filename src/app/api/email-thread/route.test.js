import { describe, expect, it } from "vitest";
import { buildEmailThreadPrompt, createEmailThreadMessage } from "./route";
import { buildSourceBundle } from "@/lib/sourceBundle";

describe("buildEmailThreadPrompt", () => {
  it("builds a dated Obsidian email-thread note prompt with decisions and source citations", () => {
    const prompt = buildEmailThreadPrompt({
      emailThread: "Subject: License cleanup\n\nSam agreed to use the shared license portal.",
      threadTitle: "License cleanup",
      threadDate: "2026-07-27",
      context: "CSM note: This relates to the Dallas lab rollout.",
    });

    expect(prompt).toContain("# 2026-07-27 - License cleanup");
    expect(prompt).toContain("[E1] Email thread");
    expect(prompt).toContain("[N1] Raw notes");
    expect(prompt).toContain("## Decisions");
    expect(prompt).toContain("## Attendee Callouts");
    expect(prompt).toContain("## Site-Level Callouts");
    expect(prompt).toContain("## Customer Success Callouts");
    expect(prompt).toContain("## Source Email Content");
    expect(prompt).toContain("## SFDC Activity Entry");
    expect(prompt).toContain("120 words or fewer and 800 characters or fewer");
    expect(prompt).toContain("Strategic Relationship Management → EA Admin Sync");
    expect(prompt).toContain("Cite every factual bullet or factual paragraph");
    expect(prompt).not.toContain("EXISTING NOTE UPDATE");
    expect(prompt).toContain("Create an Obsidian note from this email thread.");
    expect(prompt).toContain("**Response needed:**");
    expect(prompt).toContain("To/Cc recipients from the email headers");
  });

  it("adds update guidance when the existing note rides along as a source", () => {
    const sourceBundle = buildSourceBundle({
      emailThread: "Subject: License cleanup\n\nDana replied: portal access is now confirmed.",
      existingNote: "# 2026-07-20 - License cleanup\n\n- [ ] Confirm portal access — **Owner:** Dana | **Due:** TBD",
    });
    const prompt = buildEmailThreadPrompt({
      emailThread: "Subject: License cleanup\n\nDana replied: portal access is now confirmed.",
      threadTitle: "License cleanup",
      threadDate: "2026-07-27",
      sourceBundle,
    });

    expect(prompt).toContain("Update the existing Obsidian note for this email thread");
    expect(prompt).toContain("EXISTING NOTE UPDATE");
    expect(prompt).toContain("[O1] Existing meeting note");
    expect(prompt).toContain("When [O#] conflicts with [E#], use [E#]");
    expect(prompt).toContain("Carry forward action items from [O#]");
    expect(prompt).toContain("or [O#] for details preserved from the existing note");
  });
});

describe("createEmailThreadMessage", () => {
  it("uses the SDK streaming path for long-capable requests", async () => {
    const final = {
      content: [{ type: "text", text: "# Email note" }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const calls = [];
    const client = {
      messages: {
        stream(request) {
          calls.push(request);
          return { finalMessage: async () => final };
        },
        create() {
          throw new Error("Non-streaming path must not be used");
        },
      },
    };

    await expect(createEmailThreadMessage(client, { model: "test", max_tokens: 32_000 }))
      .resolves.toBe(final);
    expect(calls).toEqual([{ model: "test", max_tokens: 32_000 }]);
  });
});
