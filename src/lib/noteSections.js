export function noteSections(markdown) {
  const text = String(markdown || "");
  const matches = [...text.matchAll(/^##\s+(.+)$/gm)];
  if (!matches.length) return [{ key: "document", title: "Complete note", content: text }];
  const sections = [];
  if (matches[0].index > 0) sections.push({ key: "preamble", title: "Preamble", content: text.slice(0, matches[0].index) });
  matches.forEach((match, index) => {
    const end = matches[index + 1]?.index ?? text.length;
    sections.push({ key: match[1].trim().toLowerCase(), title: match[1].trim(), content: text.slice(match.index, end) });
  });
  return sections;
}

export function changedNoteSections(current, alternative) {
  const before = new Map(noteSections(current).map((section) => [section.key, section]));
  return noteSections(alternative).filter((section) => before.get(section.key)?.content !== section.content)
    .map((section) => ({ ...section, before: before.get(section.key)?.content || "" }));
}

export function replaceNoteSection(current, alternative, key) {
  const replacement = noteSections(alternative).find((section) => section.key === key);
  if (!replacement) return current;
  const sections = noteSections(current);
  const index = sections.findIndex((section) => section.key === key);
  if (index < 0) return `${current.trimEnd()}\n\n${replacement.content.trim()}\n`;
  sections[index] = replacement;
  return sections.map((section) => section.content).join("");
}
