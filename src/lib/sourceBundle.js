const DEFAULT_CHUNK_CHARS = 950;

function cleanText(value) {
  return (value || "").replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

function normalizeChunk(value) {
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

function splitLongParagraph(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*/g) || [paragraph];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function makeSourceBlocks(text, { prefix, label, maxChars = DEFAULT_CHUNK_CHARS }) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const paragraphs = cleaned
    .split(/\n\s*\n/g)
    .flatMap((paragraph) => splitLongParagraph(normalizeChunk(paragraph), maxChars))
    .filter(Boolean);

  const blocks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) {
      blocks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) blocks.push(current);

  return blocks.map((content, index) => ({
    id: `${prefix}${index + 1}`,
    label,
    content,
  }));
}

function makeTranscriptSources(transcript, extendedTranscript) {
  const hasExtendedTranscript = Boolean(cleanText(extendedTranscript));
  const inputs = [
    {
      text: transcript,
      label: hasExtendedTranscript ? "Primary transcript" : "Transcript",
    },
    ...(hasExtendedTranscript
      ? [{ text: extendedTranscript, label: "Extended transcript" }]
      : []),
  ];

  let nextId = 1;
  return inputs.flatMap(({ text, label }) =>
    makeSourceBlocks(text, { prefix: "T", label }).map((source) => ({
      ...source,
      id: `T${nextId++}`,
    }))
  );
}

export function formatTranscriptArchive(transcript, extendedTranscript = "") {
  const primary = cleanText(transcript);
  const extended = cleanText(extendedTranscript);
  if (!extended) return primary;
  return `## Primary transcript\n\n${primary}\n\n---\n\n## Extended transcript\n\n${extended}`;
}

export function buildSourceBundle({
  transcript = "",
  extendedTranscript = "",
  rawNotes = "",
  emailThread = "",
  existingNote = "",
} = {}) {
  const transcriptSources = makeTranscriptSources(transcript, extendedTranscript);
  const rawNoteSources = makeSourceBlocks(rawNotes, { prefix: "N", label: "Raw notes" });
  const emailSources = makeSourceBlocks(emailThread, { prefix: "E", label: "Email thread" });
  const existingNoteSources = makeSourceBlocks(existingNote, { prefix: "O", label: "Existing meeting note" });
  return {
    transcriptSources,
    rawNoteSources,
    emailSources,
    existingNoteSources,
    allSources: [...transcriptSources, ...rawNoteSources, ...emailSources, ...existingNoteSources],
  };
}

export function formatSourceBundleForPrompt(sourceBundle) {
  const sources = sourceBundle?.allSources || [];
  if (!sources.length) return "";

  return sources
    .map((source) => `[${source.id}] ${source.label}\n${source.content}`)
    .join("\n\n");
}

export function mapSourceBundle(sourceBundle, mapper) {
  const mapOne = (source) => ({ ...source, content: mapper(source.content) });
  const transcriptSources = (sourceBundle?.transcriptSources || []).map(mapOne);
  const rawNoteSources = (sourceBundle?.rawNoteSources || []).map(mapOne);
  const emailSources = (sourceBundle?.emailSources || []).map(mapOne);
  const existingNoteSources = (sourceBundle?.existingNoteSources || []).map(mapOne);
  return {
    transcriptSources,
    rawNoteSources,
    emailSources,
    existingNoteSources,
    allSources: [...transcriptSources, ...rawNoteSources, ...emailSources, ...existingNoteSources],
  };
}

export function extractReferencedSourceIds(markdown) {
  const found = new Set();
  const regex = /\[([TNEO]\d+)\]/g;
  let match;
  while ((match = regex.exec(markdown || ""))) {
    found.add(match[1]);
  }

  return [...found].sort((a, b) => {
    const priority = { T: 0, N: 1, E: 2, O: 3 };
    const prefixCompare = (priority[a[0]] ?? 9) - (priority[b[0]] ?? 9);
    if (prefixCompare !== 0) return prefixCompare;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
}

export function sourceExcerpt(source, maxChars = 420) {
  const content = cleanText(source?.content || "");
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars).trimEnd()}...`;
}
