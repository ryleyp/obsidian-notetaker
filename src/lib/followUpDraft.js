export const FOLLOW_UP_HEADING = "## Follow-Up Email Draft";

export function splitGeneratedFollowUp(markdown = "") {
  const headingPattern = /(?:^|\n)## Follow-Up Email Draft\s*\n/i;
  const match = headingPattern.exec(markdown);
  if (!match) return { notes: markdown.trim(), followUpDraft: "" };

  const notes = markdown
    .slice(0, match.index)
    .replace(/\n---\s*$/m, "")
    .trim();
  const followUpDraft = markdown.slice(match.index + match[0].length).trim();
  return { notes, followUpDraft };
}
