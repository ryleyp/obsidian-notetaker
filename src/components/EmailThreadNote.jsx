"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FolderSelector from "@/components/FolderSelector";
import ChatScreenshotUpload from "@/components/ChatScreenshotUpload";
import ModelPicker from "@/components/ModelPicker";
import SanitizeReview from "@/components/SanitizeReview";
import RememberedPrivacyNote from "@/components/RememberedPrivacyNote";
import { planPrivacyReview, recordPrivacyDecisions } from "@/lib/privacyDecisions";
import {
  applyCorrections,
  applyReplacements,
  correctionFromRestoredItem,
  mergeCorrections,
  reverseReplacements,
} from "@/lib/sanitize";
import { aliasesFromReplacements, extractEmailEntities, knownPrivacyEntities, mergeSensitiveEntities, privacyTermsFromReplacements } from "@/lib/privacy";
import { buildSourceBundle, formatEmailArchive, mapSourceBundle } from "@/lib/sourceBundle";
import { isoDateDaysAgo, latestEmailResponseDate } from "@/lib/emailDates";
import { buildThreadScanText } from "@/lib/threadScan";
import { appendToThread } from "@/lib/chatScreenshots";
import { apiFetch } from "@/lib/apiClient";
import { stripThreadNoise } from "@/lib/emailThreads";
import { FAST_MODEL, calcCost, formatCost } from "@/lib/models";
import { accountForEmailDomains, detectAccount, folderForAccount, matchVaultFolder } from "@/lib/accounts";
import { closeTodoistTasks, completeTodoistTasks, previewTodoistCompletions, pushTodoistTasks, todoistConfigured, todoistLabelForNote } from "@/lib/todoist";
import { parseResponseNeeded } from "@/lib/emailFollowUp";
import { defaultReplyAudience, splitReplyDraft } from "@/lib/replyDraft";

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// The kind label is part of the note's filename identity: email and Teams
// notes live side by side, so a Teams chat never updates an email note (or
// vice versa) just because the titles match.
function filenameTitle(threadDate, threadTitle, kindLabel = "Email") {
  const title = threadTitle.trim() || `${kindLabel} Thread`;
  return `${threadDate || todayIso()} - ${kindLabel} - ${title}`;
}

function inferTitleFromThread(text) {
  const subject = text.match(/^subject:\s*(.+)$/im)?.[1]?.trim();
  if (!subject) return "";
  // Clients stack "RE: RE: FW:" and gateways prepend "[EXTERNAL]"; strip them
  // all so every paste of the same thread infers the same title — and the
  // file it saves to is named for the conversation, not its dressing.
  return stripThreadNoise(subject);
}

export default function EmailThreadNote({ settings, onSettingsPatch, onSettingsClick, variant = "email" }) {
  const isTeams = variant === "teams";
  const kindLabel = isTeams ? "Teams" : "Email";
  const defaultTitle = `${kindLabel} Thread`;
  const [threadTitle, setThreadTitle] = useState("");
  const [threadDate, setThreadDate] = useState(todayIso());
  // Once a Teams date is typed or picked, text that arrives later (a paste, a
  // screenshot read) must not silently overwrite it.
  const dateIsManualRef = useRef(false);
  const [threadContext, setThreadContext] = useState("");
  const [threadParticipants, setThreadParticipants] = useState("");
  const [emailThread, setEmailThread] = useState("");
  // The latest thread text, for screenshot results that arrive after a render.
  const threadRef = useRef("");
  useEffect(() => { threadRef.current = emailThread; }, [emailThread]);
  const [selectedFolder, setSelectedFolder] = useState("");
  // Mounted only when the Email tab opens, so saved settings have hydrated:
  // the default model applies here the same as on every other tab.
  const [model, setModel] = useState(settings.model || FAST_MODEL);
  const [pendingReview, setPendingReview] = useState(null);
  // Replacements for terms decided in an earlier review, for this run only,
  // and the counts shown beside them.
  const [pendingAuto, setPendingAuto] = useState([]);
  const [remembered, setRemembered] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [sfdcReportPath, setSfdcReportPath] = useState("");
  const [sfdcReportUpdated, setSfdcReportUpdated] = useState(false);
  const [sfdcReportError, setSfdcReportError] = useState("");
  const [customerFactsPath, setCustomerFactsPath] = useState("");
  // Where the raw thread and context were archived, alongside the meeting
  // transcripts, so the sources behind a note are kept out of the vault.
  const [archivedPath, setArchivedPath] = useState("");
  const [updatedExisting, setUpdatedExisting] = useState(false);
  const [existingNote, setExistingNote] = useState(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [todoistResult, setTodoistResult] = useState(null);
  // Open Todoist tasks this thread appears to settle, for the CSM to approve.
  const [todoistCompletions, setTodoistCompletions] = useState(null);
  const [closingTodoist, setClosingTodoist] = useState(false);
  const [autoPickedFolder, setAutoPickedFolder] = useState(false);
  const [cost, setCost] = useState(null);
  // Set when the server swapped leftover email addresses for placeholders.
  const [privacyRepairs, setPrivacyRepairs] = useState(null);
  // The reply the CSM owes on this thread, drafted from the thread, its note,
  // and the account's recent notes.
  const draftReplies = settings.draftReplies !== false;
  const [replyVerdict, setReplyVerdict] = useState(null);
  const [replyDraft, setReplyDraft] = useState("");
  const [replyLoading, setReplyLoading] = useState(false);
  const [replyError, setReplyError] = useState(null);
  const [replyCost, setReplyCost] = useState(null);
  const [replySaving, setReplySaving] = useState(false);
  const [replySavedPath, setReplySavedPath] = useState("");
  const [replyCopied, setReplyCopied] = useState(false);
  const [replyAudience, setReplyAudience] = useState(defaultReplyAudience(variant));
  const [replyTone, setReplyTone] = useState("warm-professional");
  const [replyInstructions, setReplyInstructions] = useState("");
  const [replyContextSources, setReplyContextSources] = useState([]);
  // The account digest read for this run, and the anonymized inputs the note
  // was generated from, kept so a redraft sends exactly what was reviewed.
  const accountContextRef = useRef({ context: "", sources: [] });
  const replyInputsRef = useRef(null);
  // Bumped whenever the thread changes, so a draft still in flight for the
  // previous thread is dropped instead of landing under the new one.
  const replyRunRef = useRef(0);

  const wordCount = emailThread.trim() ? emailThread.trim().split(/\s+/).length : 0;
  const canCreate = emailThread.trim() && !processing && !saving;

  async function closeProposedTodoistTasks(taskIds) {
    if (!taskIds?.length || closingTodoist) return;
    setClosingTodoist(true);
    try {
      const result = await closeTodoistTasks(apiFetch, settings, taskIds);
      setTodoistCompletions((previous) => previous && {
        ...previous,
        proposals: previous.proposals.filter((item) => !taskIds.includes(item.id)),
        closed: (previous.closed || 0) + (result?.closed || 0),
      });
    } catch (e) {
      setTodoistCompletions((previous) => previous && { ...previous, error: e.message });
    } finally {
      setClosingTodoist(false);
    }
  }

  function clearReply() {
    replyRunRef.current += 1;
    replyInputsRef.current = null;
    setReplyVerdict(null);
    setReplyDraft("");
    setReplyLoading(false);
    setReplyError(null);
    setReplyCost(null);
    setReplySavedPath("");
    setReplyCopied(false);
    setReplyContextSources([]);
  }

  // The folder this thread's note is saved to: an existing thread stays where
  // it already lives, even when a different folder is selected.
  function targetFolder() {
    return updateExisting && existingNote ? existingNote.folder ?? selectedFolder : selectedFolder;
  }

  // A digest of the account's recent notes for the reply. Best-effort: a reply
  // drafted from the thread alone is still useful.
  async function loadAccountContext() {
    const empty = { context: "", sources: [] };
    const folder = targetFolder();
    if (!draftReplies || !settings.vaultPath || !folder) return empty;
    try {
      const params = new URLSearchParams({
        vaultPath: settings.vaultPath,
        folderPath: folder,
        threadTitle: applyCorrections(threadTitle, settings.corrections || []).trim(),
      });
      const res = await apiFetch(`/api/account-context?${params}`);
      const data = await res.json();
      if (!res.ok) return empty;
      return { context: data.context || "", sources: data.sources || [] };
    } catch {
      return empty;
    }
  }

  async function requestReply({ reason, instructions = "", previousDraft = "" } = {}) {
    const inputs = replyInputsRef.current;
    if (!inputs || replyLoading) return;
    const run = replyRunRef.current;
    const { replacements } = inputs;
    const anonymize = (text) => {
      const corrected = applyCorrections(String(text || ""), settings.corrections || []);
      return replacements.length ? applyReplacements(corrected, replacements) : corrected;
    };

    setReplyLoading(true);
    setReplyError(null);
    setReplySavedPath("");
    setReplyCopied(false);
    try {
      const res = await apiFetch("/api/draft-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread: inputs.thread,
          note: inputs.note,
          context: inputs.context,
          accountContext: inputs.accountContext,
          threadTitle: inputs.title,
          threadKind: variant,
          ownerNames: inputs.ownerNames,
          reason: reason ?? inputs.reason,
          audience: replyAudience,
          tone: replyTone,
          instructions: anonymize(instructions),
          previousDraft: anonymize(previousDraft),
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          model,
          privacyTerms: privacyTermsFromReplacements(replacements),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reply draft failed");
      if (run !== replyRunRef.current) return;
      setReplyDraft(replacements.length ? reverseReplacements(data.draft, replacements) : data.draft);
      setReplyContextSources(inputs.accountContext ? inputs.accountSources : []);
      if (data.usage) setReplyCost(calcCost(data.usage, data.model || model));
    } catch (e) {
      if (run === replyRunRef.current) setReplyError(e.message);
    } finally {
      if (run === replyRunRef.current) setReplyLoading(false);
    }
  }

  async function saveReply() {
    if (!replyDraft.trim() || replySaving) return;
    setReplySaving(true);
    setReplyError(null);
    try {
      const title = applyCorrections(threadTitle, settings.corrections || []).trim() || defaultTitle;
      const res = await apiFetch("/api/save-follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: replyDraft,
          vaultPath: settings.vaultPath,
          meetingTitle: `${threadDate || todayIso()} - ${kindLabel} Reply - ${title}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Reply save failed");
      setReplySavedPath(data.savedPath);
    } catch (e) {
      setReplyError(e.message);
    } finally {
      setReplySaving(false);
    }
  }

  function copyReply() {
    navigator.clipboard.writeText(splitReplyDraft(replyDraft).reply)
      .then(() => setReplyCopied(true))
      .catch(() => {});
  }

  function clearOutput() {
    clearReply();
    setPendingReview(null);
    setNote("");
    setSavedPath("");
    setSfdcReportPath("");
    setSfdcReportUpdated(false);
    setSfdcReportError("");
    setCustomerFactsPath("");
    setUpdatedExisting(false);
    setTodoistResult(null);
    setTodoistCompletions(null);
    setArchivedPath("");
    setPrivacyRepairs(null);
    setError(null);
    setCost(null);
  }

  function handleThreadChange(value) {
    clearOutput();
    setEmailThread(value);
    // A Teams chat has no subject line to infer a title from.
    if (!threadTitle && !isTeams) {
      const inferred = inferTitleFromThread(value);
      if (inferred) setThreadTitle(inferred);
    }
    // Track the newest response so re-pasting a grown thread re-dates the note
    // (unless the user set a Teams date themselves).
    const latestResponse = latestEmailResponseDate(value);
    if (latestResponse && !(isTeams && dateIsManualRef.current)) setThreadDate(latestResponse);
  }

  // Auto-pick the account folder from the pasted thread when none is selected:
  // participants' email domains beat text alias matching.
  useEffect(() => {
    if (selectedFolder || !settings.vaultPath || !emailThread.trim()) return;
    let canceled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/folders?vaultPath=${encodeURIComponent(settings.vaultPath)}`);
        const data = await res.json();
        const folders = (data.folders || []).filter((f) => f.path !== "");
        const account = accountForEmailDomains(emailThread, settings.accounts || []);
        const folder = folderForAccount(account, folders)
          || matchVaultFolder(`${threadTitle} ${emailThread}`, folders, settings.accounts || []);
        if (!canceled && folder) {
          setSelectedFolder(folder);
          setAutoPickedFolder(true);
        }
      } catch {
        // Folder auto-pick is a convenience; the CSM can always select one.
      }
    }, 600);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [emailThread, selectedFolder, settings.vaultPath, settings.accounts, threadTitle]);

  // Look up the existing Obsidian note for this thread (same matcher the save
  // upsert uses) so it can feed regeneration and the CSM can see what updates.
  useEffect(() => {
    const correctedTitle = applyCorrections(threadTitle, settings.corrections || []).trim();
    if (!settings.vaultPath || !correctedTitle) {
      setExistingNote(null);
      return;
    }

    let canceled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        vaultPath: settings.vaultPath,
        folderPath: selectedFolder || "",
        threadTitle: correctedTitle,
        threadKind: variant,
      });
      apiFetch(`/api/email-thread-note?${params}`)
        .then(async (res) => {
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Lookup failed");
          return data.note || null;
        })
        .then((note) => {
          if (!canceled) setExistingNote(note);
        })
        .catch(() => {
          if (!canceled) setExistingNote(null);
        });
    }, 400);

    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [threadTitle, selectedFolder, settings.vaultPath, settings.corrections, variant]);

  async function runSanitizeDetection() {
    const savedReplacements = settings.replacements || [];
    // Read before the scan so the account digest is reviewed like every other
    // input that reaches a model.
    accountContextRef.current = await loadAccountContext();
    const scanText = buildThreadScanText({
      title: threadTitle,
      thread: emailThread,
      context: threadContext,
      participants: threadParticipants,
      folder: selectedFolder,
      accountName: detectAccount(selectedFolder, settings.accounts).name,
      ownerNames: settings.ownerNames || [],
      // The current note is sent as a source when updating, so it is reviewed too.
      existingNote: updateExisting ? existingNote?.content : "",
      accountContext: accountContextRef.current.context,
      corrections: settings.corrections || [],
      replacements: savedReplacements,
    });

    setProcessing(true);
    setError(null);
    setPendingAuto([]);
    setRemembered(null);
    try {
      let newEntities = extractEmailEntities(scanText);
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
          newEntities = mergeSensitiveEntities(newEntities, data.entities || []);
        } catch (err) {
          scanSkipped = true;
          scanError = err?.message || "the scan could not be reached";
        }
      }

      if (settings.aiPrivacyScan && (scanSkipped || truncated)) {
        setError(scanError
          ? `Privacy check blocked generation because the AI detection pass failed: ${scanError}. Retry it or disable the optional AI pass to use local-only detection.`
          : "Privacy check blocked generation because the AI detection pass was incomplete. Retry it or disable the optional AI pass to use local-only detection.");
        return;
      }

      // Terms decided in an earlier review are applied without asking again.
      const plan = planPrivacyReview(newEntities, {
        decisions: settings.privacyDecisions,
        savedReplacements,
        knownEntities: knownPrivacyEntities(settings),
      });
      setPendingAuto(plan.autoReplacements);
      setRemembered(plan.remembered);

      if (plan.review.length > 0) {
        if (truncated) {
          setError("The sensitivity scan found more terms than it could list at once. Review these, then run it again to catch the rest.");
        }
        setPendingReview(plan.review);
        return;
      }

      // An empty result means "nothing sensitive found" only when the scan
      // actually ran. Anything else has to say so.
      await createAndSave([...savedReplacements, ...plan.autoReplacements]);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReviewConfirm(confirmed, toSave, review = {}) {
    let updatedSettings = settings;
    const correctionsToSave = toSave.map(correctionFromRestoredItem).filter(Boolean);
    const reviewed = review?.remember ? review.reviewed || [] : [];
    const decisions = reviewed.length
      ? recordPrivacyDecisions(settings.privacyDecisions, reviewed, { knownEntities: knownPrivacyEntities(settings) })
      : null;

    if (toSave.length > 0 || correctionsToSave.length > 0 || decisions) {
      const newReplacements = [
        ...(settings.replacements || []),
        ...toSave.map((r) => ({ original: r.text, alias: r.alias, restored: r.restored || r.text, type: r.type })),
      ];
      const newCorrections = correctionsToSave.length
        ? mergeCorrections(settings.corrections || [], correctionsToSave)
        : settings.corrections || [];
      updatedSettings = onSettingsPatch({
        replacements: newReplacements,
        corrections: newCorrections,
        ...(decisions ? { privacyDecisions: decisions } : {}),
      });
    }

    setPendingReview(null);

    const replacements = [
      ...(updatedSettings.replacements || []),
      ...pendingAuto,
      ...confirmed
        .filter((c) => !(updatedSettings.replacements || []).some((r) => r.original === c.text))
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text, type: c.type })),
    ];

    setProcessing(true);
    try {
      await createAndSave(replacements);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReviewSkip() {
    setPendingReview(null);
    setProcessing(true);
    try {
      // Bypass covers the terms on the card only; remembered ones stay anonymized.
      await createAndSave([...(settings.replacements || []), ...pendingAuto]);
    } finally {
      setProcessing(false);
    }
  }

  async function createAndSave(replacements) {
    if (!emailThread.trim()) return;
    if (!settings.vaultPath) {
      onSettingsClick();
      return;
    }

    setSavedPath("");
    setSfdcReportPath("");
    setSfdcReportUpdated(false);
    setSfdcReportError("");
    setCustomerFactsPath("");
    setUpdatedExisting(false);
    setCost(null);
    setError(null);
    setNote("");
    clearReply();

    const correctedTitle = applyCorrections(threadTitle, settings.corrections || []);
    const correctedThread = applyCorrections(emailThread, settings.corrections || []);
    const correctedContext = applyCorrections(threadContext, settings.corrections || []);
    const sanitizedTitle = replacements.length ? applyReplacements(correctedTitle, replacements) : correctedTitle;
    const sanitizedThread = replacements.length ? applyReplacements(correctedThread, replacements) : correctedThread;
    const sanitizedContext = replacements.length ? applyReplacements(correctedContext, replacements) : correctedContext;
    // When updating, the current note rides along as [O#] source blocks so
    // manual details and still-open action items survive the regeneration.
    const existingContent = updateExisting && existingNote?.content
      ? applyCorrections(existingNote.content, settings.corrections || [])
      : "";
    const sanitizedExisting = replacements.length
      ? applyReplacements(existingContent, replacements)
      : existingContent;
    const sourceBundle = buildSourceBundle({
      emailThread: sanitizedThread,
      rawNotes: sanitizedContext,
      existingNote: sanitizedExisting,
      threadKind: variant,
    });
    const displaySourceBundle = replacements.length
      ? mapSourceBundle(sourceBundle, (content) => reverseReplacements(content, replacements))
      : sourceBundle;

    try {
      const res = await apiFetch("/api/email-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailThread: sanitizedThread,
          threadTitle: sanitizedTitle || defaultTitle,
          threadDate,
          threadKind: variant,
          threadParticipants: isTeams ? applyReplacements(threadParticipants.trim(), replacements) : "",
          context: sanitizedContext,
          apiKey: settings.apiKey || undefined,
              openaiApiKey: settings.openaiApiKey || undefined,
          model,
          sourceBundle,
          ownerNames: (settings.ownerNames || []).map((name) => applyReplacements(name, replacements)),
          privacyTerms: privacyTermsFromReplacements(replacements),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Email note generation failed");

      const restoredNote = replacements.length ? reverseReplacements(data.note, replacements) : data.note;
      setNote(restoredNote);

      // Everything a reply draft needs, in the anonymized form that was just
      // reviewed and sent, so drafting and redrafting send nothing new.
      const verdict = parseResponseNeeded(restoredNote);
      const accountContext = applyCorrections(accountContextRef.current.context, settings.corrections || []);
      replyInputsRef.current = {
        replacements,
        thread: sanitizedThread,
        note: data.note,
        context: sanitizedContext,
        accountContext: replacements.length ? applyReplacements(accountContext, replacements) : accountContext,
        accountSources: accountContextRef.current.sources,
        title: sanitizedTitle || defaultTitle,
        ownerNames: (settings.ownerNames || []).map((name) => applyReplacements(name, replacements)),
        reason: parseResponseNeeded(data.note).reason,
      };
      setReplyVerdict(verdict);
      // Drafted alongside the save steps below; it reports its own errors.
      if (draftReplies && verdict.needed === true) requestReply();
      setPrivacyRepairs(data.privacyRepairs || null);
      if (data.usage) setCost(calcCost(data.usage, data.model || model));

      setSaving(true);
      // Updates go to the folder the thread already lives in, even when a
      // different folder is selected, so a thread never splits across folders.
      const saveFolder = targetFolder();
      const saveTitle = filenameTitle(threadDate, correctedTitle || defaultTitle, kindLabel);
      const saveRes = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: restoredNote,
          vaultPath: settings.vaultPath,
          folderPath: saveFolder,
          meetingTitle: saveTitle,
          upsertEmailThreadTitle: updateExisting ? correctedTitle.trim() || undefined : undefined,
          fiscalYearFolders: settings.fiscalYearFolders !== false,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Save failed");
      setSavedPath(saveData.savedPath);
      setUpdatedExisting(!!saveData.updated);

      // Reminder to respond, due in 2 days, labeled by account — but only when
      // the note's own verdict says the newest messages leave a reply owed.
      // A missing verdict fails safe and still creates the reminder.
      if (todoistConfigured(settings)) {
        if (verdict.needed === false) {
          // No reply owed anymore — also retire any open "Respond to ..."
          // reminders this thread created earlier.
          let closed = 0;
          if (correctedTitle.trim()) {
            try {
              closed = await completeTodoistTasks(apiFetch, settings, `Respond to "${correctedTitle.trim()}"`);
            } catch {
              // Closing old reminders is best-effort.
            }
          }
          setTodoistResult({ ok: true, skipped: true, closed });
        } else {
          try {
            const label = todoistLabelForNote(saveFolder, settings.accounts);
            const result = await pushTodoistTasks(apiFetch, settings, [{
              content: `Respond to "${correctedTitle.trim() || defaultTitle.toLowerCase()}"${verdict.reason ? ` — ${verdict.reason}` : " (if needed)"}`,
              dueString: "in 2 days",
              labels: label ? [label] : [],
              description: `From ${kindLabel.toLowerCase()} note: ${saveTitle}`,
            }]);
            setTodoistResult(result?.count ? { ok: true, reason: verdict.reason } : { ok: false, error: result?.failed?.[0]?.error || "Task not created" });
          } catch (todoistError) {
            setTodoistResult({ ok: false, error: todoistError.message });
          }
        }
      }

      // Archive the raw thread and the CSM's context under an "Emails" folder
      // inside the account's transcript archive, titled
      // "YYYY-MM-DD - Email - subject" from the thread date in the UI, the
      // same shape the vault note uses. The
      // generated note itself goes to the vault alongside every other note;
      // this is only the raw source. That date advances as replies arrive, so a grown
      // thread archives as a new dated snapshot rather than overwriting the
      // earlier one; an unchanged re-paste still matches on content and does
      // not duplicate.
      if (settings.transcriptsPath) {
        const archiveBody = formatEmailArchive(correctedThread, correctedContext, variant);
        if (archiveBody) {
          try {
            const archiveRes = await apiFetch("/api/save-transcript", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript: archiveBody,
                meetingTitle: `${threadDate || todayIso()} - ${kindLabel} - ${stripThreadNoise(correctedTitle) || defaultTitle}`,
                transcriptsPath: settings.transcriptsPath,
                folder: saveFolder || undefined,
                // Correspondence lives in its own folder inside the account's
                // transcript archive, apart from the meeting recordings —
                // emails and Teams chats each in their own.
                subfolder: isTeams ? "Teams Chats" : "Emails",
                accounts: settings.accounts || [],
              }),
            });
            const archiveData = await archiveRes.json();
            if (archiveData?.savedPath) setArchivedPath(archiveData.savedPath);
          } catch {
            // The note itself is already saved; archiving is best-effort.
          }
        }
      }

      // A thread often settles an action from an earlier meeting. Proposed
      // only — closing someone's task list is their call.
      if (todoistConfigured(settings)) {
        try {
          const preview = await previewTodoistCompletions(apiFetch, settings, {
            notes: restoredNote,
            noteTitle: saveTitle,
            label: todoistLabelForNote(saveFolder, settings.accounts),
            model: settings.model,
          });
          if (preview?.proposals?.length) setTodoistCompletions(preview);
        } catch {
          // Best-effort: the note and its reminder are already safe.
        }
      }

      // A Teams note is deliberately minimal — no callout sections for the
      // customer-facts rollup to read and no SFDC Activity Entry to file —
      // so both post-save steps only run for email notes.
      const account = detectAccount(saveFolder, settings.accounts || []);
      if (!isTeams && account.name !== "Internal") {
        try {
          const factsRes = await apiFetch("/api/customer-facts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              vaultPath: settings.vaultPath,
              folderPath: saveFolder,
              accountName: account.name,
              fiscalYearFolders: settings.fiscalYearFolders !== false,
            }),
          });
          const factsData = await factsRes.json();
          if (factsRes.ok && factsData.savedPath) setCustomerFactsPath(factsData.savedPath);
        } catch {
          // Best-effort rollup refresh; the email note itself is already safe.
        }
      }

      if (!isTeams) try {
        const reportRes = await apiFetch("/api/sfdc-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: restoredNote,
            vaultPath: settings.vaultPath,
            meetingTitle: saveTitle,
            emailThreadTitle: correctedTitle.trim() || undefined,
          }),
        });
        const reportData = await reportRes.json();
        if (!reportRes.ok || !reportData.savedPath) {
          throw new Error(reportData.error || "No SFDC Activity Entry was saved");
        }
        setSfdcReportPath(reportData.savedPath);
        setSfdcReportUpdated(!!reportData.updated);
      } catch (reportError) {
        setSfdcReportError(reportError.message);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }

    return displaySourceBundle;
  }

  function setManualDate(value) {
    clearOutput();
    if (isTeams) dateIsManualRef.current = true;
    setThreadDate(value);
  }

  function handleNewThread() {
    dateIsManualRef.current = false;
    setThreadTitle("");
    setThreadDate(todayIso());
    setThreadContext("");
    setThreadParticipants("");
    setEmailThread("");
    setUpdateExisting(true);
    setAutoPickedFolder(false);
    setPendingReview(null);
    setNote("");
    setSavedPath("");
    setSfdcReportPath("");
    setSfdcReportUpdated(false);
    setSfdcReportError("");
    setCustomerFactsPath("");
    setUpdatedExisting(false);
    setTodoistResult(null);
    setError(null);
    setCost(null);
    clearReply();
    setReplyInstructions("");
    setReplyAudience(defaultReplyAudience(variant));
    setReplyTone("warm-professional");
  }

  const replyParts = splitReplyDraft(replyDraft);

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{kindLabel} Thread Note</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isTeams
                ? "Paste a Teams chat, say who's in it, and save a simple details + to-dos note to Obsidian"
                : "Paste a customer email thread and save a dated decisions note to Obsidian"}
            </p>
          </div>
          {note && (
            <button type="button" onClick={handleNewThread} className="btn-secondary text-xs">New Thread</button>
          )}
        </div>

        <div className="grid sm:grid-cols-[1fr_auto] gap-3 mb-4">
          <div>
            <label className="label">Thread Title</label>
            <input
              className="input"
              value={threadTitle}
              onChange={(event) => {
                clearOutput();
                setThreadTitle(event.target.value);
              }}
              placeholder="e.g. SystemLink license cleanup follow-up"
            />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="label">{isTeams ? "Chat Date" : "Note Date"}</label>
              {isTeams && (
                <span className="flex items-center gap-1 text-[11px]">
                  {[["Today", 0], ["Yesterday", 1]].map(([label, daysAgo]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setManualDate(isoDateDaysAgo(daysAgo))}
                      className={`rounded-full border px-2 py-0.5 transition-colors ${
                        threadDate === isoDateDaysAgo(daysAgo)
                          ? "border-obsidian-300 bg-obsidian-50 text-obsidian-700"
                          : "border-gray-200 text-gray-500 hover:bg-gray-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              )}
            </div>
            <input
              type="date"
              className="input"
              value={threadDate}
              onChange={(event) => setManualDate(event.target.value)}
            />
            <p className="mt-1 text-[10px] text-gray-400">
              {isTeams
                ? "The day this chat happened. Defaults to today; a full date in the pasted chat sets it, and a date you pick here is kept."
                : "Auto-set to the newest dated response in the pasted thread"}
            </p>
          </div>
        </div>

        {isTeams && (
          <div className="mb-4">
            <label className="label">Who&apos;s in the thread <span className="font-normal text-gray-400">(optional)</span></label>
            <input
              className="input"
              value={threadParticipants}
              onChange={(event) => {
                clearOutput();
                setThreadParticipants(event.target.value);
              }}
              placeholder="e.g. Dana Smith (Acme EA admin), Jordan Lee (NI AE)"
            />
            <p className="mt-1 text-[10px] text-gray-400">Teams pastes often truncate names — list the people here and the note uses these names</p>
          </div>
        )}

        {existingNote && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 flex items-start justify-between gap-3">
            <span>
              {updateExisting ? (
                <>This thread already has a note — it will be used as a source and updated in place (a backup is kept): <code className="font-mono">{existingNote.filename}</code>{existingNote.folder !== undefined && existingNote.folder !== selectedFolder ? <> in <code className="font-mono">{existingNote.folder || "vault root"}</code></> : null}</>
              ) : (
                <>This thread already has a note (<code className="font-mono">{existingNote.filename}</code>) — a separate new note will be saved.</>
              )}
            </span>
            <label className="flex items-center gap-1.5 whitespace-nowrap cursor-pointer font-medium">
              <input
                type="checkbox"
                checked={updateExisting}
                onChange={(event) => {
                  clearOutput();
                  setUpdateExisting(event.target.checked);
                }}
              />
              Update existing
            </label>
          </div>
        )}

        <div className="mb-4">
          <label className="label">CSM Context <span className="font-normal text-gray-400">(optional)</span></label>
          <textarea
            className="input resize-y text-xs leading-relaxed"
            rows={3}
            value={threadContext}
            onChange={(event) => {
              clearOutput();
              setThreadContext(event.target.value);
            }}
            placeholder={isTeams
              ? "Anything the chat won't explain on its own: account, project, or what the thread is about."
              : "Anything the email thread won't explain on its own: account, project, stakeholder roles, or what you need the note to emphasize."}
          />
        </div>

        <div>
          {isTeams && (
            <ChatScreenshotUpload
              settings={settings}
              model={model}
              onTranscribed={(text) => handleThreadChange(appendToThread(threadRef.current, text))}
            />
          )}
          <label className="label">{kindLabel} Thread</label>
          <textarea
            className="input resize-y font-mono text-xs leading-relaxed"
            rows={16}
            value={emailThread}
            onChange={(event) => handleThreadChange(event.target.value)}
            placeholder={isTeams
              ? "Paste the Teams chat here. It has no subject line, so give it a Thread Title above..."
              : "Paste the thread here, including subject/from/date lines if you have them..."}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>{wordCount.toLocaleString()} words</span>
            {emailThread && (
              <button type="button" onClick={() => setEmailThread("")} className="text-red-500 hover:text-red-700">Clear</button>
            )}
          </div>
        </div>
      </div>

      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={selectedFolder}
        onSelect={(folder) => {
          clearOutput();
          setAutoPickedFolder(false);
          setSelectedFolder(folder);
        }}
        onSettingsClick={onSettingsClick}
        stepNumber={2}
      />
      {autoPickedFolder && selectedFolder && (
        <p className="text-xs text-gray-500 -mt-2 px-1">
          Folder auto-selected from the thread&apos;s participants: <code className="font-mono">{selectedFolder}</code> — pick a different one above if that&apos;s wrong.
        </p>
      )}

      {pendingReview && (
        <SanitizeReview
          detected={pendingReview}
          savedReplacements={settings.replacements || []}
          remembered={remembered}
          onConfirm={handleReviewConfirm}
          onSkip={handleReviewSkip}
        />
      )}

      <RememberedPrivacyNote remembered={!pendingReview && !processing ? remembered : null} />

      {error && (
        <div className="card p-4 border-l-4 border-l-red-400">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="text-sm text-red-700 mt-0.5">{error}</p>
        </div>
      )}

      {!pendingReview && (
        <div className="card p-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={draftReplies}
              onChange={(event) => {
                clearOutput();
                onSettingsPatch({ draftReplies: event.target.checked });
              }}
              className="mt-0.5 w-4 h-4 rounded accent-obsidian-600"
            />
            <span>
              <span className="block text-sm font-medium text-gray-800">Draft a reply when this thread needs one</span>
              <span className="block text-xs text-gray-500 mt-0.5">
                Written from the thread, its note, and the recent notes in the account folder, which go through Privacy Review with the thread.
              </span>
            </span>
          </label>
        </div>
      )}

      {!pendingReview && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <ModelPicker model={model} setModel={setModel} />

          <button
            type="button"
            onClick={runSanitizeDetection}
            disabled={!canCreate}
            className="btn-primary flex-1 py-3 text-base"
          >
            {processing
              ? "Anonymizing and generating..."
              : saving
                ? "Saving..."
                : updateExisting && existingNote
                  ? `Update ${kindLabel} Note`
                  : `Create ${kindLabel} Note`}
          </button>
        </div>
      )}

      {savedPath && (
        <div className="card p-4 border-l-4 border-l-green-400">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <p className="text-sm text-green-700">
                {updatedExisting ? "Updated existing note at" : "Saved to"} <code className="font-mono text-xs bg-green-50 px-1.5 py-0.5 rounded">{savedPath}</code>
              </p>
              {sfdcReportPath && (
                <p className="text-sm text-teal-700">
                  SFDC activity {sfdcReportUpdated ? "updated in" : "added to"} <code className="font-mono text-xs bg-teal-50 px-1.5 py-0.5 rounded">{sfdcReportPath}</code>
                </p>
              )}
              {customerFactsPath && (
                <p className="text-sm text-violet-700">
                  Customer callouts rebuilt at <code className="font-mono text-xs bg-violet-50 px-1.5 py-0.5 rounded">{customerFactsPath}</code>
                </p>
              )}
              {archivedPath && (
                <p className="text-sm text-gray-600">
                  Thread and context archived to <code className="font-mono text-xs bg-gray-100 px-1 rounded">{archivedPath}</code>
                </p>
              )}
              {todoistCompletions?.proposals?.length > 0 && (
                <div className="rounded-lg px-3 py-2 border border-rose-200 bg-rose-50 text-sm text-rose-800 space-y-2">
                  <p><strong>{todoistCompletions.proposals.length} open Todoist task{todoistCompletions.proposals.length !== 1 ? "s" : ""}</strong> look{todoistCompletions.proposals.length === 1 ? "s" : ""} settled by this thread.</p>
                  <ul className="space-y-1">
                    {todoistCompletions.proposals.map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-2">
                        <span className="text-xs">
                          <span className="font-medium">{item.content}</span>
                          <span className="block text-rose-700">{item.certain ? "Ticked off in this note" : item.reason}{item.evidence ? ` — “${item.evidence}”` : ""}</span>
                        </span>
                        <button type="button" onClick={() => closeProposedTodoistTasks([item.id])} disabled={closingTodoist} className="btn-secondary text-xs px-2 py-0.5 whitespace-nowrap">Close</button>
                      </li>
                    ))}
                  </ul>
                  <button type="button" onClick={() => closeProposedTodoistTasks(todoistCompletions.proposals.map((i) => i.id))} disabled={closingTodoist} className="btn-primary text-xs">
                    {closingTodoist ? "Closing…" : `Close all ${todoistCompletions.proposals.length}`}
                  </button>
                </div>
              )}
              {todoistCompletions?.closed > 0 && !todoistCompletions.proposals?.length && (
                <p className="text-sm text-green-700">{todoistCompletions.closed} Todoist task{todoistCompletions.closed !== 1 ? "s" : ""} closed.</p>
              )}
              {todoistResult && (
                <p className={`text-sm ${todoistResult.ok ? "text-rose-700" : "text-amber-700"}`}>
                  {todoistResult.skipped
                    ? `No reply owed on this thread — Todoist reminder skipped${todoistResult.closed ? `, and ${todoistResult.closed} earlier reminder${todoistResult.closed !== 1 ? "s" : ""} closed` : ""}.`
                    : todoistResult.ok
                      ? `Todoist reminder added: respond in 2 days${todoistResult.reason ? ` — ${todoistResult.reason}` : ""}`
                      : `Todoist reminder was not added: ${todoistResult.error}`}
                </p>
              )}
              {sfdcReportError && (
                <p className="text-xs text-amber-700">Email note saved, but the SFDC report was not updated: {sfdcReportError}</p>
              )}
            </div>
            {cost && <span className="text-xs text-gray-400 font-mono">{formatCost(cost)}</span>}
          </div>
        </div>
      )}

      {note && replyVerdict && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between gap-3">
            <div>
              <h2 className="section-header mb-0">Reply Draft</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {replyVerdict.needed === true
                  ? `A reply is owed${replyVerdict.reason ? `: ${replyVerdict.reason}` : "."}`
                  : replyVerdict.needed === false
                    ? "No reply is owed on this thread. You can still draft one."
                    : "The note did not say whether a reply is owed. You can draft one."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {replyCost && <span className="text-xs text-gray-400 font-mono">{formatCost(replyCost)}</span>}
              {replyDraft && (
                <>
                  <button type="button" onClick={copyReply} className="btn-secondary text-xs">{replyCopied ? "Copied" : "Copy Reply"}</button>
                  <button type="button" onClick={saveReply} disabled={replySaving || !!replySavedPath} className="btn-secondary text-xs">
                    {replySaving ? "Saving..." : replySavedPath ? "Saved" : "Save to Obsidian"}
                  </button>
                </>
              )}
            </div>
          </div>

          {replyError && <p className="px-6 py-2 text-xs text-red-700 bg-red-50 border-b border-red-200">{replyError}</p>}
          {replySavedPath && (
            <p className="px-6 py-2 text-xs text-green-700 bg-green-50 border-b border-green-200">
              Saved to <code className="font-mono">{replySavedPath}</code>
            </p>
          )}

          {replyLoading && !replyDraft && <p className="px-6 py-4 text-sm text-gray-500">Drafting a reply...</p>}

          {replyDraft && (
            <div className="p-6 space-y-4">
              <div className="markdown-preview">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{replyParts.reply}</ReactMarkdown>
              </div>
              {replyParts.checks && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                  <p className="font-semibold mb-1">Before You Send</p>
                  <div className="markdown-preview">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{replyParts.checks}</ReactMarkdown>
                  </div>
                </div>
              )}
              <p className="text-[11px] text-gray-400">
                {replyContextSources.length
                  ? `Account history used: ${replyContextSources.map((name) => name.replace(/\.md$/i, "")).join("; ")}`
                  : "Drafted from this thread and its note only. No recent account notes were available."}
              </p>
            </div>
          )}

          <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-gray-600">
                Audience
                <select aria-label="Reply audience" className="input text-xs mt-1" value={replyAudience} onChange={(event) => setReplyAudience(event.target.value)}>
                  <option value="customer">Customer</option>
                  <option value="internal">Internal team</option>
                  <option value="mixed">Customer plus NI owners</option>
                </select>
              </label>
              <label className="text-xs font-medium text-gray-600">
                Tone
                <select aria-label="Reply tone" className="input text-xs mt-1" value={replyTone} onChange={(event) => setReplyTone(event.target.value)}>
                  <option value="warm-professional">Warm professional</option>
                  <option value="concise-direct">Concise direct</option>
                  <option value="technical">Technical</option>
                  <option value="executive">Executive</option>
                </select>
              </label>
            </div>
            <textarea
              aria-label="Reply instructions"
              className="input resize-y text-xs leading-relaxed"
              rows={2}
              value={replyInstructions}
              onChange={(event) => setReplyInstructions(event.target.value)}
              placeholder="Optional: what the reply should say or change, e.g. offer Tuesday or Thursday for a call, keep it to three sentences."
            />
            <button
              type="button"
              onClick={() => requestReply({ instructions: replyInstructions, previousDraft: replyInstructions.trim() ? replyParts.reply : "" })}
              disabled={replyLoading}
              className="btn-primary text-xs"
            >
              {replyLoading ? "Drafting..." : replyDraft ? "Redraft Reply" : "Draft Reply"}
            </button>
          </div>
        </div>
      )}

      {note && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h2 className="section-header mb-0">Generated {kindLabel} Note</h2>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(note).catch(() => {})}
              className="btn-secondary text-xs"
            >
              Copy
            </button>
          </div>
          {privacyRepairs?.email > 0 && (
            <p className="px-6 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
              {privacyRepairs.email} email address{privacyRepairs.email === 1 ? " was" : "es were"} not caught in Privacy Review, so {privacyRepairs.email === 1 ? "it was" : "they were"} replaced
              with a placeholder before sending and put back in this note. {privacyRepairs.email === 1 ? "It was" : "They were"} never sent.
            </p>
          )}
          <div className="p-6 markdown-preview max-h-[650px] overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
