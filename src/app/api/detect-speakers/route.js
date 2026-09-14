import { createModelClient } from "@/lib/modelClient";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { FAST_MODEL, firstTextBlock, maxOutputTokens } from "@/lib/models";
import { buildLabeledTranscript } from "@/lib/speakers";
import {
  assembleTurns,
  formatSegmentsForPrompt,
  parseBoundaries,
  splitIntoSegments,
} from "@/lib/transcriptSegments";

const SYSTEM_PROMPT = `You segment raw, undifferentiated meeting transcripts into speaker turns by inferring shifts in who is speaking from conversational context. You have no audio and no ground truth — you are making an informed best-effort guess. You never rewrite the transcript: you only report the numbered segment where each speaker turn begins. Output ONLY those lines — no preamble, no commentary, no explanation.`;

export function buildPrompt(segments) {
  return `This is a raw meeting transcript with no speaker labels — it was transcribed via on-device dictation, so if multiple people were talking, their speech was merged into one continuous stream with no indication of who said what. It has been split into numbered segments below.

TASK: Decide where each speaker turn BEGINS. Use conversational cues such as:
- Question-and-answer exchanges (the question and its answer are usually different speakers)
- Direct address ("David, what do you think about...")
- A statement that directly responds to, agrees with, or contradicts the immediately preceding statement
- Self-identification (someone stating their own name, e.g. "this is Sarah" or "it's me, John")
- A change in role or perspective (e.g. one person reporting status, another asking a follow-up question)
- Short backchannel responses ("Right, right", "yeah exactly", "got it") that suggest a brief turn from a different speaker

Be conservative — if a shift is not reasonably clear from these cues, do not start a new turn there. Do not assume a fixed number of speakers; infer as many as the evidence clearly supports, but do not over-segment. Segment breaks are mechanical, so a single speaker usually spans several consecutive segments.

RULES:
1. Label speakers generically as "Speaker 1", "Speaker 2", etc., in order of first appearance — UNLESS a speaker states or is unambiguously identified by their own real name in a way that clearly marks them as the one currently speaking, in which case use that name consistently for that person for the rest of the transcript.
2. Report only the FIRST segment number of each turn, in ascending order. A turn runs until the next one starts, so never repeat a number and never mark an end.
3. The first line must start at segment 1.
4. Do not reproduce, quote, summarize, or correct any transcript text.

OUTPUT FORMAT — one line per speaker turn and nothing else:
<segment number>: <speaker label>

Example of the required output shape:
1: Speaker 1
4: Speaker 2
9: Speaker 1

SEGMENTS:
${formatSegmentsForPrompt(segments)}`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { transcript, apiKey, openaiApiKey, model } = body;

    if (!transcript || !transcript.trim()) {
      return new Response(JSON.stringify({ error: "Transcript is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const segments = splitIntoSegments(transcript);
    const client = createModelClient({ model: model || FAST_MODEL, apiKey, openaiApiKey, signal: request.signal, task: "fast" });
    const selectedModel = client.resolvedModel;
    const msg = await client.messages.create({
      model: selectedModel,
      // One short line per turn; a turn per segment is the worst case.
      max_tokens: Math.min(maxOutputTokens(selectedModel), 512 + segments.length * 12),
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(segments) }],
    });

    const boundaries = parseBoundaries(firstTextBlock(msg), segments.length);
    const segmented = buildLabeledTranscript(assembleTurns(segments, boundaries));

    return new Response(JSON.stringify({ segmented, usage: msg.usage, model: selectedModel }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Speaker detection failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
