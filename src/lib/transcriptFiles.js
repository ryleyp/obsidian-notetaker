export function titleFromTranscriptFilename(filename) {
  return String(filename || "").replace(/\.(?:txt|md)$/i, "");
}

export function findExactMeetingNote(notes, meetingTitle) {
  const title = String(meetingTitle || "");
  if (!title) return null;
  const expectedFilename = `${title}.md`.normalize("NFC");
  return (notes || []).find((note) => String(note?.filename || "").normalize("NFC") === expectedFilename) || null;
}
