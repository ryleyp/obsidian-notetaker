import { NextResponse } from "next/server";
import { createModelClient } from "@/lib/modelClient";
import {
  buildSanitizePrompt,
  extractKnownSensitiveEntities,
  extractLocalSensitiveEntities,
  mergeSensitiveEntities,
  parseEntityList,
} from "@/lib/privacy";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock, isOpenAIModel, resolveAutoModel } from "@/lib/models";
import { applyReplacements, assignAliases } from "@/lib/sanitize";
import { extractLocalNerEntities } from "@/lib/localNer";

export function prepareSanitizeScan(transcript, knownAliases = [], knownEntities = []) {
  const localEntities = mergeSensitiveEntities(
    extractLocalSensitiveEntities(transcript),
    extractLocalNerEntities(transcript),
    extractKnownSensitiveEntities(transcript, knownEntities)
  );
  const localAliases = assignAliases(
    localEntities,
    knownAliases.map((alias) => ({ alias }))
  ).map((entity) => ({
    original: entity.text,
    alias: entity.alias,
    restored: entity.text,
  }));
  return {
    localEntities,
    // Kept for compatibility with older callers/tests that only knew about
    // the email-only local pass.
    emailEntities: localEntities.filter((entity) => entity.type === "email"),
    scanText: applyReplacements(transcript, localAliases),
    scanAliases: [...knownAliases, ...localAliases.map((item) => item.alias)],
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
  const { transcript, apiKey, openaiApiKey, model, knownAliases = [], knownEntities = [], useAiScan = true } = body;
  const { localEntities, scanText, scanAliases } = prepareSanitizeScan(transcript, knownAliases, knownEntities);

  if (!useAiScan) {
    return NextResponse.json({ entities: localEntities, aiSkipped: true });
  }

  const resolvedModel = resolveAutoModel(model, { apiKey, openaiApiKey, task: "fast" });
  const key = isOpenAIModel(resolvedModel) ? openaiApiKey || process.env.OPENAI_API_KEY : apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ entities: localEntities, skipped: true, aiSkipped: true });

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
    const entities = mergeSensitiveEntities(localEntities, parseEntityList(raw, scanAliases));
    // Say so when the answer was cut off. The salvaged terms are still real,
    // but the list is incomplete and the CSM should know before it is used as
    // a clean bill of health.
    return NextResponse.json({ entities, truncated: msg.stop_reason === "max_tokens" });
  } catch (error) {
    // A failed scan is not a clean scan. Without this the caller could not
    // tell "nothing sensitive found" from "the detector never ran".
    return NextResponse.json({
      entities: localEntities,
      skipped: true,
      aiSkipped: true,
      error: error?.message || "Sensitivity scan failed",
    });
  }
}
