"use client";

import { useState } from "react";
import {
  applyCorrections,
  applyReplacements,
  assignAliases,
  correctionFromRestoredItem,
  mergeCorrections,
} from "@/lib/sanitize";
import { aliasesFromReplacements, knownPrivacyEntities } from "@/lib/privacy";
import { apiFetch } from "@/lib/apiClient";
import { detectAccount } from "@/lib/accounts";

function stringsIn(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

export function decoratePrivacyEntities(entities = [], sources = []) {
  return entities.map((entity) => {
    const needle = String(entity?.text || "").toLowerCase();
    if (!needle) return entity;
    for (const source of sources) {
      const text = String(source?.text || "").replace(/\s+/g, " ").trim();
      const index = text.toLowerCase().indexOf(needle);
      if (index < 0) continue;
      const start = Math.max(0, index - 55);
      const end = Math.min(text.length, index + needle.length + 55);
      return {
        ...entity,
        source: source.label,
        context: `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`,
      };
    }
    return entity;
  });
}

// The pseudonymization gate that every outbound generation passes through.
//
// Flow: pre-apply known corrections + replacements so the scan only ever sees
// already-pseudonymized text, ask Claude for entities it still recognizes,
// then either show the review card or (when nothing new was found) run the
// pending action straight away.
export function useSanitizeReview({ settings, model, applySettingsPatch, actions, onScanSkipped }) {
  const [sanitizing, setSanitizing] = useState(false);
  const [pendingReview, setPendingReview] = useState(null); // null | detected[]
  const [pendingAction, setPendingAction] = useState("generate");

  function runAction(action, replacements) {
    return action === "generate"
      ? actions.generate(replacements)
      : actions.saveTranscript(replacements);
  }

  async function run(action, {
    meetingTitle,
    transcript,
    extendedTranscript,
    meetingContext,
    selectedFolder,
    slides = [],
    existingNote,
    followUp,
  }) {
    const savedReplacements = settings.replacements || [];
    const corrections = settings.corrections || [];
    setSanitizing(true);
    setPendingAction(action);

    const preSanitize = (text) => applyReplacements(applyCorrections(text, corrections), savedReplacements);
    const selectedAccount = detectAccount(selectedFolder, settings.accounts);
    const scanSources = [
      { label: "Meeting title", text: meetingTitle },
      { label: "Transcript", text: transcript },
      { label: "Extended transcript", text: extendedTranscript },
      { label: "Context & notes", text: meetingContext },
      { label: "Vault folder", text: selectedFolder },
      { label: "Selected account", text: selectedAccount.name },
      ...(selectedAccount.aliases || []).map((text) => ({ label: "Account alias", text })),
      ...(settings.ownerNames || []).map((text) => ({ label: "Note owner", text })),
      ...stringsIn(settings.goals || []).map((text) => ({ label: "Configured goal", text })),
      ...stringsIn(followUp || {}).map((text) => ({ label: "Follow-up setting", text })),
      // Slide OCR, slide filenames, and an existing note are all included in
      // the generation prompt. They must pass through the same review as the
      // transcript instead of first being discovered by the final fail-closed
      // boundary after the user has already approved the review.
      ...slides.flatMap((slide, index) => [
        { label: `Slide ${index + 1} filename`, text: slide?.name },
        { label: `Slide ${index + 1}`, text: slide?.text },
      ]),
      { label: "Existing note", text: existingNote?.content },
    ]
      .map((source) => ({ ...source, text: preSanitize(source.text) }))
      .filter((source) => source.text && source.text.trim());
    const scanText = scanSources.map((source) => source.text).join("\n\n");

    let newEntities = [];
    let scanSkipped = false;
    let scanError = "";
    let truncated = false;
    {
      try {
        const res = await apiFetch("/api/sanitize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: scanText,
            apiKey: settings.apiKey || undefined,
            openaiApiKey: settings.openaiApiKey || undefined,
            model,
            knownAliases: aliasesFromReplacements(savedReplacements),
            knownEntities: knownPrivacyEntities(settings),
            useAiScan: settings.aiPrivacyScan,
          }),
        });
        const data = await res.json();
        if (data.skipped && settings.aiPrivacyScan) scanSkipped = true;
        if (data.error) scanError = data.error;
        if (data.truncated) truncated = true;
        newEntities = decoratePrivacyEntities(data.entities || [], scanSources);
      } catch (err) {
        scanSkipped = true;
        scanError = err?.message || "the scan could not be reached";
      }
    }

    setSanitizing(false);

    if (settings.aiPrivacyScan && (scanSkipped || truncated)) {
      onScanSkipped?.(scanError
        ? `Privacy check blocked generation because the AI detection pass failed: ${scanError}. Retry it or disable the optional AI pass to use local-only detection.`
        : "Privacy check blocked generation because the AI detection pass was incomplete. Retry it or disable the optional AI pass to use local-only detection.");
      return;
    }

    if (newEntities.length > 0) {
      // A cut-off answer still found real terms, but the list is partial —
      // say so rather than letting the review card imply it is the whole set.
      if (truncated) {
        onScanSkipped?.("The sensitivity scan found more terms than it could list at once. Review these, then run it again to catch the rest.");
      }
      setPendingReview(assignAliases(newEntities, savedReplacements));
      return;
    }

    // An empty result means "nothing sensitive found" only when the scan
    // actually ran. Anything else has to say so.
    await runAction(action, savedReplacements);
  }

  async function confirm(confirmed, toSave) {
    let current = settings;
    const correctionsToSave = toSave.map(correctionFromRestoredItem).filter(Boolean);

    if (toSave.length > 0 || correctionsToSave.length > 0) {
      const patch = {
        replacements: [
          ...(settings.replacements || []),
          ...toSave.map((r) => ({ original: r.text, alias: r.alias, restored: r.restored || r.text, type: r.type })),
        ],
        corrections: correctionsToSave.length
          ? mergeCorrections(settings.corrections || [], correctionsToSave)
          : settings.corrections || [],
      };
      current = applySettingsPatch(patch) || { ...settings, ...patch };
    }

    setPendingReview(null);

    const all = [
      ...(current.replacements || []),
      ...confirmed
        .filter((c) => !(current.replacements || []).some((r) => r.original === c.text))
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text, type: c.type })),
    ];

    await runAction(pendingAction, all);
  }

  function skip() {
    setPendingReview(null);
    return runAction(pendingAction, settings.replacements || []);
  }

  function reset() {
    setPendingReview(null);
  }

  return { sanitizing, pendingReview, pendingAction, run, confirm, skip, reset };
}
