"use client";

import { useEffect, useRef, useState } from "react";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { alternateModel, calcCost, providerLabel, resolveAutoModel } from "@/lib/models";
import { detectAccount, suggestAgreements } from "@/lib/accounts";
import { buildSourceBundle, formatTranscriptArchive, mapSourceBundle } from "@/lib/sourceBundle";
import { splitGeneratedFollowUp } from "@/lib/followUpDraft";
import { apiFetch } from "@/lib/apiClient";
import { replaceNoteSection } from "@/lib/noteSections";

// Reads an SSE body of {type: delta|done|error} events, invoking onDelta with
// the running text. Returns the final usage payload. Shared by generate and
// regenerate, which previously carried near-identical copies of this loop.
async function consumeStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";
  let usage = null;
  let responseModel = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop();
    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      const evt = JSON.parse(part.slice(6));
      if (evt.type === "delta") {
        accumulated += evt.text;
        onDelta(accumulated);
      } else if (evt.type === "done") {
        usage = evt.usage;
        responseModel = evt.model || null;
      } else if (evt.type === "error") {
        throw new Error(evt.message);
      }
    }
  }
  return { accumulated, usage, model: responseModel };
}

// Owns the generated note and everything that produces or revises it:
// initial generation, regeneration with an instruction, and the follow-up
// email draft.
export function useNoteGeneration({ settings, model, meeting }) {
  const selectedPrimaryModel = resolveAutoModel(model, { apiKey: settings.apiKey, openaiApiKey: settings.openaiApiKey });
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [notes, setNotes] = useState("");
  const [noteCost, setNoteCost] = useState(null);
  const [sourceBundle, setSourceBundle] = useState(null);
  const [activeReplacements, setActiveReplacements] = useState([]);
  const [lastGenerationRequest, setLastGenerationRequest] = useState(null);
  const [alternative, setAlternative] = useState(null);
  const [alternativeLoading, setAlternativeLoading] = useState(false);
  const [alternativeError, setAlternativeError] = useState(null);
  const [revisionHistory, setRevisionHistory] = useState([]);
  const [draftHistory, setDraftHistory] = useState([]);
  const [historyReady, setHistoryReady] = useState(false);

  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState(null);

  const [followUpDraft, setFollowUpDraft] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState(null);
  const [followUpCost, setFollowUpCost] = useState(null);
  const [followUpSaving, setFollowUpSaving] = useState(false);
  const [followUpSavedPath, setFollowUpSavedPath] = useState("");
  const [followUpSaveError, setFollowUpSaveError] = useState(null);

  const controllerRef = useRef(null);
  const manualEditRef = useRef({ timer: null, active: false });

  useEffect(() => () => clearTimeout(manualEditRef.current.timer), []);
  useEffect(() => {
    try { setDraftHistory(JSON.parse(localStorage.getItem("note:draft-history") || "[]")); } catch { setDraftHistory([]); }
    setHistoryReady(true);
  }, []);
  useEffect(() => {
    if (!historyReady) return;
    try { localStorage.setItem("note:draft-history", JSON.stringify(draftHistory.slice(0, 15))); } catch {}
  }, [draftHistory, historyReady]);

  function recordDraft(content, metadata = {}) {
    if (!content?.trim()) return;
    const entry = {
      id: `${Date.now()}-${Math.random()}`,
      content,
      label: metadata.label || "Draft",
      model: metadata.model || model,
      cost: metadata.cost || null,
      sourceCount: metadata.sourceCount ?? 0,
      meetingTitle: metadata.meetingTitle || meeting.meetingTitle || "Untitled meeting",
      folder: metadata.folder ?? meeting.selectedFolder ?? "",
      ts: Date.now(),
    };
    setDraftHistory((previous) => [entry, ...previous.filter((item) => item.content !== content)].slice(0, 15));
  }

  function checkpoint(content = notes) {
    if (content?.trim()) setRevisionHistory((previous) => [...previous, content].slice(-15));
  }

  function clearFollowUp() {
    setFollowUpDraft("");
    setFollowUpError(null);
    setFollowUpCost(null);
    setFollowUpSaving(false);
    setFollowUpSavedPath("");
    setFollowUpSaveError(null);
  }

  function sanitizer(replacements) {
    const corrections = settings.corrections || [];
    return (text) => {
      const corrected = applyCorrections(text || "", corrections);
      return replacements.length ? applyReplacements(corrected, replacements) : corrected;
    };
  }

  async function streamGenerateRequest(requestConfig, { onSaved } = {}) {
    const { payload, replacements, displaySourceBundle } = requestConfig;
    const requestModel = payload.model || model;
    const controller = new AbortController();
    controllerRef.current = controller;

    setLastGenerationRequest(requestConfig);
    setSourceBundle(displaySourceBundle || payload.sourceBundle || null);
    setProcessing(true);
    setProcessError(null);
    setRegenerateError(null);
    setNotes("");
    setNoteCost(null);
    clearFollowUp();
    onSaved?.();

    try {
      const res = await apiFetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Processing failed");
      }

      const { accumulated, usage, model: completedModel } = await consumeStream(res, setNotes);
      const usedModel = completedModel || requestModel;
      const cost = usage ? calcCost(usage, usedModel) : null;
      if (cost) setNoteCost(cost);
      const restoredOutput = replacements.length
        ? reverseReplacements(accumulated, replacements)
        : accumulated;
      const separated = splitGeneratedFollowUp(restoredOutput);
      setNotes(separated.notes);
      recordDraft(separated.notes, {
        label: `${providerLabel(usedModel)} primary draft`,
        model: usedModel,
        cost,
        sourceCount: displaySourceBundle?.allSources?.length || payload.sourceBundle?.allSources?.length || 0,
      });
      if (separated.followUpDraft) {
        setFollowUpDraft(separated.followUpDraft);
        if (payload.followUp?.enabled) {
          await saveFollowUpDraft(separated.followUpDraft);
        }
      } else if (payload.followUp?.enabled) {
        setFollowUpSaveError(`${providerLabel(requestModel)} did not return a separate follow-up draft. You can draft one from the summary screen.`);
      }

      if (settings.transcriptsPath) {
        const { transcript, extendedTranscript, meetingTitle, selectedFolder } = meeting;
        const archiveTranscript = formatTranscriptArchive(transcript, extendedTranscript);
        const correctedTranscript = replacements.length
          ? reverseReplacements(applyReplacements(archiveTranscript, replacements), replacements)
          : archiveTranscript;
        apiFetch("/api/save-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: correctedTranscript,
            meetingTitle,
            transcriptsPath: settings.transcriptsPath,
            folder: selectedFolder || undefined,
            accounts: settings.accounts || [],
          }),
        }).catch(() => {});
      }
      return separated.notes;
    } catch (e) {
      setProcessError(e.name === "AbortError" ? "Generation canceled." : e.message);
      return null;
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setProcessing(false);
    }
  }

  async function generate(replacements, { onSaved, runMode = "quick", reviewModel } = {}) {
    setActiveReplacements(replacements);
    setAlternative(null);
    setAlternativeError(null);
    setRevisionHistory([]);
    const { transcript, extendedTranscript, meetingTitle, meetingContext, selectedFolder, existingNote, slides = [] } = meeting;
    const sanitize = sanitizer(replacements);

    const sanitizedTranscript = sanitize(transcript);
    const sanitizedExtendedTranscript = sanitize(extendedTranscript);
    const sanitizedTitle = sanitize(meetingTitle);
    const sanitizedContext = sanitize(meetingContext);
    const sanitizedExistingNote = sanitize(existingNote?.content || "");
    // Every slide keeps its position so [S#] matches the thumbnail the CSM
    // sees; one that was not read contributes no text and leaves a gap. The
    // text is pseudonymized here exactly like a transcript, and the images
    // themselves never go to this call.
    const sanitizedSlides = slides.map((slide) => ({
      name: slide.name,
      text: slide.status === "done" ? sanitize(slide.text || "") : "",
    }));

    const promptSourceBundle = buildSourceBundle({
      transcript: sanitizedTranscript,
      extendedTranscript: sanitizedExtendedTranscript,
      rawNotes: sanitizedContext,
      slides: sanitizedSlides,
      existingNote: sanitizedExistingNote,
    });
    const displaySourceBundle = replacements.length
      ? mapSourceBundle(promptSourceBundle, (content) => reverseReplacements(content, replacements))
      : promptSourceBundle;

    // Match this account's EA/EP numbers against the raw transcript by keyword.
    // Done on the original text (not the pseudonymized copy) so matching is exact.
    const acct = detectAccount(selectedFolder, settings.accounts);
    const account = (settings.accounts || []).find((a) => a.name === acct.name);
    const agreementText = [transcript, extendedTranscript].filter(Boolean).join("\n\n");
    const suggestedAgreements = account ? suggestAgreements(agreementText, account) : [];

    const requestConfig = {
      payload: {
        transcript: sanitizedTranscript,
        meetingContext: sanitizedContext,
        meetingTitle: sanitizedTitle,
        apiKey: settings.apiKey || undefined,
        openaiApiKey: settings.openaiApiKey || undefined,
        model,
        suggestedAgreements,
        sourceBundle: promptSourceBundle,
        accounts: settings.accounts || [],
        ownerNames: settings.ownerNames || [],
        ownerPronouns: settings.ownerPronouns || "",
        goals: settings.goals || [],
        followUp: meeting.followUp || { enabled: false },
      },
      replacements,
      displaySourceBundle,
    };
    const primary = await streamGenerateRequest(requestConfig, { onSaved });
    if (!primary) return;
    // reviewModel is the CSM's explicit choice from RunModePicker; fall back
    // to the usual alternate provider only if a caller doesn't supply one.
    const chosenReviewModel = reviewModel || alternateModel(selectedPrimaryModel);
    if (runMode === "compare") {
      await generateAlternative("independent", chosenReviewModel, primary, requestConfig);
    } else if (runMode === "second-opinion") {
      await generateAlternative("review", chosenReviewModel, primary, requestConfig);
    }
  }

  async function generateAlternative(kind = "independent", overrideModel = alternateModel(selectedPrimaryModel), baseNotes = notes, requestConfig = lastGenerationRequest) {
    if (alternativeLoading || !requestConfig) return;
    const replacements = requestConfig.replacements || activeReplacements || [];
    const restore = (text) => (replacements.length ? reverseReplacements(text, replacements) : text);
    const sourceCount = requestConfig.displaySourceBundle?.allSources?.length || requestConfig.payload?.sourceBundle?.allSources?.length || 0;
    setAlternativeLoading(true);
    setAlternativeError(null);
    try {
      const independent = kind === "independent";
      const response = await apiFetch(independent ? "/api/process" : "/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(independent ? {
          ...requestConfig.payload,
          model: overrideModel,
          followUp: { enabled: false },
        } : {
          notes: replacements.length ? applyReplacements(baseNotes, replacements) : baseNotes,
          instruction: "Create a source-backed second opinion. Keep exactly the same Markdown headings, section order, citation style, and SFDC Activity Entry format. Correct only claims the provided sources support, preserve useful detail, and do not invent facts.",
          meetingTitle: requestConfig.payload.meetingTitle,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          model: overrideModel,
          sourceBundle: requestConfig.payload.sourceBundle || null,
        }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Alternative draft failed");
      }
      const { accumulated, usage, model: completedModel } = await consumeStream(response, () => {});
      const content = splitGeneratedFollowUp(restore(accumulated)).notes;
      const usedModel = completedModel || overrideModel;
      const cost = usage ? calcCost(usage, usedModel) : null;
      const result = { content, model: usedModel, kind, cost, baseContent: baseNotes, sourceCount };
      setAlternative(result);
      recordDraft(content, { label: `${providerLabel(usedModel)} ${independent ? "independent draft" : "second opinion"}`, model: usedModel, cost, sourceCount });
      return result;
    } catch (error) {
      setAlternativeError(error.message);
      return null;
    } finally {
      setAlternativeLoading(false);
    }
  }

  function applyAlternative(sectionKey = null, { onSaved } = {}) {
    if (!alternative?.content) return;
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    checkpoint(notes);
    const next = sectionKey ? replaceNoteSection(notes, alternative.content, sectionKey) : alternative.content;
    setNotes(next);
    recordDraft(next, { label: sectionKey ? `Accepted ${sectionKey} section` : "Accepted alternative", model: alternative.model, cost: alternative.cost, sourceCount: alternative.sourceCount });
    clearFollowUp();
    onSaved?.();
  }

  function editNotes(next, { onSaved } = {}) {
    if (next === notes) return;
    if (!manualEditRef.current.active) {
      checkpoint(notes);
      manualEditRef.current.active = true;
    }
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.timer = setTimeout(() => {
      manualEditRef.current.active = false;
      recordDraft(next, { label: "Manual edit", sourceCount: sourceBundle?.allSources?.length || 0 });
    }, 800);
    setNotes(next);
    clearFollowUp();
    onSaved?.();
  }

  function undo({ onSaved } = {}) {
    if (!revisionHistory.length) return;
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    const previous = revisionHistory[revisionHistory.length - 1];
    setRevisionHistory((history) => history.slice(0, -1));
    setNotes(previous);
    recordDraft(previous, { label: "Undo", sourceCount: sourceBundle?.allSources?.length || 0 });
    clearFollowUp();
    onSaved?.();
  }

  function restoreDraft(entry, { onSaved } = {}) {
    if (!entry?.content || entry.content === notes) return;
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    checkpoint(notes);
    setNotes(entry.content);
    recordDraft(entry.content, { ...entry, label: `Restored: ${entry.label}` });
    clearFollowUp();
    onSaved?.();
  }

  async function regenerate(instruction, { onSaved, model: overrideModel } = {}) {
    const requestModel = overrideModel || model;
    if (!notes.trim()) return;
    const replacements = activeReplacements || [];
    const sanitize = sanitizer(replacements);
    const sanitizedNotes = replacements.length ? applyReplacements(notes, replacements) : notes;

    setRegenerating(true);
    setRegenerateError(null);
    setProcessError(null);
    clearFollowUp();
    onSaved?.();

    try {
      const res = await apiFetch("/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: sanitizedNotes,
          instruction: sanitize(instruction),
          meetingTitle: sanitize(meeting.meetingTitle),
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          model: requestModel,
          sourceBundle: lastGenerationRequest?.payload?.sourceBundle || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Regeneration failed");
      }

      const restore = (text) => (replacements.length ? reverseReplacements(text, replacements) : text);
      const { accumulated, usage, model: completedModel } = await consumeStream(res, () => {});
      const usedModel = completedModel || requestModel;
      const cost = usage ? calcCost(usage, usedModel) : null;
      if (cost) setNoteCost(cost);
      const revised = restore(accumulated);
      checkpoint(notes);
      setNotes(revised);
      recordDraft(revised, { label: `${providerLabel(usedModel)} revision`, model: usedModel, cost, sourceCount: sourceBundle?.allSources?.length || 0 });
    } catch (e) {
      setRegenerateError(e.message);
    } finally {
      setRegenerating(false);
    }
  }

  async function generateFollowUp({ audience, tone, instructions }) {
    if (!notes.trim()) return;
    const replacements = activeReplacements || [];
    const sanitize = sanitizer(replacements);
    const sanitizedNotes = replacements.length ? applyReplacements(notes, replacements) : notes;

    setFollowUpLoading(true);
    setFollowUpError(null);
    setFollowUpDraft("");
    setFollowUpCost(null);
    setFollowUpSavedPath("");
    setFollowUpSaveError(null);
    try {
      const res = await apiFetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: sanitizedNotes,
          meetingTitle: sanitize(meeting.meetingTitle),
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          model,
          audience,
          tone,
          instructions: sanitize(instructions || ""),
          sourceBundle: lastGenerationRequest?.payload?.sourceBundle || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Follow-up draft failed");
      setFollowUpDraft(replacements.length ? reverseReplacements(data.draft, replacements) : data.draft);
      if (data.usage) setFollowUpCost(calcCost(data.usage, data.model || model));
    } catch (e) {
      setFollowUpError(e.message);
    } finally {
      setFollowUpLoading(false);
    }
  }

  async function saveFollowUpDraft(draft) {
    if (!draft.trim()) return;
    if (!settings.vaultPath) {
      setFollowUpSaveError("Configure your Obsidian vault path in Settings first.");
      return;
    }

    setFollowUpSaving(true);
    setFollowUpSaveError(null);
    try {
      const res = await apiFetch("/api/save-follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft,
          meetingTitle: meeting.meetingTitle || "Meeting",
          vaultPath: settings.vaultPath,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Follow-up email save failed");
      setFollowUpSavedPath(data.savedPath);
    } catch (e) {
      setFollowUpSaveError(e.message);
    } finally {
      setFollowUpSaving(false);
    }
  }

  function saveFollowUp() {
    return saveFollowUpDraft(followUpDraft);
  }

  function cancel() {
    controllerRef.current?.abort();
  }

  function retry({ onSaved } = {}) {
    if (lastGenerationRequest) streamGenerateRequest(lastGenerationRequest, { onSaved });
  }

  function reset() {
    clearTimeout(manualEditRef.current.timer);
    manualEditRef.current.active = false;
    setNotes("");
    setNoteCost(null);
    setProcessError(null);
    setRegenerateError(null);
    setActiveReplacements([]);
    setLastGenerationRequest(null);
    setSourceBundle(null);
    setAlternative(null);
    setAlternativeError(null);
    setRevisionHistory([]);
    clearFollowUp();
  }

  return {
    notes,
    setNotes,
    editNotes,
    processing,
    processError,
    setProcessError,
    noteCost,
    sourceBundle,
    alternative,
    alternativeLoading,
    alternativeError,
    revisionHistory,
    draftHistory,
    activeReplacements,
    regenerating,
    regenerateError,
    followUpDraft,
    followUpLoading,
    followUpError,
    followUpCost,
    followUpSaving,
    followUpSavedPath,
    followUpSaveError,
    clearFollowUp,
    generate,
    regenerate,
    generateAlternative,
    applyAlternative,
    undo,
    restoreDraft,
    generateFollowUp,
    saveFollowUp,
    cancel,
    retry,
    reset,
  };
}
