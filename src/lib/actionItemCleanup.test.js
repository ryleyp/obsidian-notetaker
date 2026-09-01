import { describe, expect, it } from "vitest";
import {
  cleanupActionItems,
  completeActionItemEdit,
  openActionItemLines,
  parseActionItemLine,
} from "./actionItemCleanup";

const NOTE = (items) => `# 2026-08-20 - Sync\n\n## Action Items\n\n${items}\n\n---\n\n## Next Steps\n\n- Milestone\n`;

describe("parseActionItemLine", () => {
  it("parses the canonical shape", () => {
    expect(parseActionItemLine("- [ ] Send summary — **Owner:** Ryley | **Due:** 2026-09-05")).toEqual({
      indent: "",
      checked: false,
      text: "Send summary",
      owner: "Ryley",
      due: "2026-09-05",
    });
  });

  it("parses unbolded owner and missing checkbox/due", () => {
    expect(parseActionItemLine("- Send summary - Owner: me")).toEqual({
      indent: "",
      checked: false,
      text: "Send summary",
      owner: "me",
      due: "",
    });
  });

  it("keeps checked state and returns null for non-bullets", () => {
    expect(parseActionItemLine("- [x] Done thing — **Owner:** Dana | **Due:** TBD").checked).toBe(true);
    expect(parseActionItemLine("Some prose line")).toBeNull();
  });
});

describe("cleanupActionItems", () => {
  it("normalizes malformed lines and maps first-person owners", () => {
    const content = NOTE("- Send summary - Owner: me\n- [ ] Fine item — **Owner:** Dana | **Due:** TBD");
    const edits = cleanupActionItems(content, { ownerNames: ["Ryley"] });
    expect(edits).toEqual([
      {
        from: "- Send summary - Owner: me",
        to: "- [ ] Send summary — **Owner:** Ryley | **Due:** TBD",
        reason: "owner mapped to your name",
      },
    ]);
  });

  it("removes duplicate items within the note", () => {
    const content = NOTE("- [ ] Send summary — **Owner:** Ryley | **Due:** TBD\n- [ ] Send  summary — **Owner:** Ryley | **Due:** TBD");
    const edits = cleanupActionItems(content, { ownerNames: ["Ryley"] });
    expect(edits).toHaveLength(1);
    expect(edits[0].to).toBe("");
    expect(edits[0].reason).toBe("duplicate item");
  });

  it("leaves canonical sections and prose untouched", () => {
    const content = NOTE("- [ ] Fine item — **Owner:** Dana | **Due:** 2026-09-01");
    expect(cleanupActionItems(content, { ownerNames: ["Ryley"] })).toEqual([]);
    expect(cleanupActionItems("# No action items here", {})).toEqual([]);
  });
});

describe("completeActionItemEdit / openActionItemLines", () => {
  it("lists open items and produces a completion edit", () => {
    const content = NOTE("- [ ] Open item — **Owner:** Ryley | **Due:** TBD\n- [x] Done item — **Owner:** Ryley | **Due:** TBD");
    const open = openActionItemLines(content);
    expect(open).toEqual(["- [ ] Open item — **Owner:** Ryley | **Due:** TBD"]);
    expect(completeActionItemEdit(content, open[0])).toEqual({
      from: "- [ ] Open item — **Owner:** Ryley | **Due:** TBD",
      to: "- [x] Open item — **Owner:** Ryley | **Due:** TBD",
      reason: "completed",
    });
  });

  it("refuses to complete lines not present or already checked", () => {
    const content = NOTE("- [ ] Open item — **Owner:** Ryley | **Due:** TBD");
    expect(completeActionItemEdit(content, "- [ ] Missing item")).toBeNull();
    expect(completeActionItemEdit(content, "- [x] Open item — **Owner:** Ryley | **Due:** TBD")).toBeNull();
  });
});
