import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  buildSanitizePrompt,
  extractEmailEntities,
  mergeSensitiveEntities,
  parseEntityList,
} from "@/lib/privacy";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";
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
  const { transcript, apiKey, knownAliases = [] } = body;
  const { emailEntities, scanText, scanAliases } = prepareSanitizeScan(transcript, knownAliases);

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ entities: emailEntities, skipped: true });

  const client = new Anthropic({ apiKey: key });
  const prompt = buildSanitizePrompt(scanText, scanAliases);

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = firstTextBlock(msg).trim() || "[]";
    const entities = mergeSensitiveEntities(emailEntities, parseEntityList(raw, scanAliases));
    return NextResponse.json({ entities });
  } catch {
    return NextResponse.json({ entities: emailEntities });
  }
}
