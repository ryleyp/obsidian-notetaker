import { describe, expect, it } from "vitest";
import { splitGeneratedFollowUp } from "./followUpDraft";

describe("splitGeneratedFollowUp", () => {
  it("separates an in-call follow-up draft from meeting notes", () => {
    const output = `# Rollout Sync

## Executive Summary

The rollout was approved.

---

## Follow-Up Email Draft
Subject: Rollout next steps

Thanks for meeting today.`;

    expect(splitGeneratedFollowUp(output)).toEqual({
      notes: "# Rollout Sync\n\n## Executive Summary\n\nThe rollout was approved.",
      followUpDraft: "Subject: Rollout next steps\n\nThanks for meeting today.",
    });
  });

  it("leaves ordinary meeting notes unchanged", () => {
    expect(splitGeneratedFollowUp("# Rollout Sync\n\nNo email requested.")).toEqual({
      notes: "# Rollout Sync\n\nNo email requested.",
      followUpDraft: "",
    });
  });
});
