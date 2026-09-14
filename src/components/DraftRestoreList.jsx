"use client";

import { providerLabel } from "@/lib/models";

export default function DraftRestoreList({ entries = [], onRestore, title = "Recent drafts" }) {
  if (!entries.length) return null;
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-gray-800">{title} ({entries.length})</summary>
      <div className="mt-3 space-y-2">{entries.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-gray-200 p-2 text-xs">
        <span><strong>{entry.meetingTitle || entry.label}</strong> · {entry.label} · {providerLabel(entry.model)} · {new Date(entry.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        <button type="button" className="btn-secondary text-xs" onClick={() => onRestore(entry)}>Restore</button>
      </div>)}</div>
    </details>
  );
}
