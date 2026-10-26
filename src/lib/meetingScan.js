import { applyCorrections, applyReplacements } from "./sanitize";

function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

// Everything a meeting note can send to a model, assembled for the Privacy
// Review scan. Each input that reaches the prompt has to be covered here:
// anything missing is only discovered by the fail-closed boundary after the
// user has already approved the review. That includes the existing note being
// updated (older notes list attendee emails), slide text and file names, the
// configured goals, and the follow-up settings.
export function buildMeetingScanText({
  meetingTitle,
  transcript,
  extendedTranscript,
  meetingContext,
  selectedFolder,
  accountName,
  ownerNames = [],
  existingNote,
  slides = [],
  goals = [],
  followUp,
  corrections = [],
  replacements = [],
}) {
  // Optional inputs arrive as undefined or null; normalize before corrections,
  // which call String#replaceAll.
  const prepare = (text) => applyReplacements(applyCorrections(String(text ?? ""), corrections), replacements);
  return [
    meetingTitle,
    transcript,
    extendedTranscript,
    meetingContext,
    selectedFolder,
    accountName,
    ...(ownerNames || []),
    ...stringsIn(goals),
    ...stringsIn(followUp),
    // A slide that was not read contributes no text, so only its file name,
    // which still becomes a source label, is scanned.
    ...(slides || []).flatMap((slide) => [slide?.name, slide?.status === "done" ? slide?.text : ""]),
    existingNote?.content,
  ]
    .map(prepare)
    .filter((part) => part.trim())
    .join("\n\n");
}
