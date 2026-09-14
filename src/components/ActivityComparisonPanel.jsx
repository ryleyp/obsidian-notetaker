"use client";

import { compareActivityRows } from "@/lib/activityComparison";
import { formatCost, providerLabel } from "@/lib/models";
import SourceEvidenceDrawer from "@/components/SourceEvidenceDrawer";

export default function ActivityComparisonPanel({ current, alternative, loading, error, model, cost, onRun, onApply, onUndo, canUndo, history, onRestore, sources }) {
  const items = alternative ? compareActivityRows(current, alternative) : [];
  const changed = items.filter((item) => item.changedFields.length || item.currentIndex < 0);
  return (
    <section className="card p-5 space-y-3" aria-label="AI review workspace">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">AI review workspace</strong>
        <button type="button" className="btn-secondary text-xs" onClick={onRun} disabled={loading}>{loading ? "Generating comparison…" : "Run independent alternative"}</button>
        <button type="button" className="btn-secondary text-xs" onClick={onUndo} disabled={!canUndo}>Undo last change</button>
        {model && <span className="text-xs text-gray-500">{providerLabel(model)}{cost ? ` · ${formatCost(cost)}` : ""}</span>}
      </div>
      <p className="text-xs text-gray-500">The alternative provider reads the same source notes independently. Apply a complete activity or only the fields you prefer.</p>
      {changed.length > 0 && <div className="max-h-[32rem] overflow-auto space-y-3">
        {changed.map((item) => <div key={`${item.currentIndex}-${item.alternativeIndex}`} className="rounded-lg border border-blue-200 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between gap-2"><strong>{item.alternative?.title || item.current?.title}</strong><button type="button" className="btn-secondary text-xs" onClick={() => onApply(item, null)}>{item.current ? "Use complete activity" : "Add activity"}</button></div>
          {item.changedFields.map((field) => <div key={field} className="grid sm:grid-cols-[6rem_1fr_auto] gap-2 items-start border-t border-gray-100 pt-2">
            <strong className="capitalize">{field}</strong>
            <div><p className="text-gray-500">Current: {item.current?.[field] || "—"}</p><p className="text-blue-900">Alternative: {item.alternative?.[field] || "—"}</p></div>
            {item.current && <button type="button" className="underline text-obsidian-700" onClick={() => onApply(item, field)}>Use field</button>}
          </div>)}
        </div>)}
      </div>}
      {alternative && !changed.length && <p className="text-sm text-green-700">The two providers produced the same report fields.</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <SourceEvidenceDrawer sources={sources || []} rows={current} />
      {history?.length > 0 && <details><summary className="cursor-pointer text-xs font-semibold">Report draft history ({history.length})</summary><div className="mt-2 space-y-1">{history.map((entry) => <div key={entry.id} className="flex flex-wrap justify-between gap-2 rounded border p-2 text-xs"><span><strong>{entry.label}</strong> · {providerLabel(entry.model)} · {entry.sourceCount} sources · {new Date(entry.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><button type="button" className="underline text-obsidian-700" onClick={() => onRestore(entry)}>Restore</button></div>)}</div></details>}
    </section>
  );
}
