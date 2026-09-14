"use client";

import { alternateModel, formatCost, providerLabel } from "@/lib/models";
import { changedNoteSections } from "@/lib/noteSections";
import SourceEvidenceDrawer from "@/components/SourceEvidenceDrawer";

export default function NoteComparisonPanel({ current, alternative, loading, error, selectedModel, reviewModel, onRunAlternative, onApply, onUndo, canUndo, draftHistory, onRestore, sources }) {
  // reviewModel is the CSM's chosen reviewer (see RunModePicker); fall back
  // to the usual alternate provider only if this panel is used without one.
  const other = reviewModel || alternateModel(selectedModel);
  const changes = alternative ? changedNoteSections(current, alternative.content) : [];

  return (
    <section className="card p-4 space-y-3" aria-label="AI review workspace">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-gray-800">AI review workspace</span>
        <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => onRunAlternative("independent", other)}>
          {loading ? "Running alternative…" : `Run independent ${providerLabel(other)} draft`}
        </button>
        <button type="button" className="btn-secondary text-xs" disabled={loading} onClick={() => onRunAlternative("review", other)}>
          {loading ? "Reviewing…" : `Get ${providerLabel(other)} second opinion`}
        </button>
        <button type="button" className="btn-secondary text-xs" disabled={!canUndo} onClick={onUndo}>Undo last change</button>
      </div>
      <p className="text-xs text-gray-500">Independent drafts start from the same sources. Second opinions review the current note against those sources. Nothing replaces your note until you accept it.</p>

      {alternative && (
        <div className="rounded-lg border border-blue-200 p-3 space-y-3">
          <div className="flex flex-wrap justify-between gap-2 text-xs">
            <strong>{providerLabel(alternative.model)} {alternative.kind === "independent" ? "independent draft" : "second opinion"}</strong>
            {alternative.cost && <span className="text-gray-500">{formatCost(alternative.cost)}</span>}
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div><p className="text-xs font-semibold mb-1">Current note</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs">{current}</pre></div>
            <div><p className="text-xs font-semibold mb-1">Alternative</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-blue-50 p-3 text-xs">{alternative.content}</pre></div>
          </div>
          {changes.length > 0 && (
            <details open>
              <summary className="cursor-pointer text-xs font-semibold">Accept individual sections ({changes.length})</summary>
              <div className="mt-2 space-y-2">
                {changes.map((section) => (
                  <div key={section.key} className="rounded border border-gray-200 p-2 text-xs">
                    <div className="flex items-center justify-between gap-2"><strong>{section.title}</strong><button type="button" className="btn-secondary text-xs" onClick={() => onApply(section.key)}>Use this section</button></div>
                    <p className="mt-1 text-gray-600 whitespace-pre-wrap line-clamp-4">{section.content}</p>
                  </div>
                ))}
              </div>
            </details>
          )}
          <button type="button" className="btn-primary text-xs" onClick={() => onApply(null)}>Use complete alternative</button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <SourceEvidenceDrawer sources={sources || []} />

      {draftHistory?.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-gray-700">Draft history ({draftHistory.length})</summary>
          <div className="mt-2 space-y-1">
            {draftHistory.map((draft) => (
              <div key={draft.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 p-2 text-xs">
                <span><strong>{draft.label}</strong> · {draft.meetingTitle || "Untitled meeting"} · {providerLabel(draft.model)} · {draft.sourceCount} source{draft.sourceCount === 1 ? "" : "s"} · {new Date(draft.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                <button type="button" className="underline text-obsidian-700" onClick={() => onRestore(draft)}>Restore</button>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
