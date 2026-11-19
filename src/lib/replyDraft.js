export const REPLY_CHECKS_HEADING = "## Before You Send";

// A drafted reply comes back as the message itself, then a short list of what
// the CSM should confirm first. Only the message is ever copied or sent.
export function splitReplyDraft(markdown = "") {
  const text = String(markdown || "").trim();
  const match = /(?:^|\n)(?:---\s*\n+)?##\s*Before You Send\s*\n?/i.exec(text);
  if (!match) return { reply: text, checks: "" };
  return {
    reply: text.slice(0, match.index).replace(/\n---\s*$/, "").trim(),
    checks: text.slice(match.index + match[0].length).trim(),
  };
}

// Customers are on an email thread far more often than in a Teams chat, so
// the starting audience follows the kind of thread; the CSM can change it.
export function defaultReplyAudience(threadKind) {
  return threadKind === "teams" ? "internal" : "customer";
}
