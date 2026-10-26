import { describe, expect, it } from "vitest";
import { buildMeetingScanText } from "./meetingScan";
import { extractLocalSensitiveEntities } from "./privacy";

const base = { meetingTitle: "Sync", transcript: "We confirmed the count.", meetingContext: "", ownerNames: [] };
const emailsIn = (text) => extractLocalSensitiveEntities(text).filter((entity) => entity.type === "email").map((entity) => entity.text);

describe("buildMeetingScanText", () => {
  // Updating a note sends the old note as a source, and older notes list
  // attendee emails. They must reach Privacy Review, not first appear at the
  // outbound boundary after the review was approved.
  it("includes the existing note so its emails are reviewed", () => {
    const text = buildMeetingScanText({
      ...base,
      existingNote: { content: "## Attendees\n\n- Dana Okafor — dana.okafor@example.test" },
    });
    expect(emailsIn(text)).toEqual(["dana.okafor@example.test"]);
  });

  it("includes slide text for slides that were read, and every slide's file name", () => {
    const text = buildMeetingScanText({
      ...base,
      slides: [
        { name: "northwind-roadmap.png", status: "done", text: "Contact: sam.lee@example.test" },
        { name: "unread-slide.png", status: "failed", text: "hidden@example.test" },
      ],
    });
    expect(text).toContain("northwind-roadmap.png");
    expect(text).toContain("unread-slide.png");
    expect(emailsIn(text)).toEqual(["sam.lee@example.test"]);
  });

  it("includes goals and follow-up settings, which also reach the prompt", () => {
    const text = buildMeetingScanText({
      ...base,
      goals: [{ goal: "Renew the Northwind agreement", target: "by Q2" }],
      followUp: { enabled: true, audience: "customer", instructions: "cc pat@example.test" },
    });
    expect(text).toContain("Renew the Northwind agreement");
    expect(emailsIn(text)).toEqual(["pat@example.test"]);
  });

  it("applies saved corrections and replacements to every input, existing note included", () => {
    const text = buildMeetingScanText({
      ...base,
      existingNote: { content: "Marlo owns the rollout and Riley follows up." },
      corrections: [{ find: "Riley", replace: "Ryley" }],
      replacements: [{ original: "Marlo", alias: "PRIVATE_A1", restored: "Marlowe" }],
    });
    expect(text).toContain("PRIVATE_A1 owns the rollout and Ryley follows up.");
    expect(text).not.toContain("Marlo");
  });

  it("does not crash on absent optional fields when corrections are configured", () => {
    const corrections = [{ find: "Riley", replace: "Ryley" }];
    expect(() => buildMeetingScanText({ meetingTitle: "T", transcript: "Riley", corrections })).not.toThrow();
    expect(buildMeetingScanText({ meetingTitle: "T", transcript: "Riley", existingNote: null, slides: undefined, corrections })).toBe("T\n\nRyley");
  });
});
