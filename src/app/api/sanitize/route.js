import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import {
  buildSanitizePrompt,
  extractEmailEntities,
  mergeSensitiveEntities,
  parseEntityList,
} from "@/lib/privacy";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock, isOpenAIModel, resolveAutoModel } from "@/lib/models";
import { applyReplacements, assignAliases } from "@/lib/sanitize";

export function prepareSanitizeScan(transcript, knownAliases = []) {
  const emailEntities = extractEmailEntities(transcript);
  const emailAliases = assignAliases(
    emailEntities,
    knownAliases.map((alias) => ({ alias }))
  ).map((entity) => ({
    original: entity.text,
    alias: entity.alias,
    restored: entity.text,
  }));
  return {
    emailEntities,
    scanText: applyReplacements(transcript, emailAliases),
    scanAliases: [...knownAliases, ...emailAliases.map((item) => item.alias)],
  };
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Untrusted request origin" },
      { status: error?.status || 403 }
    );
  }

  const body = await request.json();
  const { transcript, apiKey, openaiApiKey, model, knownAliases = [] } = body;
  const { emailEntities, scanText, scanAliases } = prepareSanitizeScan(transcript, knownAliases);

  const resolvedModel = resolveAutoModel(model, { apiKey, openaiApiKey, task: "fast" });
  const key = isOpenAIModel(resolvedModel) ? openaiApiKey || process.env.OPENAI_API_KEY : apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ entities: emailEntities, skipped: true });

  const client = createModelClient({ model, apiKey, openaiApiKey, signal: request.signal, task: "fast" });
  const prompt = buildSanitizePrompt(scanText, scanAliases);

  try {
    const msg = await client.messages.create({
      model: client.resolvedModel,
      // One JSON object per sensitive term: a real transcript can name dozens
      // of people and companies, and at the old 512 the answer was cut off
      // mid-array on anything substantial.
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = firstTextBlock(msg).trim() || "[]";
    const entities = mergeSensitiveEntities(emailEntities, parseEntityList(raw, scanAliases));
    // Say so when the answer was cut off. The salvaged terms are still real,
    // but the list is incomplete and the CSM should know before it is used as
    // a clean bill of health.
    return NextResponse.json({ entities, truncated: msg.stop_reason === "max_tokens" });
  } catch (error) {
    // A failed scan is not a clean scan. Without this the caller could not
    // tell "nothing sensitive found" from "the detector never ran".
    return NextResponse.json({
      entities: emailEntities,
      skipped: true,
      error: error?.message || "Sensitivity scan failed",
    });
  }
}
