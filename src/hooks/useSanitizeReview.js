"use client";

import { useState } from "react";
import {
  applyCorrections,
  applyReplacements,
  assignAliases,
  correctionFromRestoredItem,
  mergeCorrections,
} from "@/lib/sanitize";
import { aliasesFromReplacements } from "@/lib/privacy";
import { apiFetch } from "@/lib/apiClient";

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

  async function run(action, { meetingTitle, transcript, extendedTranscript, meetingContext }) {
    const savedReplacements = settings.replacements || [];
    const corrections = settings.corrections || [];
    setSanitizing(true);
    setPendingAction(action);

    const preSanitize = (text) => applyReplacements(applyCorrections(text, corrections), savedReplacements);
    const scanText = [
      preSanitize(meetingTitle),
      preSanitize(transcript),
      preSanitize(extendedTranscript),
      preSanitize(meetingContext),
    ]
      .filter((part) => part && part.trim())
      .join("\n\n");

    let newEntities = [];
    let scanSkipped = !settings.aiPrivacyScan;
    let scanError = "";
    let truncated = false;
    if (settings.aiPrivacyScan) {
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
          }),
        });
        const data = await res.json();
        if (data.skipped) scanSkipped = true;
        if (data.error) scanError = data.error;
        if (data.truncated) truncated = true;
        newEntities = data.entities || [];
      } catch (err) {
        scanSkipped = true;
        scanError = err?.message || "the scan could not be reached";
      }
    }

    setSanitizing(false);

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
    if (scanSkipped && settings.aiPrivacyScan) {
      onScanSkipped?.(scanError
        ? `Sensitivity scan did not run: ${scanError}. Names and companies were NOT checked.`
        : "Sensitivity scan skipped — set your API key in Settings to enable name/company detection.");
    } else if (truncated) {
      onScanSkipped?.("The sensitivity scan was cut off before it finished. Run it again before trusting the result.");
    }
    await runAction(action, savedReplacements);
  }

  async function confirm(confirmed, toSave) {
    let current = settings;
    const correctionsToSave = toSave.map(correctionFromRestoredItem).filter(Boolean);

    if (toSave.length > 0 || correctionsToSave.length > 0) {
      const patch = {
        replacements: [
          ...(settings.replacements || []),
          ...toSave.map((r) => ({ original: r.text, alias: r.alias, restored: r.restored || r.text })),
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
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text })),
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
