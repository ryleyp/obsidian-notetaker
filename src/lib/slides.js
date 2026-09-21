// Slide screenshots as a note source.
//
// A slide is read once, by a vision model, into plain text — title, bullets,
// tables, figures, numbers as printed — and that text then travels with the
// meeting like a transcript does: it is pseudonymized before the note prompt
// sees it, cited as [S#] in the note, shown in the source panel, and saved
// into the transcript archive. The image itself is sent exactly once and
// never again, so regenerating, second opinions, and comparisons stay cheap
// and consistent.

export const MAX_SLIDES = 24;
export const MAX_SLIDE_EDGE = 1600; // px, longest side after client-side downscale
export const MAX_SLIDE_BYTES = 1_500_000; // per image, after downscale
export const SLIDE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

// What the vision model is asked to do with each slide. Transcription, not
// interpretation: the note prompt does the interpreting, with the transcript
// beside it.
export const SLIDE_SYSTEM_PROMPT = `You transcribe presentation slides for a Customer Success Manager's meeting record. Each image is one slide shown during the meeting.

For every slide, write out what is actually on it, in Markdown, in this order:
1. The slide title as printed (or "Untitled" if there is none).
2. Every line of text, bullet, label, callout, and footnote, verbatim, keeping the slide's own hierarchy as nested bullets.
3. Every table as a Markdown table, with the exact cell values.
4. Every chart or diagram as a short factual description: chart type, axes and units, series names, and every number that is printed on it. If values are only implied by bar height and not printed, say "values not printed" rather than estimating.
5. Any visible speaker notes, dates, version numbers, product names, or logos as text.

Rules:
- Copy numbers, product names, versions, dates, and names exactly as printed. Never round, expand an abbreviation, or correct a spelling.
- Never add meaning, context, or conclusions that are not on the slide. Never guess at cropped or blurred text — write [unreadable] in its place.
- If an image is not a slide (a photo, a blank screen, a desktop), say so in one line and stop.
- Do not summarise. A slide with forty lines produces forty lines.`;

export function slideUserPrompt(index, total, name) {
  return `Slide ${index + 1} of ${total}${name ? ` (file: ${name})` : ""}. Transcribe it as instructed.`;
}

// The Anthropic-shaped content for one slide; modelClient maps it for OpenAI.
export function slideMessageContent(slide, index, total) {
  return [
    { type: "image", source: { type: "base64", media_type: slide.mediaType, data: slide.data } },
    { type: "text", text: slideUserPrompt(index, total, slide.name) },
  ];
}

// Validates what the client sent before any of it reaches a model.
export function validateSlidePayload(slides) {
  if (!Array.isArray(slides) || !slides.length) return "At least one slide image is required.";
  if (slides.length > MAX_SLIDES) return `At most ${MAX_SLIDES} slides per meeting.`;
  for (const [index, slide] of slides.entries()) {
    if (!slide || typeof slide.data !== "string" || !slide.data) return `Slide ${index + 1} has no image data.`;
    if (!SLIDE_MEDIA_TYPES.includes(slide.mediaType)) return `Slide ${index + 1}: ${slide.mediaType || "unknown type"} is not a supported image type.`;
    // Base64 inflates by 4/3; compare against the raw byte budget.
    if (slide.data.length * 0.75 > MAX_SLIDE_BYTES) return `Slide ${index + 1} is too large — resize it under ${Math.round(MAX_SLIDE_BYTES / 1e6 * 10) / 10} MB.`;
  }
  return "";
}

// The slides section of a saved transcript archive, so the evidence a note
// cites survives beside the transcript it was read with.
export function formatSlidesForArchive(slides = []) {
  // Numbered by deck position, matching the [S#] citations in the note; a
  // slide that could not be read is simply absent.
  const sections = slides
    .map((slide, index) => ({ slide, number: index + 1 }))
    .filter(({ slide }) => String(slide?.text || "").trim())
    .map(({ slide, number }) => `### Slide ${number}${slide.name ? ` — ${slide.name}` : ""}\n\n${String(slide.text).trim()}`);
  return sections.join("\n\n");
}
