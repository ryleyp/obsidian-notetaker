import { isCanonicalPair } from "./sfdcTaxonomy";

export const IMPROVEMENT_FIELDS = ["title", "type", "subtype", "comments"];

// Keep dates, agreements, source links and filing metadata outside model edits.
// Reject the entire response if any proposal is malformed or over SFDC limits.
export function parseImprovement(text, rows) {
  const result = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""));
  if (typeof result.message !== "string" || !result.message.trim() || !Array.isArray(result.changes)) {
    throw new Error("The model returned an invalid refinement. Please try again.");
  }
  const seen = new Set();
  const changes = result.changes.map((change) => {
    if (!change || !Number.isInteger(change.index) || !rows[change.index] || seen.has(change.index)) {
      throw new Error("The model returned an invalid activity reference. Please try again.");
    }
    seen.add(change.index);
    const patch = {};
    for (const field of IMPROVEMENT_FIELDS) {
      if (typeof change[field] !== "string" || !change[field].trim()) {
        throw new Error("The model returned an incomplete activity. Please try again.");
      }
      patch[field] = change[field].trim();
    }
    if (patch.title.length > 200 || patch.comments.length > 800 || patch.comments.split(/\s+/).length > 120 || !isCanonicalPair(patch.type, patch.subtype)) {
      throw new Error("The model returned an activity outside the Salesforce limits or taxonomy. Please try again.");
    }
    return { index: change.index, ...patch };
  }).filter((change) => IMPROVEMENT_FIELDS.some((field) => change[field] !== rows[change.index][field]));
  return { message: result.message.trim(), changes };
}

export function applyImprovement(rows, changes) {
  const byIndex = new Map(changes.map((change) => [change.index, change]));
  return rows.map((row, index) => {
    const change = byIndex.get(index);
    if (!change) return row;
    const patch = Object.fromEntries(IMPROVEMENT_FIELDS.map((field) => [field, change[field]]));
    return {
      ...row, ...patch, origin: "generated", review: true,
      reviewReason: "AI improvement applied — review before filing.",
      verify: "", verifyReason: "", suggestedType: "", suggestedSubtype: "", suggestReason: "",
    };
  });
}
