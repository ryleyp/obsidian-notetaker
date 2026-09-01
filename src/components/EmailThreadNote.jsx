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
import { buildSourceBundle, mapSourceBundle } from "@/lib/sourceBundle";
import { latestEmailResponseDate } from "@/lib/emailDates";
import { apiFetch } from "@/lib/apiClient";
import { FAST_MODEL, calcCost, formatCost } from "@/lib/models";
import { accountForEmailDomains, detectAccount, folderForAccount, matchVaultFolder } from "@/lib/accounts";
import { completeTodoistTasks, pushTodoistTasks, todoistConfigured, todoistLabelForNote } from "@/lib/todoist";
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
  // Clients stack "RE: RE: FW:" prefixes with every reply; strip them all so
  // every paste of the same thread infers the same title.
  return subject.replace(/^(\s*(re|fw|fwd|aw)\s*:\s*)+/i, "").trim();
}

export default function EmailThreadNote({ settings, onSettingsPatch, onSettingsClick }) {
  const [threadTitle, setThreadTitle] = useState("");
  const [threadDate, setThreadDate] = useState(todayIso());
  const [threadContext, setThreadContext] = useState("");
  const [emailThread, setEmailThread] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [model, setModel] = useState(FAST_MODEL);
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
  const [updatedExisting, setUpdatedExisting] = useState(false);
  const [existingNote, setExistingNote] = useState(null);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [todoistResult, setTodoistResult] = useState(null);
  const [autoPickedFolder, setAutoPickedFolder] = useState(false);
  const [cost, setCost] = useState(null);

  const wordCount = emailThread.trim() ? emailThread.trim().split(/\s+/).length : 0;
  const canCreate = emailThread.trim() && !processing && !saving;

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
      if (settings.aiPrivacyScan) {
        try {
          const res = await apiFetch("/api/sanitize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: scanText,
              apiKey: settings.apiKey || undefined,
              knownAliases: aliasesFromReplacements(savedReplacements),
            }),
          });
          const data = await res.json();
          if (data.skipped) scanSkipped = true;
          newEntities = mergeSensitiveEntities(newEntities, data.entities || []);
        } catch {
          scanSkipped = true;
        }
      }

      if (newEntities.length > 0) {
        setPendingReview(assignAliases(newEntities, savedReplacements));
        return;
      }

      if (scanSkipped && settings.aiPrivacyScan) {
        setError("Sensitivity scan skipped — set your API key in Settings to enable name/company detection.");
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
          model,
          sourceBundle,
          ownerNames: settings.ownerNames || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Email note generation failed");

      const restoredNote = replacements.length ? reverseReplacements(data.note, replacements) : data.note;
      setNote(restoredNote);
      if (data.usage) setCost(calcCost(data.usage, model));

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
