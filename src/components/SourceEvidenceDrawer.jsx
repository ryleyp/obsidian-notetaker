"use client";

const excerpt = (text, limit = 320) => {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit).trim()}…` : clean;
};

export default function SourceEvidenceDrawer({ sources = [], rows = [] }) {
  const evidenceRows = rows.filter((row) => row.verifyEvidence || row.verifySource || row.verifyReason);
  if (!sources.length && !evidenceRows.length) return <p className="text-xs text-amber-700">No source evidence is loaded for this draft.</p>;
  return (
    <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-gray-800">Sources and evidence · {sources.length} source{sources.length === 1 ? "" : "s"}{evidenceRows.length ? ` · ${evidenceRows.length} checked activities` : ""}</summary>
      <div className="mt-3 max-h-80 overflow-auto space-y-3">
        {evidenceRows.map((row, index) => <div key={`${row.eventDate}-${row.title}-${index}`} className={`rounded border p-2 text-xs ${row.verify === "failed" ? "border-red-200 bg-red-50" : "border-green-200 bg-green-50"}`}>
          <p className="font-semibold">{row.title}</p>
          {row.verifySource && <p className="text-gray-600">Source: {row.verifySource}</p>}
          {row.verifyEvidence && <blockquote className="mt-1 border-l-2 border-gray-300 pl-2 text-gray-700">“{row.verifyEvidence}”</blockquote>}
          {row.verifyReason && <p className="mt-1 text-gray-600">{row.verifyReason}</p>}
        </div>)}
        {sources.map((source, index) => <div key={source.id || source.filename || `${source.title}-${index}`} className="rounded border border-gray-200 bg-white p-2 text-xs">
          <p className="font-semibold">{source.date ? `${source.date} — ` : ""}{source.title || source.filename || `Source ${index + 1}`}</p>
          <p className="mt-1 text-gray-600">{excerpt(source.content || source.text) || "Source content unavailable."}</p>
        </div>)}
      </div>
    </details>
  );
}
