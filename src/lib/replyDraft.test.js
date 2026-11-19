import { describe, expect, it } from "vitest";
import { defaultReplyAudience, splitReplyDraft } from "./replyDraft";

describe("splitReplyDraft", () => {
  it("separates the message from the checks so only the message is copied", () => {
    const draft = "**Subject:** RE: Count\n\nHi Dana,\n\nThe count is 40.\n\n---\n\n## Before You Send\n\n- Confirm the count.";
    expect(splitReplyDraft(draft)).toEqual({
      reply: "**Subject:** RE: Count\n\nHi Dana,\n\nThe count is 40.",
      checks: "- Confirm the count.",
    });
  });

  it("treats a draft with no checks section as all message", () => {
    expect(splitReplyDraft("Thanks, will do.")).toEqual({ reply: "Thanks, will do.", checks: "" });
    expect(splitReplyDraft("")).toEqual({ reply: "", checks: "" });
  });
});

describe("defaultReplyAudience", () => {
  it("starts email replies as customer-facing and Teams replies as internal", () => {
    expect(defaultReplyAudience("email")).toBe("customer");
    expect(defaultReplyAudience("teams")).toBe("internal");
  });
});
