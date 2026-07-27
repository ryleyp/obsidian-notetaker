"use client";

import { useState, useEffect, useRef } from "react";
import Header from "@/components/Header";
import SettingsPanel from "@/components/SettingsPanel";
import MeetingDetails from "@/components/MeetingDetails";
import TranscriptInput from "@/components/TranscriptInput";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import AccountStatus from "@/components/AccountStatus";
import SystemLinkStatus from "@/components/SystemLinkStatus";
import SanitizeReview from "@/components/SanitizeReview";
import {
  applyReplacements,
  reverseReplacements,
  assignAliases,
  applyCorrections,
  correctionFromRestoredItem,
  mergeCorrections,
} from "@/lib/sanitize";
import { calcCost } from "@/lib/pricing";
import { matchVaultFolder, DEFAULT_ACCOUNTS } from "@/lib/accounts";
import { aliasesFromReplacements } from "@/lib/privacy";
import { apiFetch, approveLocalPaths } from "@/lib/apiClient";

export default function Home() {
  const [mode, setMode] = useState("new");
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState({ vaultPath: "", transcriptsPath: "/Users/ryleypriddy/Documents/Claude", apiKey: "", aiPrivacyScan: true, replacements: [], corrections: [], accounts: DEFAULT_ACCOUNTS });

  // New note state
  const [meetingTitle, setMeetingTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [model, setModel] = useState("claude-haiku-4-5");

  // Sanitization state
  const [sanitizing, setSanitizing] = useState(false);
  const [pendingReview, setPendingReview] = useState(null); // null | detected[]
  const [pendingAction, setPendingAction] = useState("generate"); // "generate" | "saveTranscript"
  const [activeReplacements, setActiveReplacements] = useState([]);

  // Generation state
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [todosSaved, setTodosSaved] = useState(null); // { count, path } | null
  const [noteCost, setNoteCost] = useState(null);
  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptSaved, setTranscriptSaved] = useState(false);
  const [transcriptSavedPath, setTranscriptSavedPath] = useState("");
  const generationControllerRef = useRef(null);
  const [lastGenerationRequest, setLastGenerationRequest] = useState(null);

  function persistBrowserSettings(nextSettings) {
    const settingsToPersist = { ...nextSettings };
    delete settingsToPersist.apiKey;
    localStorage.setItem("obsidian-notes-settings", JSON.stringify(settingsToPersist));
  }

  useEffect(() => {
    let base;
    try {
      const stored = localStorage.getItem("obsidian-notes-settings");
      if (stored) {
        const parsed = JSON.parse(stored);
        const { apiKey: oldPersistedApiKey, ...persistedSettings } = parsed;
        const sessionApiKey = sessionStorage.getItem("obsidian-notes-api-key") || "";
        base = {
          replacements: [],
          corrections: [],
          accounts: DEFAULT_ACCOUNTS,
          transcriptsPath: "/Users/ryleypriddy/Documents/Claude",
          aiPrivacyScan: true,
          ...persistedSettings,
          apiKey: sessionApiKey,
        };
        setSettings(base);
        if (oldPersistedApiKey) {
          localStorage.setItem("obsidian-notes-settings", JSON.stringify(persistedSettings));
        }
        if (parsed.model) setModel(parsed.model);
        if (!parsed.vaultPath) setShowSettings(true);
      } else {
        setShowSettings(true);
      }
    } catch {
      setShowSettings(true);
    }

    // Merge the durable glossary config file (source of truth across machines).
    const dir = base?.transcriptsPath || base?.vaultPath;
    if (!dir) return;
    (async () => {
      try {
        await approveLocalPaths(base);
        const res = await apiFetch(`/api/config?path=${encodeURIComponent(dir)}`);
        const data = await res.json();
        if (data.config) {
          setSettings((prev) => {
            const merged = {
              ...prev,
              replacements: data.config.replacements ?? prev.replacements,
              corrections: data.config.corrections ?? prev.corrections,
              accounts: data.config.accounts?.length ? data.config.accounts : prev.accounts,
            };
            persistBrowserSettings(merged);
            return merged;
          });
        }
      } catch {
        // File-based glossary is best-effort; localStorage remains the fallback.
      }
    })();
  }, []);

  useEffect(() => {
    setTranscriptSaved(false);
    setTranscriptSavedPath("");
  }, [transcript, meetingTitle]);

  // Write the portable glossary (replacements, corrections, accounts) to a file
  // so it survives browser cache clears and travels between machines.
  function persistConfig(s) {
    const dir = s.transcriptsPath || s.vaultPath;
    if (!dir) return;
    approveLocalPaths(s)
      .then(() => apiFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: dir,
          config: {
            accounts: s.accounts || DEFAULT_ACCOUNTS,
            corrections: s.corrections || [],
          },
          glossary: {
            replacements: s.replacements || [],
          },
        }),
      }))
      .catch(() => {});
  }

  async function handleSaveSettings(newSettings) {
    const { apiKey, ...settingsToPersist } = newSettings;
    const merged = { replacements: [], ...settingsToPersist, apiKey };
    try {
      await approveLocalPaths(merged);
      setSettings(merged);
      localStorage.setItem("obsidian-notes-settings", JSON.stringify(settingsToPersist));
      if (apiKey) sessionStorage.setItem("obsidian-notes-api-key", apiKey);
      else sessionStorage.removeItem("obsidian-notes-api-key");
      persistConfig(merged);
      setShowSettings(false);
      setSelectedFolder("");
    } catch (error) {
      alert(`Failed to approve local paths: ${error.message}`);
    }
  }

  function handleTitleSuggest(suggested) {
    if (!meetingTitle) setMeetingTitle(suggested);
  }

  // Shared: detect entities, show review card, then route to action
  async function runSanitizeDetection(action) {
    const savedReplacements = settings.replacements || [];
    setSanitizing(true);
    setPendingAction(action);

    // Pre-apply known corrections and replacements — the scan only sees
    // pseudonymized versions of already-known names.
    const correctedTitle = applyCorrections(meetingTitle, settings.corrections || []);
    const preSanitizedTitle = applyReplacements(correctedTitle, savedReplacements);
    const preSanitizedTranscript = applyReplacements(
      applyCorrections(transcript, settings.corrections || []),
      savedReplacements
    );
    const scanText = [preSanitizedTitle, preSanitizedTranscript].filter(Boolean).join("\n\n");

    let newEntities = [];
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
        newEntities = data.entities || [];
      } catch {
        scanSkipped = true;
      }
    }

    setSanitizing(false);

    if (newEntities.length > 0) {
      const detected = assignAliases(newEntities, savedReplacements);
      setPendingReview(detected);
    } else {
      if (scanSkipped && settings.aiPrivacyScan) {
        setProcessError("Sensitivity scan skipped — set your API key in Settings to enable name/company detection.");
      }
      if (action === "generate") await doGenerate(savedReplacements);
      else await doSaveTranscript(savedReplacements);
    }
  }

  async function handleProcess() {
    if (!transcript.trim()) return;
    if (!settings.vaultPath) { setShowSettings(true); return; }
    setProcessError(null);
    setNotes("");
    setSaved(false);
    setSavedPath("");
    setPendingReview(null);
    await runSanitizeDetection("generate");
  }

  async function handleSaveTranscriptButton() {
    if (!transcript.trim()) return;
    if (!settings.vaultPath) { setShowSettings(true); return; }
    setTranscriptSaved(false);
    setTranscriptSavedPath("");
    setPendingReview(null);
    await runSanitizeDetection("saveTranscript");
  }

  // Step 2: user confirms review
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
      updatedSettings = { ...settings, replacements: newReplacements, corrections: newCorrections };
      setSettings(updatedSettings);
      persistBrowserSettings(updatedSettings);
      persistConfig(updatedSettings);
    }

    setPendingReview(null);

    const all = [
      ...(updatedSettings.replacements || []),
      ...confirmed
        .filter((c) => !(updatedSettings.replacements || []).some((r) => r.original === c.text))
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text })),
    ];

    if (pendingAction === "generate") await doGenerate(all);
    else await doSaveTranscript(all);
  }

  function handleReviewSkip() {
    setPendingReview(null);
    const replacements = settings.replacements || [];
    if (pendingAction === "generate") doGenerate(replacements);
    else doSaveTranscript(replacements);
  }

  // Step 3: sanitize + generate
  async function streamGenerateRequest(requestConfig) {
    const { payload, replacements } = requestConfig;
    const controller = new AbortController();
    generationControllerRef.current = controller;

    setLastGenerationRequest(requestConfig);
    setProcessing(true);
    setProcessError(null);
    setNotes("");
    setSaved(false);
    setSavedPath("");
    setTodosSaved(null);

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
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";
      let usage = null;
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
            setNotes(accumulated);
          } else if (evt.type === "done") {
            usage = evt.usage;
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
      if (usage) setNoteCost(calcCost(usage, model));
      const restored = replacements.length ? reverseReplacements(accumulated, replacements) : accumulated;
      setNotes(restored);

      if (settings.transcriptsPath) {
        const correctedTranscript = replacements.length
          ? reverseReplacements(applyReplacements(transcript, replacements), replacements)
          : transcript;
        apiFetch("/api/save-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: correctedTranscript,
            meetingTitle,
            transcriptsPath: settings.transcriptsPath,
            folder: selectedFolder || undefined,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      if (e.name === "AbortError") {
        setProcessError("Generation canceled.");
      } else {
        setProcessError(e.message);
      }
    } finally {
      if (generationControllerRef.current === controller) {
        generationControllerRef.current = null;
      }
      setProcessing(false);
    }
  }

  async function doGenerate(replacements) {
    setActiveReplacements(replacements);
    const corrected = applyCorrections(transcript, settings.corrections || []);
    const correctedTitle = applyCorrections(meetingTitle, settings.corrections || []);
    const sanitizedTranscript = replacements.length
      ? applyReplacements(corrected, replacements)
      : corrected;
    const sanitizedTitle = replacements.length
      ? applyReplacements(correctedTitle, replacements)
      : correctedTitle;

    await streamGenerateRequest({
      payload: {
        transcript: sanitizedTranscript,
        meetingTitle: sanitizedTitle,
        apiKey: settings.apiKey || undefined,
        model,
      },
      replacements,
    });
  }

  function handleCancelGeneration() {
    generationControllerRef.current?.abort();
  }

  function handleRetryGeneration() {
    if (lastGenerationRequest) streamGenerateRequest(lastGenerationRequest);
  }

  function handleNotesChange(nextNotes) {
    setNotes(nextNotes);
    setSaved(false);
    setSavedPath("");
  }

  async function handleSave() {
    if (!notes || !settings.vaultPath) return;
    setSaving(true);
    try {
      const folderPath = await resolveAutoFolder(meetingTitle + " " + notes);
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          vaultPath: settings.vaultPath,
          folderPath,
          meetingTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);

      // Extract todos assigned to Ryley/Riley and append to weekly file
      try {
        const todosRes = await apiFetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes, vaultPath: settings.vaultPath, meetingTitle }),
        });
        const todosData = await todosRes.json();
        if (todosData.count > 0) {
          setTodosSaved({ count: todosData.count, path: todosData.savedPath });
        }
      } catch {
        // Todos extraction is best-effort
      }
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function doSaveTranscript(replacements) {
    if (!transcript.trim() || !settings.vaultPath) return;
    const withCorrections = applyCorrections(transcript, settings.corrections || []);
    const corrected = replacements.length
      ? reverseReplacements(applyReplacements(withCorrections, replacements), replacements)
      : withCorrections;

    setSavingTranscript(true);
    try {
      const title = meetingTitle || "Transcript";
      const folderPath = await resolveAutoFolder(title + " " + corrected);
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: `# ${title}\n\n${corrected}`,
          vaultPath: settings.vaultPath,
          folderPath,
          meetingTitle: title,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setTranscriptSaved(true);
      setTranscriptSavedPath(data.savedPath);

      if (settings.transcriptsPath) {
        apiFetch("/api/save-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: corrected,
            meetingTitle: title,
            transcriptsPath: settings.transcriptsPath,
            folder: folderPath || undefined,
          }),
        }).catch(() => {});
      }
    } catch (e) {
      alert(`Failed to save transcript: ${e.message}`);
    } finally {
      setSavingTranscript(false);
    }
  }

  function handleNewNote() {
    setTranscript("");
    setMeetingTitle("");
    setNotes("");
    setSaved(false);
    setSavedPath("");
    setTodosSaved(null);
    setNoteCost(null);
    setProcessError(null);
    setPendingReview(null);
    setActiveReplacements([]);
    setTranscriptSaved(false);
    setTranscriptSavedPath("");
  }

  async function resolveAutoFolder(content) {
    if (!settings.vaultPath || selectedFolder) return selectedFolder;
    try {
      const res = await apiFetch(`/api/folders?vaultPath=${encodeURIComponent(settings.vaultPath)}`);
      const data = await res.json();
      const folders = (data.folders || []).filter((f) => f.path !== "");
      const matched = matchVaultFolder(content, folders, settings.accounts);
      if (matched) return matched;
      const internal = folders.find((f) => f.name.toLowerCase().includes("internal"));
      return internal?.path || "";
    } catch {
      return selectedFolder;
    }
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setShowSettings(false);
  }

  const canProcess = transcript.trim().length > 0 && !processing && !sanitizing;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        onSettingsClick={() => setShowSettings((v) => !v)}
        isSettingsOpen={showSettings}
        mode={mode}
        onModeChange={handleModeChange}
      />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onSave={handleSaveSettings}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* ── Account Status mode ── */}
        {mode === "status" && (
          <AccountStatus
            settings={settings}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}

        {/* ── SystemLink Status mode ── */}
        {mode === "sl-status" && (
          <SystemLinkStatus
            settings={settings}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}


        {/* ── New Note mode ── */}
        {mode === "new" && (
          notes ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Meeting Notes Ready</h2>
                <button onClick={handleNewNote} className="btn-secondary">New Note</button>
              </div>
              <NotesPreview
                notes={notes}
                onSave={handleSave}
                onNotesChange={handleNotesChange}
                saving={saving}
                saved={saved}
                savedPath={savedPath}
                streaming={processing}
                onCancel={handleCancelGeneration}
                onRetry={handleRetryGeneration}
                canRetry={!!lastGenerationRequest && !processing}
                todosSaved={todosSaved}
                cost={noteCost}
              />
            </div>
          ) : (
            <>
              <MeetingDetails
                meetingTitle={meetingTitle}
                setMeetingTitle={setMeetingTitle}
              />

              <TranscriptInput
                transcript={transcript}
                setTranscript={setTranscript}
                onTitleSuggest={handleTitleSuggest}
              />

              <FolderSelector
                vaultPath={settings.vaultPath}
                selectedFolder={selectedFolder}
                onSelect={setSelectedFolder}
                onSettingsClick={() => setShowSettings(true)}
              />

              {pendingReview && (
                <SanitizeReview
                  detected={pendingReview}
                  savedReplacements={settings.replacements || []}
                  onConfirm={handleReviewConfirm}
                  onSkip={handleReviewSkip}
                />
              )}

              {processError && (
                <div className="card p-4 border-l-4 border-l-red-400">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-red-800">Error</p>
                      <p className="text-sm text-red-700 mt-0.5">{processError}</p>
                    </div>
                  </div>
                </div>
              )}

              {!pendingReview && (
                <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden flex-shrink-0">
                    {[
                      { id: "claude-haiku-4-5", label: "Haiku", sub: "~$0.03" },
                      { id: "claude-sonnet-4-6", label: "Sonnet", sub: "~$0.10" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModel(m.id)}
                        className={`px-3 py-2 text-left transition-colors ${
                          model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <div className="text-xs font-medium leading-tight">{m.label}</div>
                        <div className={`text-xs leading-tight ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</div>
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={handleProcess}
                    disabled={!canProcess}
                    className="btn-primary flex-1 py-3.5 text-base"
                  >
                    {sanitizing ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Scanning for sensitive terms...
                      </>
                    ) : processing ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Analyzing with Claude {model.includes("haiku") ? "Haiku" : "Sonnet"}...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Generate Meeting Notes
                      </>
                    )}
                  </button>
                </div>

                {/* Save transcript only */}
                <div className="flex items-center justify-end gap-2 min-h-[1.5rem]">
                  {transcriptSaved ? (
                    <span className="text-xs text-green-600 flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Transcript saved to <code className="font-mono bg-green-50 px-1 rounded">{transcriptSavedPath}</code>
                    </span>
                  ) : (
                    <button
                      onClick={handleSaveTranscriptButton}
                      disabled={savingTranscript || sanitizing || !transcript.trim() || !settings.vaultPath}
                      className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed underline underline-offset-2"
                    >
                      {savingTranscript ? "Saving..." : sanitizing && pendingAction === "saveTranscript" ? "Scanning for names..." : "Save transcript without generating notes"}
                    </button>
                  )}
                </div>
                </div>
              )}
            </>
          )
        )}
      </main>
    </div>
  );
}
