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
    expect(prompt).toContain("**Recommended Title:**");
    expect(prompt).toContain("120 words or fewer and 800 characters or fewer");
    expect(prompt).toContain("**Type: Strategic Relationship Management**");
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

  // Outlook headers write senders and recipients as "Last, First". The note
  // must normalize to "First Last" and never split one such name into two
  // people when reading a To/Cc list.
  it("normalizes Last, First sender names to First Last", () => {
    const prompt = buildEmailThreadPrompt({
      emailThread: "From: Priddy, Ryley\nTo: Smith, Jordan; Lee, Dana\n\nThanks all.",
      threadTitle: "License cleanup",
    });

    expect(prompt).toContain('Normalize every name to "First Last"');
    expect(prompt).toContain("never turn one person into two");
  });

  // The Teams tab asks for a deliberately minimal note: participants, the
  // concrete details, and the to-dos — no citations, callouts, or SFDC entry.
  it("builds a minimal details-and-todos prompt for Teams threads", () => {
    const prompt = buildEmailThreadPrompt({
      emailThread: "October 8, 2026\nPriddy, Ryley 10:32 AM\nCan you confirm the license count?",
      threadTitle: "License count check",
      threadKind: "teams",
    });

    expect(prompt).toContain("Teams chat thread");
    expect(prompt).toContain("Ignore chat noise");
    expect(prompt).toContain("*Participants:");
    expect(prompt).toContain("## Notes");
    expect(prompt).toContain("## To-Dos");
    expect(prompt).toContain("#teams-thread");
    expect(prompt).toContain("**Response needed:**");
    expect(prompt).not.toContain("## SFDC Activity Entry");
    expect(prompt).not.toContain("## Attendee Callouts");
    expect(prompt).not.toContain("Cite every factual bullet");
  });

  it("passes the CSM's participant list into the Teams prompt", () => {
    const prompt = buildEmailThreadPrompt({
      emailThread: "Priddy, Ryley 10:32 AM\nPing me when the install finishes.",
      threadTitle: "Install check",
      threadKind: "teams",
      threadParticipants: "Dana Smith (EA admin), Jordan Lee",
    });

    expect(prompt).toContain("PARTICIPANTS (from the CSM): Dana Smith (EA admin), Jordan Lee");
  });

  it("keeps the email prompt free of Teams sections", () => {
    const prompt = buildEmailThreadPrompt({
      emailThread: "Subject: License cleanup\n\nSam agreed to use the shared license portal.",
      threadTitle: "License cleanup",
    });

    expect(prompt).toContain("#email-thread");
    expect(prompt).toContain("## SFDC Activity Entry");
    expect(prompt).not.toContain("#teams-thread");
    expect(prompt).not.toContain("## To-Dos");
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
