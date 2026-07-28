"use client";

import { useRef, useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import { calcCost, contextLimit, estimateUsage } from "@/lib/models";
import { detectAccount } from "@/lib/accounts";
import { applyCorrections, mergeCorrections, reverseReplacements } from "@/lib/sanitize";
import { apiFetch } from "@/lib/apiClient";

const TODAY = new Date().toISOString().split("T")[0];

// Stakeholder maps run longer than the default note summary.
const ESTIMATED_OUTPUT_TOKENS = 4000;

function threeMonthsAgoLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function StakeholderMap({ settings, onSettingsClick, onSettingsPatch }) {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [loadedSources, setLoadedSources] = useState(null);
  const [loadCounts, setLoadCounts] = useState(null);
  const [loadWarning, setLoadWarning] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [strictFolderOnly, setStrictFolderOnly] = useState(false);

  const [mapping, setMapping] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [output, setOutput] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [mapCost, setMapCost] = useState(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const mapControllerRef = useRef(null);
  const [lastMapRequest, setLastMapRequest] = useState(null);
  const [model, setModel] = useState(settings.model || "claude-haiku-4-5");
  const [newFind, setNewFind] = useState("");
  const [newReplace, setNewReplace] = useState("");

  const corrections = settings.corrections || [];

  function updateCorrections(nextCorrections) {
    if (!onSettingsPatch) return;
    onSettingsPatch({ corrections: nextCorrections });
    setLastMapRequest((request) => request ? { ...request, corrections: nextCorrections } : request);
  }

  function handleAddCorrection() {
    const find = newFind.trim();
    if (!find) return;
    const addition = { find, replace: newReplace };
    const nextCorrections = mergeCorrections(corrections, [addition]);
    updateCorrections(nextCorrections);
    setNewFind("");
    setNewReplace("");
    if (output) {
      setOutput((current) => applyCorrections(current, [addition]));
      setSaved(false);
      setSavedPath("");
    }
  }

  function handleRemoveCorrection(index) {
    updateCorrections(corrections.filter((_, i) => i !== index));
  }

  function handleStrictFolderOnlyChange(checked) {
    setStrictFolderOnly(checked);
    setLoadedSources(null);
    setLoadCounts(null);
    setLoadWarning(null);
    setLoadError(null);
    setOutput("");
    setSaved(false);
    setSavedPath("");
    setShowConfirm(false);
    setDroppedCount(0);
  }

  async function handleLoadSources() {
    if (!settings.vaultPath) return;
    setLoading(true);
    setLoadError(null);
    setLoadWarning(null);
    setLoadedSources(null);
    setLoadCounts(null);
    setOutput("");
    setSaved(false);
    setShowConfirm(false);
    setDroppedCount(0);

    try {
      const { aliases } = detectAccount(selectedFolder, settings.accounts);
      const params = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (selectedFolder) params.set("folderPath", selectedFolder);
      if (!strictFolderOnly && aliases?.length) params.set("accountAliases", aliases.join(","));

      const res = await apiFetch(`/api/notes?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sources");

      setLoadedSources(data.notes || []);
      setLoadCounts(data.counts);
      setLoadWarning(data.warning || null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function runMapRequest(requestPayload) {
    const controller = new AbortController();
    mapControllerRef.current = controller;
    setLastMapRequest(requestPayload);
    setMapping(true);
    setMapError(null);
    setOutput("");
    setSaved(false);
    setShowConfirm(false);
    setDroppedCount(0);

    try {
      const res = await apiFetch("/api/stakeholder-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Mapping failed");
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
            const reps = requestPayload.replacements || settings.replacements || [];
            const requestCorrections = requestPayload.corrections || settings.corrections || [];
            const restored = reps.length ? reverseReplacements(accumulated, reps) : accumulated;
            setOutput(applyCorrections(restored, requestCorrections));
            if (evt.usage) setMapCost(calcCost(evt.usage, evt.model));
            if (evt.droppedCount) setDroppedCount(evt.droppedCount);
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
    } catch (e) {
      setMapError(e.name === "AbortError" ? "Mapping canceled." : e.message);
    } finally {
      if (mapControllerRef.current === controller) {
        mapControllerRef.current = null;
      }
      setMapping(false);
    }
  }

  async function handleGenerateMap() {
    if (!loadedSources?.length) return;
    const account = detectAccount(selectedFolder, settings.accounts);
    await runMapRequest({
      notes: loadedSources,
      apiKey: settings.apiKey || undefined,
      model,
      today: TODAY,
      replacements: settings.replacements || [],
      corrections: settings.corrections || [],
      accountName: account.name,
      allAccounts: settings.accounts || [],
    });
  }

  function handleCancelMapping() {
    mapControllerRef.current?.abort();
  }

  function handleRetryMapping() {
    if (lastMapRequest) runMapRequest(lastMapRequest);
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
          meetingTitle: `Customer Site Mapping ${TODAY}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);
    } catch (e) {
      alert(`Failed to save mapping: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setLoadedSources(null);
    setLoadCounts(null);
    setLoadWarning(null);
    setOutput("");
    setSaved(false);
    setSavedPath("");
    setMapError(null);
    setLoadError(null);
    setShowConfirm(false);
    setDroppedCount(0);
  }

  const folderLabel = selectedFolder || "(Vault root)";

  return (
    <div className="space-y-4">
      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={selectedFolder}
        onSelect={(f) => { setSelectedFolder(f); setLoadedSources(null); setOutput(""); setShowConfirm(false); setLoadWarning(null); }}
        onSettingsClick={onSettingsClick}
      />

      {settings.vaultPath && (
        <div className="card p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Mapping Corrections</h3>
              <p className="text-xs text-gray-500">
                Applied to source notes before anonymization, then to the generated map before saving.
              </p>
            </div>
            {corrections.length > 0 && (
              <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-1 whitespace-nowrap">
                {corrections.length} rule{corrections.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {corrections.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {corrections.map((correction, i) => (
                <div key={`${correction.find}-${i}`} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <span className="font-medium text-gray-800 flex-1 truncate">{correction.find}</span>
                  <span className="text-gray-400">-&gt;</span>
                  <span className="font-medium text-gray-800 flex-1 truncate">
                    {correction.replace || <em className="text-gray-400">(delete)</em>}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCorrection(i)}
                    disabled={mapping}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-50 ml-1"
                    aria-label={`Remove correction for ${correction.find}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              type="text"
              className="input"
              placeholder="Find"
              value={newFind}
              onChange={(e) => setNewFind(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCorrection()}
              disabled={mapping}
            />
            <input
              type="text"
              className="input"
              placeholder="Replace with"
              value={newReplace}
              onChange={(e) => setNewReplace(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCorrection()}
              disabled={mapping}
            />
            <button
              type="button"
              onClick={handleAddCorrection}
              disabled={!newFind.trim() || mapping || !onSettingsPatch}
              className="btn-secondary whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {settings.vaultPath && !output && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Customer & Site Mapping</h3>
              <p className="text-sm text-gray-500">
                Scanning Obsidian meeting notes in <span className="font-medium text-gray-700">{folderLabel}</span>
                {" "}for sources dated <span className="font-medium text-gray-700">{threeMonthsAgoLabel()}</span> or later.
              </p>
              <label className={`flex items-center gap-1.5 text-xs mt-2 ${loading || mapping ? "text-gray-300" : "text-gray-500 cursor-pointer"}`}>
                <input
                  type="checkbox"
                  checked={strictFolderOnly}
                  disabled={loading || mapping}
                  onChange={(e) => handleStrictFolderOnlyChange(e.target.checked)}
                  className="accent-obsidian-600"
                />
                Account folder only
                <span title="Skips cross-folder search for a faster, stricter scan. Re-scan after changing.">i</span>
              </label>

              {loadedSources !== null && (
                <div className="mt-3">
                  {loadedSources.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No Obsidian meeting notes with dates in the past 3 months found.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-green-700">
                        Found {loadedSources.length} source{loadedSources.length !== 1 ? "s" : ""} for mapping
                      </p>
                      {loadCounts && (
                        <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                          {loadCounts.obsidian > 0 && <span>{loadCounts.obsidian} account-folder note{loadCounts.obsidian !== 1 ? "s" : ""}</span>}
                          {loadCounts.crossVault > 0 && <span>{loadCounts.crossVault} cross-folder note{loadCounts.crossVault !== 1 ? "s" : ""}</span>}
                        </div>
                      )}
                      <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                        {loadedSources.map((n, i) => (
                          <li key={`${n.source}-${n.sourceLabel}-${n.filename}-${i}`} className="flex gap-2">
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

                  {loadWarning && (
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                      {loadWarning}
                    </p>
                  )}
                </div>
              )}

              {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
            </div>

            <button
              onClick={handleLoadSources}
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
              ) : loadedSources !== null ? "Re-scan" : "Scan Sources"}
            </button>
          </div>

          {loadedSources?.length > 0 && !showConfirm && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-gray-500 font-medium">Model</span>
                <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                  {[
                    { id: "claude-haiku-4-5", label: "Haiku", sub: "Faster - 200k" },
                    { id: "claude-sonnet-5", label: "Sonnet", sub: "Best - 1M ctx" },
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
              {mapError && (
                <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                  {mapError}
                </p>
              )}
              <button
                onClick={() => setShowConfirm(true)}
                disabled={mapping}
                className="btn-primary w-full py-3 text-base"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.828 0l-4.243-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Generate Customer & Site Map
              </button>
            </div>
          )}

          {loadedSources?.length > 0 && showConfirm && (() => {
            const est = estimateUsage(loadedSources, model, ESTIMATED_OUTPUT_TOKENS);
            const limit = contextLimit(model);
            const warnAt = limit - 20_000;
            return (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-800">Pre-flight check</h4>
                  <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                    {[
                      { id: "claude-haiku-4-5", label: "Haiku", sub: "200k" },
                      { id: "claude-sonnet-5", label: "Sonnet", sub: "1M" },
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
                  <p className="text-xs text-gray-600">
                    Sending <strong>{loadedSources.length}</strong> account source{loadedSources.length !== 1 ? "s" : ""} to Claude for customer and site mapping.
                  </p>
                  {loadCounts && (
                    <div className="flex gap-4 text-xs text-gray-600 flex-wrap">
                      {loadCounts.obsidian > 0 && <span>{loadCounts.obsidian} account-folder note{loadCounts.obsidian !== 1 ? "s" : ""}</span>}
                      {loadCounts.crossVault > 0 && <span>{loadCounts.crossVault} cross-folder note{loadCounts.crossVault !== 1 ? "s" : ""}</span>}
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
                      Input is near or over this model's {(limit / 1000).toLocaleString()}k token limit. Oldest sources will be trimmed automatically to fit.
                    </p>
                  )}
                  <p className="text-xs text-amber-700">
                    Sanitized source content will be sent to Claude. Names in your glossary are replaced before sending and restored afterward.
                  </p>
                </div>
                <div className="flex gap-3 mt-3">
                  <button onClick={() => setShowConfirm(false)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <button onClick={handleGenerateMap} disabled={mapping} className="btn-primary flex-1 py-3">
                    {mapping ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Mapping...
                      </>
                    ) : "Confirm - Send to Claude"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {(output || mapping) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {mapping ? "Generating..." : "Customer & Site Map Ready"}
              </h2>
              {mapping && (
                <svg className="animate-spin w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
            {!mapping && <button onClick={handleReset} className="btn-secondary">Start Over</button>}
          </div>
          {droppedCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {droppedCount} source{droppedCount !== 1 ? "s" : ""} could not fit within the model's context limit.
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
              cost={mapCost}
              streaming={mapping}
              onCancel={handleCancelMapping}
              onRetry={handleRetryMapping}
              canRetry={!!lastMapRequest && !mapping}
            />
          )}
          {mapping && !output && (
            <div className="card p-6 text-sm text-gray-500 animate-pulse">Waiting for Claude...</div>
          )}
        </div>
      )}
    </div>
  );
}
