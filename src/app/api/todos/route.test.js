import { describe, expect, it } from "vitest";
import { extractItems, isRelevantItem } from "./route";

describe("isRelevantItem", () => {
  it("matches CSM-owned todo items", () => {
    expect(isRelevantItem("- [ ] Follow up on deployment plan — **Owner:** CSM team | **Due:** TBD")).toBe(true);
    expect(isRelevantItem("- [ ] Send renewal notes — **Owner:** CSM | **Due:** Friday")).toBe(true);
    expect(isRelevantItem("- [ ] Coordinate enablement — **Owner:** Customer Success Manager | **Due:** TBD")).toBe(true);
    expect(isRelevantItem("- [ ] Review usage — **Owner:** CSMs | **Due:** TBD")).toBe(true);
  });

  it("ignores non-CSM customer-owned todo items", () => {
    expect(isRelevantItem("- [ ] Share server list — **Owner:** Customer IT | **Due:** TBD")).toBe(false);
  });

  it("matches only the owner field, not names in the task text", () => {
    expect(isRelevantItem("- [ ] Dana to send Ryley the license list — **Owner:** Dana | **Due:** TBD", ["Ryley"])).toBe(false);
    expect(isRelevantItem("- [ ] Send the license list — **Owner:** Ryley | **Due:** TBD", ["Ryley"])).toBe(true);
  });

  it("accepts first-person owners in an explicit owner field only", () => {
    expect(isRelevantItem("- [ ] Send the summary — **Owner:** me | **Due:** TBD")).toBe(true);
    expect(isRelevantItem("- [ ] Dana asked me to review — **Owner:** Dana | **Due:** TBD")).toBe(false);
  });

  it("falls back to whole-line matching when there is no owner field", () => {
    expect(isRelevantItem("- Ryley to schedule the QBR follow-up", ["Ryley"])).toBe(true);
    expect(isRelevantItem("- Customer IT to patch the servers", ["Ryley"])).toBe(false);
  });
});

describe("extractItems", () => {
  it("extracts CSM-owned action items into todos", () => {
    const items = extractItems(`# Meeting

## Action Items

- [ ] Send training plan — **Owner:** CSM team | **Due:** TBD
- [ ] Share firewall rules — **Owner:** Customer IT | **Due:** TBD

---

## Next Steps

- Schedule enablement with CSMs
`);

    expect(items.actionItems).toEqual([
      "- [ ] Send training plan — **Owner:** CSM team | **Due:** TBD",
    ]);
    expect(items.nextSteps).toEqual([
      "- Schedule enablement with CSMs",
    ]);
  });
});
