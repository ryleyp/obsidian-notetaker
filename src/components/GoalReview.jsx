"use client";

import { useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import NotesPreview from "@/components/NotesPreview";
import { apiFetch, approveLocalPaths } from "@/lib/apiClient";
import { calcCost, formatCost, providerLabel, resolveAutoModel } from "@/lib/models";
import { goalGroupsToMarkdown } from "@/lib/goalHarvest";

function toISO(date) {
  return date.toISOString().split("T")[0];
}

function defaultStart() {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return toISO(d);
}

function prettyRange(start, end) {
  const fmt = (iso) => {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };
  return `${fmt(start)} – ${fmt(end)}`;
}

export default function GoalReview({ settings, onSettingsClick }) {
  const [startDate, setStartDate] = useState(defaultStart());
  const [endDate, setEndDate] = useState(toISO(new Date()));
  const [scanning, setScanning] = useState(false);
  const [groups, setGroups] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  const [excluded, setExcluded] = useState(new Set()); // "goal||date||contribution"
  const [instructions, setInstructions] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summary, setSummary] = useState("");
  const [cost, setCost] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [model, setModel] = useState(settings.model || "claude-haiku-4-5");

  const goals = settings.goals || [];
  const resolvedModel = resolveAutoModel(model, { apiKey: settings.apiKey, openaiApiKey: settings.openaiApiKey });

  const itemKey = (goalName, item) => `${goalName}||${item.date}||${item.contribution}`;
  const keptGroups = (groups || []).map((group) => ({
    ...group,
    contributions: group.contributions.filter((item) => !excluded.has(itemKey(group.goal.name, item))),
  }));
  const keptCount = keptGroups.reduce((sum, g) => sum + g.contributions.length, 0);

  function toggleItem(goalName, item) {
    setExcluded((previous) => {
      const next = new Set(previous);
      const key = itemKey(goalName, item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setSummary("");
  }

  async function handleScan() {
    if (!settings.vaultPath) { onSettingsClick(); return; }
    setScanning(true);
    setError("");
    setGroups(null);
    setStats(null);
    setSummary("");
    setSavedPath("");
    setExcluded(new Set());
    try {
      await approveLocalPaths(settings);
      const res = await apiFetch("/api/goal-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scan", vaultPath: settings.vaultPath, goals, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setGroups(data.groups || []);
      setStats(data.stats || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  }

  async function handleSummarize() {
    if (!keptCount) return;
    setSummarizing(true);
    setError("");
    try {
      const res = await apiFetch("/api/goal-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "summarize",
          groups: keptGroups,
          instructions,
          model,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          replacements: settings.replacements || [],
          corrections: settings.corrections || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Summary failed");
      setSummary(data.summary || "");
      if (data.usage) setCost(calcCost(data.usage, data.model));
      setSavedPath("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSummarizing(false);
    }
  }

  // The evidence table always saves; the written summary rides along above it
  // when one has been generated, so the document stands on its own.
  function documentToSave() {
    const evidence = goalGroupsToMarkdown(keptGroups, { rangeLabel: prettyRange(startDate, endDate) });
    if (!summary.trim()) return evidence;
    return `${evidence.split("\n\n---\n\n")[0]}\n\n---\n\n## Review Summary\n\n${summary.trim()}\n\n---\n\n${evidence.split("\n\n---\n\n").slice(1).join("\n\n---\n\n")}`;
  }

  async function handleSave() {
    if (!settings.vaultPath || !keptGroups.length) return;
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: documentToSave(),
          vaultPath: settings.vaultPath,
          folderPath: "",
          meetingTitle: `Performance Review ${endDate}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSavedPath(data.savedPath);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!goals.length) {
    return (
      <div className="card p-6 space-y-3">
        <h3 className="text-base font-semibold text-gray-900">Performance Goals</h3>
        <p className="text-sm text-gray-600">
          No goals configured yet. Add your review goals in Settings — paste them as a list or upload the document —
          and new meeting notes will start recording what contributed to each one.
        </p>
        <button onClick={onSettingsClick} className="btn-primary text-sm">Open Settings</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="card p-6 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Performance Review</h3>
          <p className="text-sm text-gray-500 mt-1">
            Collects the goal contributions your notes already recorded across the whole vault, grouped by goal.
            Reading them takes no AI call — each was reviewed when its note was saved.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">From</span>
            <input type="date" className="input !w-auto text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">To</span>
            <input type="date" className="input !w-auto text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <button onClick={handleScan} disabled={scanning} className="btn-primary text-sm">
            {scanning ? "Scanning vault…" : "Collect contributions"}
          </button>
          <span className="text-xs text-gray-500">{goals.length} goal{goals.length !== 1 ? "s" : ""} configured</span>
        </div>

        {stats && (
          <div className="flex flex-wrap gap-3 text-xs text-gray-500">
            <span>{stats.notesScanned} notes in range</span>
            <span>{stats.notesWithContributions} with contributions</span>
            <span>{stats.contributions} contributions</span>
            <span>{stats.goalsWithEvidence} of {goals.length} goals with evidence</span>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </div>

      {groups && (
        <div className="card p-6 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-base font-semibold text-gray-900">Evidence by goal</h3>
            <span className="text-xs text-gray-500">{keptCount} included{keptCount !== stats?.contributions ? ` of ${stats?.contributions}` : ""}</span>
          </div>

          {groups.map((group) => (
            <div key={group.goal.name} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <strong className="text-sm text-gray-900">{group.goal.name}</strong>
                <span className="text-xs text-gray-500">
                  {group.goal.target ? `target: ${group.goal.target} · ` : ""}
                  {group.contributions.length} recorded
                </span>
              </div>
              {group.unconfigured && (
                <p className="mt-1 text-xs text-amber-700">
                  Recorded in notes but not in your configured goals — rename it in Settings to roll it in.
                </p>
              )}
              {group.contributions.length === 0 ? (
                <p className="mt-2 text-xs text-gray-500">Nothing recorded in this period.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {group.contributions.map((item) => {
                    const off = excluded.has(itemKey(group.goal.name, item));
                    return (
                      <li key={itemKey(group.goal.name, item)} className={`flex gap-2 text-xs ${off ? "opacity-40" : ""}`}>
                        <input
                          type="checkbox"
                          checked={!off}
                          onChange={() => toggleItem(group.goal.name, item)}
                          className="mt-0.5"
                          title="Include this contribution in the review"
                        />
                        <span>
                          <span className="text-gray-400 font-mono">{item.date}</span>{" "}
                          {item.contribution}
                          {item.metric && <strong className="text-gray-900"> — {item.metric}</strong>}
                          <span className="text-gray-400"> · {item.noteTitle}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}

          <div className="border-t border-gray-200 pt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <button onClick={handleSummarize} disabled={summarizing || !keptCount} className="btn-secondary text-sm">
                {summarizing ? `Writing with ${providerLabel(resolvedModel)}…` : "Write review summary"}
              </button>
              <ModelPicker model={model} setModel={setModel} compact ariaLabel="Review summary model" />
              {cost && <span className="text-xs text-gray-400 font-mono">{formatCost(cost)}</span>}
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-gray-600">Optional guidance for the summary</summary>
              <textarea
                className="input text-sm mt-2"
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="For example: emphasize measurable outcomes, keep each goal under 150 words."
              />
            </details>
            <p className="text-xs text-gray-500">
              The summary uses only the contributions ticked above — it cannot add work that is not recorded here.
            </p>
          </div>
        </div>
      )}

      {summary && (
        <NotesPreview
          notes={summary}
          onNotesChange={setSummary}
          onSave={handleSave}
          saving={saving}
          saved={!!savedPath}
          savedPath={savedPath}
          cost={cost}
        />
      )}

      {groups && !summary && keptCount > 0 && (
        <div className="card p-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-gray-600">Save the evidence table on its own, without a written summary.</p>
          <button onClick={handleSave} disabled={saving} className="btn-success text-sm">
            {saving ? "Saving…" : "Save evidence to Obsidian"}
          </button>
        </div>
      )}

      {savedPath && (
        <p className="text-sm text-green-700">
          Saved to <code className="font-mono text-xs bg-green-50 px-1 rounded">{savedPath}</code>
        </p>
      )}
    </div>
  );
}
