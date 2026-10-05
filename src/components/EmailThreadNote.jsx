"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FolderSelector from "@/components/FolderSelector";
import ModelPicker from "@/components/ModelPicker";
import SanitizeReview from "@/components/SanitizeReview";
import {
  applyCorrections,
  applyReplacements,
  assignAliases,
  correctionFromRestoredItem,
  mergeCorrections,
  reverseReplacements,
} from "@/lib/sanitize";
import { aliasesFromReplacements, extractEmailEntities, mergeSensitiveEntities } from "@/lib/privacy";
import { buildSourceBundle, formatEmailArchive, mapSourceBundle } from "@/lib/sourceBundle";
import { latestEmailResponseDate } from "@/lib/emailDates";
import { apiFetch } from "@/lib/apiClient";
import { stripThreadNoise } from "@/lib/emailThreads";
import { FAST_MODEL, calcCost, formatCost } from "@/lib/models";
import { accountForEmailDomains, detectAccount, folderForAccount, matchVaultFolder } from "@/lib/accounts";
import { closeTodoistTasks, completeTodoistTasks, previewTodoistCompletions, pushTodoistTasks, todoistConfigured, todoistLabelForNote } from "@/lib/todoist";
import { parseResponseNeeded } from "@/lib/emailFollowUp";

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function filenameTitle(threadDate, threadTitle) {
  const title = threadTitle.trim() || "Email Thread";
  return `${threadDate || todayIso()} - Email - ${title}`;
}

function inferTitleFromThread(text) {
  const subject = text.match(/^subject:\s*(.+)$/im)?.[1]?.trim();
  if (!subject) return "";
  // Clients stack "RE: RE: FW:" and gateways prepend "[EXTERNAL]"; strip them
  // all so every paste of the same thread infers the same title — and the
  // file it saves to is named for the conversation, not its dressing.
  return stripThreadNoise(subject);
}

export default function EmailThreadNote({ settings, onSettingsPatch, onSettingsClick }) {
  const [threadTitle, setThreadTitle] = useState("");
  const [threadDate, setThreadDate] = useState(todayIso());
  const [threadContext, setThreadContext] = useState("");
  const [emailThread, setEmailThread] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  // Mounted only when the Email tab opens, so saved settings have hydrated:
  // the default model applies here the same as on every other tab.
  const [model, setModel] = useState(settings.model || FAST_MODEL);
  const [pendingReview, setPendingReview] = useState(null);
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

  function clearOutput() {
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
    setError(null);
    setCost(null);
  }

  function handleThreadChange(value) {
    clearOutput();
    setEmailThread(value);
    if (!threadTitle) {
      const inferred = inferTitleFromThread(value);
      if (inferred) setThreadTitle(inferred);
    }
    // Track the newest response so re-pasting a grown thread re-dates the note.
    const latestResponse = latestEmailResponseDate(value);
    if (latestResponse) setThreadDate(latestResponse);
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
  }, [threadTitle, selectedFolder, settings.vaultPath, settings.corrections]);

  async function runSanitizeDetection() {
    const savedReplacements = settings.replacements || [];
    const correctedTitle = applyCorrections(threadTitle, settings.corrections || []);
    const correctedThread = applyCorrections(emailThread, settings.corrections || []);
    const correctedContext = applyCorrections(threadContext, settings.corrections || []);

    const scanText = [
      applyReplacements(correctedTitle, savedReplacements),
      applyReplacements(correctedThread, savedReplacements),
      applyReplacements(correctedContext, savedReplacements),
    ].filter((part) => part && part.trim()).join("\n\n");

    setProcessing(true);
    setError(null);
    try {
      let newEntities = extractEmailEntities(scanText);
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
          newEntities = mergeSensitiveEntities(newEntities, data.entities || []);
        } catch (err) {
          scanSkipped = true;
          scanError = err?.message || "the scan could not be reached";
        }
      }

      if (newEntities.length > 0) {
        if (truncated) {
          setError("The sensitivity scan found more terms than it could list at once. Review these, then run it again to catch the rest.");
        }
        setPendingReview(assignAliases(newEntities, savedReplacements));
        return;
      }

      // An empty result means "nothing sensitive found" only when the scan
      // actually ran. Anything else has to say so.
      if (scanSkipped && settings.aiPrivacyScan) {
        setError(scanError
          ? `Sensitivity scan did not run: ${scanError}. Names and companies were NOT checked.`
          : "Sensitivity scan skipped — set your API key in Settings to enable name/company detection.");
      } else if (truncated) {
        setError("The sensitivity scan was cut off before it finished. Run it again before trusting the result.");
      }
      await createAndSave(savedReplacements);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReviewConfirm(confirmed, toSave) {
    let updatedSettings = settings;
    const correctionsToSave = toSave.map(correctionFromRestoredItem).filter(Boolean);

    if (toSave.length > 0 || correctionsToSave.length > 0) {
      const newReplacements = [
        ...(settings.replacements || []),
        ...toSave.map((r) => ({ original: r.text, alias: r.alias, restored: r.restored || r.text })),
      ];
      const newCorrections = correctionsToSave.length
        ? mergeCorrections(settings.corrections || [], correctionsToSave)
        : settings.corrections || [];
      updatedSettings = onSettingsPatch({
        replacements: newReplacements,
        corrections: newCorrections,
      });
    }

    setPendingReview(null);

    const replacements = [
      ...(updatedSettings.replacements || []),
      ...confirmed
        .filter((c) => !(updatedSettings.replacements || []).some((r) => r.original === c.text))
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text })),
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
      await createAndSave(settings.replacements || []);
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
          threadTitle: sanitizedTitle || "Email Thread",
          threadDate,
          context: sanitizedContext,
          apiKey: settings.apiKey || undefined,
              openaiApiKey: settings.openaiApiKey || undefined,
          model,
          sourceBundle,
          ownerNames: settings.ownerNames || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Email note generation failed");

      const restoredNote = replacements.length ? reverseReplacements(data.note, replacements) : data.note;
      setNote(restoredNote);
      if (data.usage) setCost(calcCost(data.usage, data.model || model));

      setSaving(true);
      // Updates go to the folder the thread already lives in, even when a
      // different folder is selected, so a thread never splits across folders.
      const saveFolder = updateExisting && existingNote ? existingNote.folder ?? selectedFolder : selectedFolder;
      const saveTitle = filenameTitle(threadDate, correctedTitle || "Email Thread");
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
        const verdict = parseResponseNeeded(restoredNote);
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
              content: `Respond to "${correctedTitle.trim() || "email thread"}"${verdict.reason ? ` — ${verdict.reason}` : " (if needed)"}`,
              dueString: "in 2 days",
              labels: label ? [label] : [],
              description: `From email note: ${saveTitle}`,
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
        const archiveBody = formatEmailArchive(correctedThread, correctedContext);
        if (archiveBody) {
          try {
            const archiveRes = await apiFetch("/api/save-transcript", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript: archiveBody,
                meetingTitle: `${threadDate || todayIso()} - Email - ${stripThreadNoise(correctedTitle) || "Email Thread"}`,
                transcriptsPath: settings.transcriptsPath,
                folder: saveFolder || undefined,
                // Correspondence lives in its own folder inside the account's
                // transcript archive, apart from the meeting recordings.
                subfolder: "Emails",
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

      const account = detectAccount(saveFolder, settings.accounts || []);
      if (account.name !== "Internal") {
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

      try {
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

  function handleNewThread() {
    setThreadTitle("");
    setThreadDate(todayIso());
    setThreadContext("");
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
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Email Thread Note</h2>
            <p className="text-xs text-gray-500 mt-0.5">Paste a customer thread and save a dated decisions note to Obsidian</p>
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
            <label className="label">Note Date</label>
            <input
              type="date"
              className="input"
              value={threadDate}
              onChange={(event) => {
                clearOutput();
                setThreadDate(event.target.value);
              }}
            />
            <p className="mt-1 text-[10px] text-gray-400">Auto-set to the newest dated response in the pasted thread</p>
          </div>
        </div>

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
            placeholder="Anything the email thread won't explain on its own: account, project, stakeholder roles, or what you need the note to emphasize."
          />
        </div>

        <div>
          <label className="label">Email Thread</label>
          <textarea
            className="input resize-y font-mono text-xs leading-relaxed"
            rows={16}
            value={emailThread}
            onChange={(event) => handleThreadChange(event.target.value)}
            placeholder="Paste the thread here, including subject/from/date lines if you have them..."
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
          onConfirm={handleReviewConfirm}
          onSkip={handleReviewSkip}
        />
      )}

      {error && (
        <div className="card p-4 border-l-4 border-l-red-400">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="text-sm text-red-700 mt-0.5">{error}</p>
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
                  ? "Update Email Note"
                  : "Create Email Note"}
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

      {note && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h2 className="section-header mb-0">Generated Email Note</h2>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(note).catch(() => {})}
              className="btn-secondary text-xs"
            >
              Copy
            </button>
          </div>
          <div className="p-6 markdown-preview max-h-[650px] overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
