import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";
import { SLIDE_SYSTEM_PROMPT, slideMessageContent, validateSlidePayload } from "@/lib/slides";

// Reads slide screenshots into text, one model call per slide, so a failure
// on slide 7 costs slide 7 and nothing else. The images go to the model as
// they are — pixels cannot be pseudonymized — which the upload panel says
// plainly; the text that comes back then goes through the same privacy
// replacements as a transcript before the note prompt ever sees it.

const MAX_OUTPUT_TOKENS = 3000;

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const { slides = [], apiKey, openaiApiKey, model } = await request.json();

    const problem = validateSlidePayload(slides);
    if (problem) return NextResponse.json({ error: problem }, { status: 400 });

    const client = createModelClient({ model, apiKey, openaiApiKey, signal: request.signal });
    const usage = { input_tokens: 0, output_tokens: 0 };
    const results = [];

    for (const [index, slide] of slides.entries()) {
      try {
        const msg = await client.messages.create({
          model: client.resolvedModel,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: SLIDE_SYSTEM_PROMPT,
          messages: [{ role: "user", content: slideMessageContent(slide, index, slides.length) }],
        });
        usage.input_tokens += msg.usage?.input_tokens || 0;
        usage.output_tokens += msg.usage?.output_tokens || 0;
        const text = firstTextBlock(msg).trim();
        results.push({ id: slide.id, text, error: text ? "" : "The model returned nothing for this slide." });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        results.push({ id: slide.id, text: "", error: error?.message || "Reading this slide failed." });
      }
    }

    return NextResponse.json({ slides: results, usage, model: client.resolvedModel });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Reading slides failed" }, { status: error?.status || 500 });
  }
}
