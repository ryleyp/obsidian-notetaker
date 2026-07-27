"use client";

import { useRef, useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import { calcCost } from "@/lib/pricing";
import { detectAccount } from "@/lib/accounts";
import { reverseReplacements } from "@/lib/sanitize";
import { apiFetch } from "@/lib/apiClient";

const TODAY = new Date().toISOString().split("T")[0];

const SYNTHESIS_PRICING = {
  "claude-haiku-4-5": { input: 1.0, output: 5.0, label: "Haiku" },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, label: "Sonnet" },
};

const MODEL_CONTEXT = {
  "claude-opus-4-8": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-haiku-4-5": 200_000,
};

function contextLimit(model) {
  return MODEL_CONTEXT[model] || 200_000;
}

function threeMonthsAgoLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function estimateUsage(notes, model) {
  const chars = notes.reduce((s, n) => s + (n.content?.length || 0) + (n.title?.length || 0), 0);
  const inputTokens = Math.ceil(chars / 4) + 2500;
  const outputTokens = 2500;
  const p = SYNTHESIS_PRICING[model] || SYNTHESIS_PRICING["claude-sonnet-4-6"];
  const cost = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
  return { inputTokens, outputTokens, cost, label: p.label };
}

export default function AccountStatus({ settings, onSettingsClick }) {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [loadedNotes, setLoadedNotes] = useState(null);
  const [loadCounts, setLoadCounts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [vaultScan, setVaultScan] = useState(null); // { results, total } | null
  const [vaultScanOpen, setVaultScanOpen] = useState(false);

  const [synthesizing, setSynthesizing] = useState(false);
  const [synthError, setSynthError] = useState(null);
  const [output, setOutput] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [synthCost, setSynthCost] = useState(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [summarizedCount, setSummarizedCount] = useState(0);
  const synthControllerRef = useRef(null);
  const [lastSynthesisRequest, setLastSynthesisRequest] = useState(null);

  async function handleLoadNotes() {
    if (!settings.vaultPath) return;
    setLoading(true);
    setLoadError(null);
    setLoadedNotes(null);
    setLoadCounts(null);
    setOutput("");
    setSaved(false);
    setShowConfirm(false);
    setVaultScan(null);
    setVaultScanOpen(false);

    try {
      const { name: accountName, archiveFolder, aliases } = detectAccount(selectedFolder, settings.accounts);
      const params = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (selectedFolder) params.set("folderPath", selectedFolder);
      if (aliases?.length) params.set("accountAliases", aliases.join(","));

      // Fire notes load and vault-wide scan in parallel
      const scanParams = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (settings.transcriptsPath) scanParams.set("transcriptsPath", settings.transcriptsPath);
      if (settings.accounts?.length) scanParams.set("accounts", JSON.stringify(
        // Only scan for the detected account, not all accounts
        [{ name: accountName, archiveFolder, aliases: aliases || [] }]
      ));

      const [notesRes, scanRes] = await Promise.all([
        apiFetch(`/api/notes?${params}`),
        aliases?.length ? apiFetch(`/api/scan-vault?${scanParams}`) : Promise.resolve(null),
      ]);

      const notesData = await notesRes.json();
      if (!notesRes.ok) throw new Error(notesData.error || "Failed to load notes");
      setLoadedNotes(notesData.notes);
      setLoadCounts(notesData.counts);

      if (scanRes) {
        const scanData = await scanRes.json();
        if (scanRes.ok && scanData.results?.[0]?.files?.length) {
          setVaultScan({ files: scanData.results[0].files, total: scanData.total });
        }
      }
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runSynthesisRequest(requestPayload) {
    const controller = new AbortController();
    synthControllerRef.current = controller;
    setLastSynthesisRequest(requestPayload);
    setSynthesizing(true);
    setSynthError(null);
    setOutput("");
    setSaved(false);
    setShowConfirm(false);
    setDroppedCount(0);
    setSummarizedCount(0);

    try {
      const res = await apiFetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Synthesis failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

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
            setOutput(accumulated);
          } else if (evt.type === "done") {
            const reps = settings.replacements || [];
            setOutput(reps.length ? reverseReplacements(accumulated, reps) : accumulated);
            if (evt.usage) setSynthCost(calcCost(evt.usage, evt.model));
            if (evt.droppedCount) setDroppedCount(evt.droppedCount);
            if (evt.summarizedCount) setSummarizedCount(evt.summarizedCount);
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
    } catch (e) {
      setSynthError(e.name === "AbortError" ? "Synthesis canceled." : e.message);
    } finally {
      if (synthControllerRef.current === controller) {
        synthControllerRef.current = null;
      }
      setSynthesizing(false);
    }
  }

  async function handleSynthesize() {
    if (!loadedNotes?.length) return;
    await runSynthesisRequest({
      notes: loadedNotes,
      apiKey: settings.apiKey || undefined,
      model,
      today: TODAY,
      replacements: settings.replacements || [],
      corrections: settings.corrections || [],
      accountName: detectAccount(selectedFolder, settings.accounts).name,
      allAccounts: settings.accounts || [],
    });
  }

  function handleCancelSynthesis() {
    synthControllerRef.current?.abort();
  }

  function handleRetrySynthesis() {
    if (lastSynthesisRequest) runSynthesisRequest(lastSynthesisRequest);
  }

  function handleOutputChange(nextOutput) {
    setOutput(nextOutput);
    setSaved(false);
    setSavedPath("");
  }

  async function handleSave() {
    if (!output || !settings.vaultPath) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: output,
          vaultPath: settings.vaultPath,
          folderPath: selectedFolder,
          meetingTitle: `Account Status ${TODAY}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setLoadedNotes(null);
    setLoadCounts(null);
    setOutput("");
    setSaved(false);
    setSavedPath("");
    setSynthError(null);
    setLoadError(null);
    setShowConfirm(false);
    setVaultScan(null);
    setVaultScanOpen(false);
  }

  const [model, setModel] = useState(settings.model || "claude-haiku-4-5");

  const folderLabel = selectedFolder || "(Vault root)";

  return (
    <div className="space-y-4">
      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={selectedFolder}
        onSelect={(f) => { setSelectedFolder(f); setLoadedNotes(null); setOutput(""); setShowConfirm(false); setVaultScan(null); setVaultScanOpen(false); }}
        onSettingsClick={onSettingsClick}
      />

      {settings.vaultPath && !output && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Quarter Range</h3>
              <p className="text-sm text-gray-500">
                Scanning <span className="font-medium text-gray-700">{folderLabel}</span> for notes dated{" "}
                <span className="font-medium text-gray-700">{threeMonthsAgoLabel()}</span> or later.
              </p>

              {loadedNotes !== null && (
                <div className="mt-3">
                  {loadedNotes.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No notes with dates in the past 3 months found in this folder.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-green-700">
                        Found {loadedNotes.length} note{loadedNotes.length !== 1 ? "s" : ""} in the past quarter
                      </p>
                      {loadCounts && (
                        <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                          {loadCounts.obsidian > 0 && <span>📝 {loadCounts.obsidian} Obsidian</span>}
                          {loadCounts.crossVault > 0 && <span>🔍 {loadCounts.crossVault} Cross-folder</span>}
                        </div>
                      )}
                      <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                        {loadedNotes.map((n) => (
                          <li key={n.filename} className="flex gap-2">
                            <span className="font-mono text-gray-400 flex-shrink-0">{n.date}</span>
                            <span className="truncate">{n.title}</span>
                            {n.source !== "obsidian" && (
                              <span className="text-gray-400 flex-shrink-0 italic">{n.sourceLabel}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {vaultScan && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => setVaultScanOpen((v) => !v)}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <svg className={`w-3.5 h-3.5 transition-transform ${vaultScanOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        🗃 {vaultScan.files.length} file{vaultScan.files.length !== 1 ? "s" : ""} mention this account across all time
                      </button>
                      {vaultScanOpen && (
                        <ul className="mt-1.5 text-xs text-gray-500 space-y-0.5 max-h-40 overflow-y-auto pl-5">
                          {vaultScan.files.map((f, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="font-mono text-gray-400 flex-shrink-0">{f.date || "—"}</span>
                              <span className="truncate">{f.title}</span>
                              <span className="text-gray-400 flex-shrink-0 italic">{f.location}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {loadError && (
                <p className="mt-2 text-sm text-red-600">{loadError}</p>
              )}
            </div>

            <button
              onClick={handleLoadNotes}
              disabled={loading || !settings.vaultPath}
              className="btn-secondary whitespace-nowrap"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning...
                </>
              ) : loadedNotes !== null ? "Re-scan" : "Scan Folder"}
            </button>
          </div>

          {loadedNotes?.length > 0 && !showConfirm && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-gray-500 font-medium">Model</span>
                <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                  {[
                    { id: "claude-haiku-4-5", label: "Haiku", sub: "Faster · 200k" },
                    { id: "claude-sonnet-4-6", label: "Sonnet", sub: "Best · 1M ctx" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={`px-3 py-1.5 text-left transition-colors ${
                        model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <div className="text-xs font-medium leading-tight">{m.label}</div>
                      <div className={`text-xs leading-tight ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              {synthError && (
                <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                  {synthError}
                </p>
              )}
              <button
                onClick={() => setShowConfirm(true)}
                disabled={synthesizing}
                className="btn-primary w-full py-3 text-base"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Generate Account Status
              </button>
            </div>
          )}

          {loadedNotes?.length > 0 && showConfirm && (() => {
            const est = estimateUsage(loadedNotes, model);
            const limit = contextLimit(model);
            const warnAt = limit - 20_000; // leave room for output + overhead
            return (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-800">Pre-flight check</h4>
                  <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                    {[
                      { id: "claude-haiku-4-5", label: "Haiku", sub: "200k" },
                      { id: "claude-sonnet-4-6", label: "Sonnet", sub: "1M" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModel(m.id)}
                        className={`px-3 py-1 text-left transition-colors ${
                          model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-xs font-medium">{m.label}</span>
                        <span className={`text-xs ml-1 ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm">
                  {loadCounts && (
                    <div className="flex gap-4 text-xs text-gray-600">
                      {loadCounts.obsidian > 0 && <span>📝 {loadCounts.obsidian} Obsidian</span>}
                      {loadCounts.crossVault > 0 && <span>🔍 {loadCounts.crossVault} Cross-folder</span>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <span className="text-gray-500">Est. input</span>
                    <span className={`font-mono ${est.inputTokens > warnAt ? "text-red-600 font-semibold" : "text-gray-700"}`}>~{est.inputTokens.toLocaleString()} tokens</span>
                    <span className="text-gray-500">Est. output</span>
                    <span className="font-mono text-gray-700">~{est.outputTokens.toLocaleString()} tokens</span>
                    <span className="text-gray-500">Context limit</span>
                    <span className="font-mono text-gray-700">{(limit / 1000).toLocaleString()}k tokens ({est.label})</span>
                    <span className="text-gray-500">Est. cost</span>
                    <span className="font-mono text-gray-700">~${est.cost.toFixed(4)}</span>
                  </div>
                  {est.inputTokens > warnAt && (
                    <p className="text-xs text-red-700 font-medium">
                      Input is near or over this model's {(limit / 1000).toLocaleString()}k token limit — oldest notes will be trimmed automatically to fit. Switch to Sonnet above to include more notes.
                    </p>
                  )}
                  <p className="text-xs text-amber-700">
                    Sanitized note content will be sent to Claude. Names in your glossary are replaced before sending.
                  </p>
                </div>
                <div className="flex gap-3 mt-3">
                  <button onClick={() => setShowConfirm(false)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <button
                    onClick={handleSynthesize}
                    disabled={synthesizing}
                    className="btn-primary flex-1 py-3"
                  >
                    {synthesizing ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Synthesizing…
                      </>
                    ) : "Confirm — Send to Claude"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {(output || synthesizing) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {synthesizing ? "Generating…" : "Account Status Ready"}
              </h2>
              {synthesizing && (
                <svg className="animate-spin w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
            {!synthesizing && <button onClick={handleReset} className="btn-secondary">Start Over</button>}
          </div>
          {droppedCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {droppedCount} compressed source{droppedCount !== 1 ? "s" : ""} still could not fit within the model's context limit.
            </p>
          )}
          {summarizedCount > 0 && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              {summarizedCount} older note{summarizedCount !== 1 ? "s" : ""} were compressed first so newer full notes and older context could both inform the report.
            </p>
          )}
          {output && (
            <NotesPreview
              notes={output}
              onNotesChange={handleOutputChange}
              onSave={handleSave}
              saving={saving}
              saved={saved}
              savedPath={savedPath}
              cost={synthCost}
              streaming={synthesizing}
              onCancel={handleCancelSynthesis}
              onRetry={handleRetrySynthesis}
              canRetry={!!lastSynthesisRequest && !synthesizing}
            />
          )}
          {synthesizing && !output && (
            <div className="card p-6 text-sm text-gray-500 animate-pulse">Waiting for Claude…</div>
          )}
        </div>
      )}
    </div>
  );
}
