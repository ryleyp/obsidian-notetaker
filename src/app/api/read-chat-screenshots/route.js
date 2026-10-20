import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";
import { CHAT_SYSTEM_PROMPT, chatMessageContent, validateChatPayload } from "@/lib/chatScreenshots";

// Reads Teams chat screenshots into "[time] Sender: message" text, one model
// call per screenshot, in order, so a failure on one costs only that one. Each
// call is shown the end of the transcription so far, which lets an unlabeled
// continuation inherit its sender and keeps overlapping screenshots from
// repeating messages. The images go to the model as they are — pixels cannot
// be pseudonymized — behind the same explicit approval the slide upload uses;
// the text that comes back then passes through Privacy Review like any pasted
// thread before a note prompt ever sees it.

const MAX_OUTPUT_TOKENS = 4000;

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const {
      shots = [],
      apiKey,
      openaiApiKey,
      model,
      previousText = "",
      allowUnredactedImages = false,
    } = await request.json();

    const problem = validateChatPayload(shots);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });
    if (allowUnredactedImages !== true) {
      return NextResponse.json({ error: "Review and explicitly approve chat screenshots before sending them to an AI." }, { status: 422 });
    }

    // scanText is off because the only text sent is the previous transcription,
    // which is a copy of what the approved images already show.
    const client = createModelClient({ model, apiKey, openaiApiKey, signal: request.signal, privacy: { allowImages: true, scanText: false } });
    const usage = { input_tokens: 0, output_tokens: 0 };
    const results = [];
    let transcriptSoFar = String(previousText || "");

    for (const [index, shot] of shots.entries()) {
      try {
        const msg = await client.messages.create({
          model: client.resolvedModel,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: CHAT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: chatMessageContent(shot, index, shots.length, transcriptSoFar) }],
        });
        usage.input_tokens += msg.usage?.input_tokens || 0;
        usage.output_tokens += msg.usage?.output_tokens || 0;
        const text = firstTextBlock(msg).trim();
        results.push({ id: shot.id, text, error: text ? "" : "The model returned nothing for this screenshot." });
        if (text) transcriptSoFar = `${transcriptSoFar}\n${text}`;
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        results.push({ id: shot.id, text: "", error: error?.message || "Reading this screenshot failed." });
      }
    }

    return NextResponse.json({ shots: results, usage, model: client.resolvedModel });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Reading chat screenshots failed" }, { status: error?.status || 500 });
  }
}
