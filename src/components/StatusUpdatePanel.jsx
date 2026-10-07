"use client";

import { useState } from "react";
import ModelPicker from "@/components/ModelPicker";
import SanitizeReview from "@/components/SanitizeReview";
import { apiFetch } from "@/lib/apiClient";
import { calcCost, FAST_MODEL, formatCost } from "@/lib/models";
import { aliasesFromReplacements } from "@/lib/privacy";
import { applyCorrections, applyReplacements, assignAliases, correctionFromRestoredItem } from "@/lib/sanitize";
import { shareableStatusText, STATUS_WINDOW_LABEL } from "@/lib/statusUpdate";

// The short status update the CSM sends upward: a status paragraph, a risk
// line, and a next step. Lives on the SL Status tab because that is where the
// account's recent SystemLink notes have already been gathered.
//
// Two things the spec is firm about and this panel enforces in the UI: the
// "Other risks considered" list is never part of what gets copied, and the
// notes go out pseudonymized, so new names are confirmed before anything is
// sent.
export default function StatusUpdatePanel({
  settings,
  notes,
  accountName,
  productFocus = "",
  allAccounts = [],
  restoredIds,
  onSettingsPatch,
}) {
  const [open, setOpen] = useState(false);
  const [divisions, setDivisions] = useState("");
  const [priorUpdate, setPriorUpdate] = useState("");
  const [includeRisk, setIncludeRisk] = useState(true);
  const [includeNextStep, setIncludeNextStep] = useState(true);
  const [model, setModel] = useState(settings.model || FAST_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [pendingReview, setPendingReview] = useState(null);

  const today = new Date().toISOString().slice(0, 10);
  const shareable = result ? shareableStatusText(result.update) : "";

  async function generate(replacements) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await apiFetch("/api/status-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          account: accountName,
          accountName,
          allAccounts,
          productFocus,
          divisionsOrSites: divisions,
          priorUpdate,
          today,
          includeRisk,
          includeNextStep,
          knownNames: settings.ownerNames || [],
          replacements,
          corrections: settings.corrections || [],
          restoredIds: [...(restoredIds || [])],
          model,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Status update failed");
      setResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // The same pseudonymization gate the note and email flows use: scan the
  // text that is about to leave, and confirm anything new before it does.
  async function runWithSanitizeGate() {
    if (!notes?.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    const savedReplacements = settings.replacements || [];
    const corrections = settings.corrections || [];
    const pre = (text) => applyReplacements(applyCorrections(String(text || ""), corrections), savedReplacements);
    const scanText = [pre(priorUpdate), ...notes.map((note) => pre(note.content))].filter((part) => part.trim()).join("\n\n");

    let detected = [];
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
        detected = data.entities || [];
      } catch (err) {
        scanSkipped = true;
        scanError = err?.message || "the scan could not be reached";
      }
    }
    setBusy(false);

    if (detected.length > 0) {
      if (truncated) setNotice("The sensitivity scan found more terms than it could list at once. Review these, then run it again to catch the rest.");
      setPendingReview(assignAliases(detected, savedReplacements));
      return;
    }
    if (scanSkipped && settings.aiPrivacyScan) {
      setNotice(scanError
        ? `Sensitivity scan did not run: ${scanError}. Names and companies were NOT checked.`
        : "Sensitivity scan skipped — set your API key in Settings to enable name/company detection.");
    } else if (truncated) {
      setNotice("The sensitivity scan was cut off before it finished. Run it again before trusting the result.");
    }
    await generate(savedReplacements);
  }

  function confirmSanitize(confirmed, toSave) {
    const savedReplacements = settings.replacements || [];
    if (toSave.length && onSettingsPatch) {
      onSettingsPatch({
        replacements: [
          ...savedReplacements,
          ...toSave.map((item) => ({ original: item.text, alias: item.alias, restored: item.restored || item.text })),
        ],
        corrections: [...(settings.corrections || []), ...toSave.map(correctionFromRestoredItem).filter(Boolean)],
      });
    }
    const forThisRun = [
      ...savedReplacements,
      ...confirmed.map((item) => ({ original: item.text, alias: item.alias, restored: item.restored || item.text })),
    ];
    setPendingReview(null);
    generate(forThisRun);
  }

  function copyUpdate() {
    navigator.clipboard.writeText(shareable).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }

  if (pendingReview) {
    return (
      <SanitizeReview
        detected={pendingReview}
        savedReplacements={settings.replacements || []}
        onConfirm={confirmSanitize}
        onSkip={() => { setPendingReview(null); generate(settings.replacements || []); }}
      />
    );
  }

  return (
    <details className="card p-6" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-base font-semibold text-gray-900">
        Short status update
        <span className="ml-2 text-xs font-normal text-gray-500">a paragraph, a risk, and a next step you can send on</span>
      </summary>

      <p className="text-sm text-gray-500 mt-2">
        Drafted from this account&apos;s notes from the {STATUS_WINDOW_LABEL}, newest first, so each motion is reported at
        where it stands now. No names, no pricing, no hedging: the draft is checked against those rules before you see it.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-gray-600">
          <span className="block mb-1">Divisions or sites (optional)</span>
          <input className="input text-sm" value={divisions} onChange={(e) => setDivisions(e.target.value)} placeholder="e.g. MFC, RMS" />
        </label>
        <div className="flex items-end gap-4 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={includeRisk} onChange={(e) => setIncludeRisk(e.target.checked)} /> Risk line
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={includeNextStep} onChange={(e) => setIncludeNextStep(e.target.checked)} /> Next step
          </label>
        </div>
      </div>

      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-gray-600">Refresh a previous update instead</summary>
        <textarea
          className="input text-sm mt-2"
          rows={3}
          value={priorUpdate}
          onChange={(e) => setPriorUpdate(e.target.value)}
          placeholder="Paste the last approved update. Its wording is kept wherever the notes have not changed."
        />
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button onClick={runWithSanitizeGate} disabled={busy || !notes?.length} className="btn-primary text-sm">
          {busy ? "Drafting…" : "Draft status update"}
        </button>
        <ModelPicker model={model} setModel={setModel} compact ariaLabel="Status update model" />
        {result?.usage && <span className="text-xs text-gray-400 font-mono">{formatCost(calcCost(result.usage, result.model))}</span>}
        {!notes?.length && <span className="text-xs text-gray-500">Scan the folder first.</span>}
      </div>

      {notice && <p role="status" className="mt-2 text-xs text-amber-700">{notice}</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}

      {result && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="text-sm whitespace-pre-wrap text-gray-800">{shareable}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={copyUpdate} className="btn-secondary text-xs">{copied ? "Copied!" : "Copy update"}</button>
            <span className="text-xs text-gray-500">
              Copies the three parts only. The risks below stay here.
            </span>
          </div>

          {result.flags?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
              <p className="text-xs font-semibold text-amber-800">Worth a look before you send it:</p>
              {result.flags.map((flag) => (
                <p key={`${flag.id}-${flag.message}`} className="text-xs text-amber-700">• {flag.message}</p>
              ))}
            </div>
          )}

          {result.update?.otherRisks?.length > 0 && (
            <details className="rounded-lg border border-gray-200 p-3">
              <summary className="cursor-pointer text-xs font-semibold text-gray-700">
                Other risks considered ({result.update.otherRisks.length}) — not shared
              </summary>
              <ul className="mt-2 space-y-1">
                {result.update.otherRisks.map((risk) => (
                  <li key={risk} className="text-xs text-gray-600">• {risk}</li>
                ))}
              </ul>
            </details>
          )}

          {result.sourceNotes?.length > 0 && (
            <p className="text-xs text-gray-400">
              From {result.sourceNotes.length} note{result.sourceNotes.length !== 1 ? "s" : ""}: {result.sourceNotes.map((n) => n.date).join(", ")}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
