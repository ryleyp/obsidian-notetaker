"use client";

import { useState } from "react";
import { DEFAULT_ACCOUNTS } from "@/lib/accounts";
import { apiFetch, approveLocalPaths } from "@/lib/apiClient";

export default function SettingsPanel({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    vaultPath: settings.vaultPath || "",
    transcriptsPath: settings.transcriptsPath || "",
    apiKey: settings.apiKey || "",
    aiPrivacyScan: settings.aiPrivacyScan !== false,
    model: settings.model || "claude-haiku-4-5",
    replacements: settings.replacements || [],
    corrections: settings.corrections || [],
    // Edit aliases as a comma-separated string; split into an array on save.
    accounts: (settings.accounts?.length ? settings.accounts : DEFAULT_ACCOUNTS).map((a) => ({
      name: a.name || "",
      archiveFolder: a.archiveFolder || "",
      aliasesText: (a.aliases || []).join(", "),
      keywordsText: (a.keywords || []).join(", "),
    })),
  });
  const [newFind, setNewFind] = useState("");
  const [newReplace, setNewReplace] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [newOriginal, setNewOriginal] = useState("");
  const [newAlias, setNewAlias] = useState("");

  function handleChange(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setTestResult(null);
  }

  async function handleTestVault() {
    if (!form.vaultPath.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      await approveLocalPaths({
        vaultPath: form.vaultPath.trim(),
        transcriptsPath: form.transcriptsPath.trim(),
      });
      const res = await apiFetch(`/api/folders?vaultPath=${encodeURIComponent(form.vaultPath.trim())}`);
      const data = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, message: `Found ${data.folders.length} folders in vault.` });
      } else {
        setTestResult({ ok: false, message: data.error });
      }
    } catch {
      setTestResult({ ok: false, message: "Could not connect to server." });
    } finally {
      setTesting(false);
    }
  }

  function addReplacement() {
    const orig = newOriginal.trim();
    const alias = newAlias.trim();
    if (!orig || !alias) return;
    if (form.replacements.some((r) => r.original.toLowerCase() === orig.toLowerCase())) return;
    setForm((f) => ({ ...f, replacements: [...f.replacements, { original: orig, alias }] }));
    setNewOriginal("");
    setNewAlias("");
  }

  function removeReplacement(i) {
    setForm((f) => ({ ...f, replacements: f.replacements.filter((_, idx) => idx !== i) }));
  }

  function addCorrection() {
    const find = newFind.trim();
    if (!find) return;
    setForm((f) => ({ ...f, corrections: [...f.corrections, { find, replace: newReplace }] }));
    setNewFind("");
    setNewReplace("");
  }

  function removeCorrection(i) {
    setForm((f) => ({ ...f, corrections: f.corrections.filter((_, idx) => idx !== i) }));
  }

  function updateAccount(i, field, value) {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)),
    }));
  }

  function addAccount() {
    setForm((f) => ({ ...f, accounts: [...f.accounts, { name: "", archiveFolder: "", aliasesText: "", keywordsText: "" }] }));
  }

  function removeAccount(i) {
    setForm((f) => ({ ...f, accounts: f.accounts.filter((_, idx) => idx !== i) }));
  }

  function handleSave() {
    const accounts = form.accounts
      .filter((a) => a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        archiveFolder: a.archiveFolder.trim(),
        aliases: a.aliasesText.split(",").map((s) => s.trim()).filter(Boolean),
        keywords: a.keywordsText.split(",").map((s) => s.trim()).filter(Boolean),
      }));
    onSave({
      vaultPath: form.vaultPath.trim(),
      transcriptsPath: form.transcriptsPath.trim(),
      apiKey: form.apiKey.trim(),
      aiPrivacyScan: form.aiPrivacyScan,
      model: form.model,
      replacements: form.replacements,
      corrections: form.corrections,
      accounts,
    });
  }

  return (
    <div className="card p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="section-header mb-0">Settings</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-5">
        <div>
          <label className="label">Obsidian Vault Path</label>
          <p className="text-xs text-gray-500 mb-2">
            The full path to your Obsidian vault folder on your machine. Example:{" "}
            <code className="bg-gray-100 px-1 rounded">/Users/yourname/Documents/MyVault</code>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="/Users/yourname/Documents/MyVault"
              value={form.vaultPath}
              onChange={(e) => handleChange("vaultPath", e.target.value)}
            />
            <button
              className="btn-secondary whitespace-nowrap"
              onClick={handleTestVault}
              disabled={testing || !form.vaultPath.trim()}
            >
              {testing ? "Testing..." : "Test Path"}
            </button>
          </div>
          {testResult && (
            <p className={`mt-2 text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.message}
            </p>
          )}
        </div>

        <div>
          <label className="label">Transcripts Archive Path</label>
          <p className="text-xs text-gray-500 mb-2">
            Folder where raw transcripts are saved after each generation. Subfolders are created automatically by account (LM Transcripts, L3 Transcripts, NGC Transcripts, Frontgrade Transcripts, Internal Transcripts).
          </p>
          <input
            type="text"
            className="input"
            placeholder="/Users/yourname/Documents/Claude"
            value={form.transcriptsPath}
            onChange={(e) => handleChange("transcriptsPath", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Anthropic API Key</label>
          <p className="text-xs text-gray-500 mb-2">
            Your API key from{" "}
            <span className="font-medium">console.anthropic.com</span>. Stored only for this browser session.
            Alternatively, set <code className="bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code> in{" "}
            <code className="bg-gray-100 px-1 rounded">.env.local</code>.
          </p>
          <input
            type="password"
            className="input"
            placeholder="sk-ant-..."
            value={form.apiKey}
            onChange={(e) => handleChange("apiKey", e.target.value)}
          />
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded accent-obsidian-600"
            checked={form.aiPrivacyScan}
            onChange={(e) => handleChange("aiPrivacyScan", e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">Use Claude to detect new sensitive terms</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Saved replacements are applied first. New, unsaved names may be sent to Claude during this scan; turn this off to use only your saved/manual replacements.
            </span>
          </span>
        </label>

        <div>
          <label className="label">Default Model</label>
          <p className="text-xs text-gray-500 mb-2">
            Sonnet is more accurate; Haiku is ~3× cheaper (~$0.03/transcript vs ~$0.10).
          </p>
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden w-fit">
            {[
              { id: "claude-haiku-4-5", label: "Haiku 4.5", sub: "3× cheaper · 200k ctx" },
              { id: "claude-sonnet-4-6", label: "Sonnet 4.6", sub: "Best quality · 1M ctx" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => handleChange("model", m.id)}
                className={`px-4 py-2 text-left transition-colors ${
                  form.model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                <div className="text-xs font-medium">{m.label}</div>
                <div className={`text-xs ${form.model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Privacy Replacements</label>
          <p className="text-xs text-gray-500 mb-3">
            These terms are always anonymized before sending transcripts to Claude. You can also add terms during the per-transcript review.
          </p>

          {form.replacements.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {form.replacements.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <span className="font-medium text-gray-800 flex-1">{r.original}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-mono text-xs text-obsidian-700 bg-obsidian-50 px-1.5 py-0.5 rounded">{r.alias}</span>
                  <button
                    onClick={() => removeReplacement(i)}
                    className="text-gray-400 hover:text-red-500 ml-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="Original (e.g. Lockheed)"
              value={newOriginal}
              onChange={(e) => setNewOriginal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReplacement()}
            />
            <input
              type="text"
              className="input w-36"
              placeholder="Alias (e.g. ORG_A)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReplacement()}
            />
            <button
              onClick={addReplacement}
              disabled={!newOriginal.trim() || !newAlias.trim()}
              className="btn-secondary whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="label">Common Corrections</label>
          <p className="text-xs text-gray-500 mb-3">
            Automatically fix recurring transcription errors before generating or saving (e.g. voice memo mishears "in" as "NI").
          </p>

          {form.corrections.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {form.corrections.map((c, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <span className="font-medium text-gray-800 flex-1">{c.find}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-medium text-gray-800 flex-1">{c.replace || <em className="text-gray-400">(delete)</em>}</span>
                  <button onClick={() => removeCorrection(i)} className="text-gray-400 hover:text-red-500 ml-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="Find (e.g. in NI)"
              value={newFind}
              onChange={(e) => setNewFind(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCorrection()}
            />
            <input
              type="text"
              className="input flex-1"
              placeholder="Replace with (e.g. NI)"
              value={newReplace}
              onChange={(e) => setNewReplace(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCorrection()}
            />
            <button
              onClick={addCorrection}
              disabled={!newFind.trim()}
              className="btn-secondary whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="label">Accounts</label>
          <p className="text-xs text-gray-500 mb-3">
            Each account maps name aliases to a transcript archive subfolder. Aliases drive
            cross-folder search and auto-filing of vault-root notes. Keywords are account-specific
            terms (e.g. program names, product lines) that will be excluded from other accounts'
            summaries.
          </p>

          <div className="space-y-3">
            {form.accounts.map((a, i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="Account name (e.g. Northrop Grumman)"
                    value={a.name}
                    onChange={(e) => updateAccount(i, "name", e.target.value)}
                  />
                  <button
                    onClick={() => removeAccount(i)}
                    className="text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Remove account"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <input
                  type="text"
                  className="input"
                  placeholder="Archive folder (e.g. NGC Transcripts)"
                  value={a.archiveFolder}
                  onChange={(e) => updateAccount(i, "archiveFolder", e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Aliases, comma-separated (e.g. northrop, ngc)"
                  value={a.aliasesText}
                  onChange={(e) => updateAccount(i, "aliasesText", e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Keywords to exclude from other accounts (e.g. F-35, skunk works)"
                  value={a.keywordsText}
                  onChange={(e) => updateAccount(i, "keywordsText", e.target.value)}
                />
              </div>
            ))}
          </div>

          <button onClick={addAccount} className="btn-secondary mt-3">
            + Add account
          </button>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}
