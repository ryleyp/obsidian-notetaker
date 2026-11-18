"use client";

import { useState } from "react";
import {
  applyCorrections,
  applyReplacements,
  correctionFromRestoredItem,
  mergeCorrections,
} from "@/lib/sanitize";
import { aliasesFromReplacements, knownPrivacyEntities } from "@/lib/privacy";
import { apiFetch } from "@/lib/apiClient";
import { detectAccount } from "@/lib/accounts";
import { buildMeetingScanText } from "@/lib/meetingScan";
import { planPrivacyReview, recordPrivacyDecisions } from "@/lib/privacyDecisions";

// The pseudonymization gate that every outbound generation passes through.
//
// Flow: pre-apply known corrections + replacements so the scan only ever sees
// already-pseudonymized text, ask Claude for entities it still recognizes,
// then either show the review card or (when nothing new was found) run the
// pending action straight away.
//
// Terms decided in an earlier review are not asked about again: one remembered
// as "anonymize" is replaced for this run under a fresh random alias, one
// remembered as "not sensitive" is left alone, and only terms never seen
// before reach the card.
export function useSanitizeReview({ settings, model, applySettingsPatch, actions, onScanSkipped }) {
  const [sanitizing, setSanitizing] = useState(false);
  const [pendingReview, setPendingReview] = useState(null); // null | detected[]
  const [pendingAction, setPendingAction] = useState("generate");
  // Replacements for remembered terms, applied to this run only.
  const [pendingAuto, setPendingAuto] = useState([]);
  // { anonymized, ignored } counts for the last scan, shown to the CSM so a
  // run that skipped the card still says what was done on their behalf.
  const [remembered, setRemembered] = useState(null);

  function runAction(action, replacements) {
    return action === "generate"
      ? actions.generate(replacements)
      : actions.saveTranscript(replacements);
  }

  async function run(action, { meetingTitle, transcript, extendedTranscript, meetingContext, selectedFolder, existingNote, slides = [], followUp }) {
    const savedReplacements = settings.replacements || [];
    const corrections = settings.corrections || [];
    setSanitizing(true);
    setPendingAction(action);
    setPendingAuto([]);
    setRemembered(null);

    const selectedAccount = detectAccount(selectedFolder, settings.accounts);
    // Saving a transcript sends nothing to a model; only generation also sends
    // the existing note, slides, goals, and follow-up settings.
    const generating = action === "generate";
    const scanText = buildMeetingScanText({
      meetingTitle,
      transcript,
      extendedTranscript,
      meetingContext,
      selectedFolder,
      accountName: selectedAccount.name,
      ownerNames: settings.ownerNames || [],
      existingNote: generating ? existingNote : undefined,
      slides: generating ? slides : [],
      goals: generating ? settings.goals || [] : [],
      followUp: generating ? followUp : undefined,
      corrections,
      replacements: savedReplacements,
    });

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
        newEntities = data.entities || [];
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

    const plan = planPrivacyReview(newEntities, {
      decisions: settings.privacyDecisions,
      savedReplacements,
      knownEntities: knownPrivacyEntities(settings),
    });
    setPendingAuto(plan.autoReplacements);
    setRemembered(plan.remembered);

    if (plan.review.length > 0) {
      // A cut-off answer still found real terms, but the list is partial —
      // say so rather than letting the review card imply it is the whole set.
      if (truncated) {
        onScanSkipped?.("The sensitivity scan found more terms than it could list at once. Review these, then run it again to catch the rest.");
      }
      setPendingReview(plan.review);
      return;
    }

    // An empty result means "nothing sensitive found" only when the scan
    // actually ran. Anything else has to say so.
    await runAction(action, [...savedReplacements, ...plan.autoReplacements]);
  }

  async function confirm(confirmed, toSave, review = {}) {
    let current = settings;
    const correctionsToSave = toSave.map(correctionFromRestoredItem).filter(Boolean);
    const reviewed = review?.remember ? review.reviewed || [] : [];
    const decisions = reviewed.length
      ? recordPrivacyDecisions(settings.privacyDecisions, reviewed, { knownEntities: knownPrivacyEntities(settings) })
      : null;

    if (toSave.length > 0 || correctionsToSave.length > 0 || decisions) {
      const patch = {
        replacements: [
          ...(settings.replacements || []),
          ...toSave.map((r) => ({ original: r.text, alias: r.alias, restored: r.restored || r.text, type: r.type })),
        ],
        corrections: correctionsToSave.length
          ? mergeCorrections(settings.corrections || [], correctionsToSave)
          : settings.corrections || [],
        ...(decisions ? { privacyDecisions: decisions } : {}),
      };
      current = applySettingsPatch(patch) || { ...settings, ...patch };
    }

    setPendingReview(null);

    const all = [
      ...(current.replacements || []),
      ...pendingAuto,
      ...confirmed
        .filter((c) => !(current.replacements || []).some((r) => r.original === c.text))
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text, type: c.type })),
    ];

    await runAction(pendingAction, all);
  }

  // Bypass covers the terms on the card only. Terms already remembered as
  // "anonymize" were never offered for bypass, so they stay anonymized.
  function skip() {
    setPendingReview(null);
    return runAction(pendingAction, [...(settings.replacements || []), ...pendingAuto]);
  }

  function reset() {
    setPendingReview(null);
    setPendingAuto([]);
    setRemembered(null);
  }

  return { sanitizing, pendingReview, pendingAction, remembered, run, confirm, skip, reset };
}
