// Speaker detection asks the model where turns START, not to retype the
// transcript: the client numbers the transcript's segments, the model
// answers with segment numbers, and the turns are rebuilt here from the
// client's own text. Output shrinks from the whole transcript to a few
// hundred tokens, and the transcript cannot be altered by the model —
// every segment is emitted exactly once, verbatim.

const MAX_WORDS_PER_SEGMENT = 25;
// Exported transcripts often alternate a bare timestamp line with a short
// utterance line. Splitting on every newline would make thousands of
// two-word segments, which bloats the prompt and buys no precision, so
// runs shorter than this are folded into the segment before them.
const MIN_WORDS_PER_SEGMENT = 8;

// Splits on sentence terminators and newlines, keeping each segment's
// trailing whitespace so joining every segment reproduces the input byte
// for byte. Over-splitting is harmless (adjacent segments in one turn are
// rejoined); under-splitting would cost boundary precision.
function rawSentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "\n") continue;
    let end = i + 1;
    if (ch !== "\n") {
      while (end < text.length && /[.!?]/.test(text[end])) end += 1;
      // A terminator with no whitespace after it is a decimal point or an
      // abbreviation ("2.5", "U.S."), not a sentence end — splitting there
      // would let a turn boundary cut a number in half.
      if (end < text.length && !/\s/.test(text[end])) continue;
    }
    while (end < text.length && /\s/.test(text[end])) end += 1;
    out.push(text.slice(start, end));
    start = end;
    i = end - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out.filter(Boolean);
}

// Dictation often runs on with little punctuation, which would leave one
// enormous segment and no way to place a boundary inside it.
function breakLongRun(text, maxWords) {
  const parts = text.split(/(\s+)/);
  const out = [];
  let buffer = "";
  let words = 0;
  for (const part of parts) {
    buffer += part;
    if (!part.trim()) continue;
    words += 1;
    if (words >= maxWords) {
      out.push(buffer);
      buffer = "";
      words = 0;
    }
  }
  if (buffer) out.push(buffer);
  return out;
}

function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function coalesceShortRuns(pieces, minWords) {
  const out = [];
  for (const piece of pieces) {
    const previous = out[out.length - 1];
    if (previous && countWords(previous) < minWords) out[out.length - 1] = previous + piece;
    else out.push(piece);
  }
  return out;
}

// Segments whose concatenation equals the original transcript exactly.
export function splitIntoSegments(
  transcript,
  { maxWords = MAX_WORDS_PER_SEGMENT, minWords = MIN_WORDS_PER_SEGMENT } = {}
) {
  const text = String(transcript || "");
  if (!text.trim()) return [];
  const pieces = rawSentences(text).flatMap((sentence) => breakLongRun(sentence, maxWords));
  return coalesceShortRuns(pieces, minWords);
}

export function formatSegmentsForPrompt(segments) {
  return segments.map((segment, i) => `[${i + 1}] ${segment.trim()}`).join("\n");
}

// Reads "12: Speaker 2" / "12-15: Speaker 2" / "**12:** Dana" lines and
// ignores anything else the model says. The end of a range is redundant —
// a turn runs until the next one starts — so only the start is kept.
export function parseBoundaries(text, segmentCount) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const match = line.match(/^\s*\**\s*(\d+)\s*(?:[-–—]\s*\d+)?\s*\**\s*[:.]\s*(.+?)\s*$/);
    if (!match) continue;
    const start = Number(match[1]) - 1;
    const label = match[2].replace(/\*/g, "").replace(/[:：]\s*$/, "").trim();
    if (!label || label.length > 60) continue;
    if (!Number.isInteger(start) || start < 0 || start >= segmentCount) continue;
    out.push({ start, label });
  }
  return out;
}

// Rebuilds turns from the client's segments. Boundaries only choose where
// turns break: every segment lands in exactly one turn regardless of gaps,
// overlaps, duplicates, or truncated model output.
export function assembleTurns(segments, boundaries) {
  if (!segments.length) return [];
  const starts = (boundaries || [])
    .filter((b) => Number.isInteger(b?.start) && b.start >= 0 && b.start < segments.length)
    .sort((a, b) => a.start - b.start);

  if (!starts.length) {
    const text = segments.join("").trim();
    return text ? [{ label: "Speaker 1", text }] : [];
  }

  const turns = [];
  for (let i = 0; i < starts.length; i++) {
    // The first turn absorbs anything before the first boundary, and the
    // last absorbs everything after the final one.
    const from = i === 0 ? 0 : starts[i].start;
    const to = i + 1 < starts.length ? starts[i + 1].start : segments.length;
    if (to <= from) continue;
    const text = segments.slice(from, to).join("").trim();
    if (!text) continue;
    const previous = turns[turns.length - 1];
    if (previous && previous.label === starts[i].label) previous.text = `${previous.text} ${text}`.trim();
    else turns.push({ label: starts[i].label, text });
  }
  return turns;
}
