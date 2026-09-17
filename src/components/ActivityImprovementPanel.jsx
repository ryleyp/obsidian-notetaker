"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { calcCost, formatCost, providerLabel } from "@/lib/models";
import { IMPROVEMENT_FIELDS } from "@/lib/activityImprovement";

export default function ActivityImprovementPanel({ rows, notes, settings, accountName, restoredIds, model, disabled, onApply, autoRun, onAutoRun }) {
  const [instructions, setInstructions] = useState("");
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cost, setCost] = useState(null);
  const controller = useRef(null);
  const unmountTimer = useRef(null);
  const fingerprint = JSON.stringify(rows);
  const stale = proposal && proposal.snapshot !== fingerprint;

  // React development mode intentionally mounts, cleans up, then mounts an
  // effect again. Delay cancellation by one tick so that rehearsal does not
  // abort the automatic pass; a real unmount still cancels the request.
  useEffect(() => {
    clearTimeout(unmountTimer.current);
    return () => {
      unmountTimer.current = setTimeout(() => controller.current?.abort(), 0);
    };
  }, []);

  async function improve() {
    if (controller.current || disabled) return;
    const aborter = new AbortController();
    controller.current = aborter;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const response = await apiFetch("/api/improve-activities", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: aborter.signal,
        body: JSON.stringify({ rows, notes: notes || [], instructions, accountName,
          allAccounts: settings.accounts || [], replacements: settings.replacements || [], corrections: settings.corrections || [],
          restoredIds: [...restoredIds], apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined, model }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Activity improvement failed");
      setProposal({
        changes: data.changes,
        message: data.message,
        snapshot: fingerprint,
        before: rows,
        sourcesUsed: data.sourcesUsed,
        sourcesDropped: data.sourcesDropped,
      });
      if (data.usage) setCost(calcCost(data.usage, data.model));
    } catch (e) {
      if (e.name !== "AbortError") setError(e.message);
      else setStatus("Improvement canceled. The table is unchanged.");
    } finally {
      if (controller.current === aborter) controller.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoRun || disabled || controller.current) return;
    onAutoRun();
    improve();
    // Run once after generation completes; manual reruns use the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, disabled]);

  function apply() {
    if (!proposal || stale || disabled || busy) return;
    onApply(proposal.changes);
    setProposal(null);
    setStatus("Improvements applied to the table. Save to Obsidian when ready.");
  }

  function applyChange(change, fields = null) {
    if (!proposal || stale || disabled || busy) return;
    const selected = fields ? { index: change.index, ...Object.fromEntries(IMPROVEMENT_FIELDS.map((field) => [field, fields.includes(field) ? change[field] : proposal.before[change.index][field]])) } : change;
    onApply([selected]);
    setProposal((current) => {
      const before = current.before.map((row, index) => index === change.index ? { ...row, ...selected } : row);
      const keepChange = fields && IMPROVEMENT_FIELDS.some((field) => change[field] !== before[change.index][field]);
      return { ...current, changes: current.changes.filter((item) => item.index !== change.index || keepChange), snapshot: JSON.stringify(before), before };
    });
    setStatus(fields ? "Field applied to the table." : "Activity applied to the table.");
  }

  return (
    <section className="card p-5 space-y-3" aria-label="AI activity improvement">
      <div className="flex gap-3 items-center flex-wrap">
        <button type="button" className="btn-secondary text-sm" onClick={improve} disabled={busy || disabled || rows.length > 80}>{busy ? `Improving with ${providerLabel(model)}…` : `Improve all activities with ${providerLabel(model)}`}</button>
        {busy && <button type="button" className="btn-secondary text-sm" onClick={() => controller.current?.abort()}>Cancel improvement</button>}
        {cost && <span className="text-xs text-gray-500">Last pass: {formatCost(cost)}</span>}
      </div>
      <p className="text-xs text-gray-500">{providerLabel(model)} reviews both saved SFDC entries and newly generated activities. {notes?.length ? "Uses the current table, loaded source notes, and your privacy filters." : "Source notes are not loaded. This pass can improve the current wording and classification but cannot verify source facts."}</p>
      <details>
        <summary className="cursor-pointer text-xs text-gray-600">Optional improvement guidance</summary>
        <label htmlFor="activity-improvement-guidance" className="block text-xs mt-2 mb-1">Anything to emphasize?</label>
        <textarea id="activity-improvement-guidance" className="input text-sm" rows={2} maxLength={4000} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: emphasize concrete customer outcomes and keep comments under 500 characters." disabled={busy} />
      </details>
      {proposal && <div className="border border-blue-200 rounded-lg p-3 space-y-3">
        {proposal.sourcesDropped > 0 && (
          <p role="status" className="text-xs text-amber-700">
            Only the {proposal.sourcesUsed} most recent of {proposal.sourcesUsed + proposal.sourcesDropped} notes fit in
            this pass, so every row was improved but the oldest could not be checked against a source. Narrow the date
            range for a fully source-checked pass.
          </p>
        )}
        <p className="text-sm whitespace-pre-wrap">{proposal.message}</p>
        <p className="text-sm font-semibold">{proposal.changes.length ? `Proposed edits to ${proposal.changes.length} activit${proposal.changes.length === 1 ? "y" : "ies"}` : "No edits proposed."}</p>
        <div className="max-h-96 overflow-auto space-y-4">
          {proposal.changes.map((change) => <div key={change.index} className="space-y-1 text-xs border-b border-gray-100 pb-3">
            <div className="flex justify-between gap-2"><p className="font-semibold">Activity {change.index + 1}: {proposal.before[change.index].title}</p><button type="button" className="btn-secondary text-xs" onClick={() => applyChange(change)}>Apply activity</button></div>
            {IMPROVEMENT_FIELDS.filter((field) => change[field] !== proposal.before[change.index][field]).map((field) => <div key={field}>
              <div className="flex justify-between gap-2"><p className="font-medium capitalize">{field}</p><button type="button" className="underline text-obsidian-700" onClick={() => applyChange(change, [field])}>Apply field</button></div>
              <p className="text-gray-500 whitespace-pre-wrap">Before: {proposal.before[change.index][field]}</p>
              <p className="text-blue-900 whitespace-pre-wrap">After: {change[field]}</p>
            </div>)}
          </div>)}
        </div>
        {stale && <p role="status" className="text-xs text-amber-700">The table changed since this pass. Run improvement again to refresh the proposed edits.</p>}
        <div className="flex gap-2">
          {proposal.changes.length > 0 && <button type="button" onClick={apply} disabled={stale || disabled || busy} className="btn-primary text-xs">Apply proposed edits</button>}
          <button type="button" onClick={() => { setProposal(null); setStatus("Proposed edits dismissed."); }} disabled={busy} className="btn-secondary text-xs">Dismiss</button>
        </div>
      </div>}
      {rows.length > 80 && <p className="text-xs text-amber-700">The improvement pass supports up to 80 activities. Use a smaller reporting range.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {status && <p role="status" className="text-sm text-green-700">{status}</p>}
    </section>
  );
}
