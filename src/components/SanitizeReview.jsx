"use client";

import { useState } from "react";

const TYPE_LABELS = {
  person: "Person",
  org: "Company / organization",
  email: "Email",
  location: "Location",
  phone: "Phone",
  address: "Address",
  url: "URL",
  ip: "IP address",
  secret: "Secret / key",
  id: "Sensitive ID",
};

export default function SanitizeReview({ detected, savedReplacements, onConfirm, onSkip }) {
  const [items, setItems] = useState(
    detected.map((item) => ({ ...item, enabled: true, saveToList: false, restored: item.restored || item.text }))
  );

  function update(index, field, value) {
    setItems((previous) => previous.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [field]: value } : item
    )));
  }

  function setAllEnabled(enabled) {
    setItems((previous) => previous.map((item) => ({ ...item, enabled })));
  }

  function handleConfirm() {
    const confirmed = items.filter((item) => item.enabled);
    const toSave = confirmed.filter((item) => item.saveToList);
    onConfirm(confirmed, toSave);
  }

  const active = items.filter((item) => item.enabled);
  const activeCount = active.length;
  const rememberedCount = active.filter((item) => item.saveToList).length;

  return (
    <section className="card overflow-hidden border border-obsidian-200">
      <div className="p-6 border-b border-gray-100 bg-gradient-to-br from-white to-obsidian-50/40">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg font-semibold text-gray-900">Privacy Review</h3>
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                {detected.length} need{detected.length === 1 ? "s" : ""} review
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1 max-w-xl">
              Saved terms are handled automatically. Review only these new findings before anything is sent to the AI.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-gray-500">Saved protections</p>
            <p className="text-lg font-semibold text-emerald-700">{savedReplacements.length}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full font-medium ${
            activeCount === detected.length
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${activeCount === detected.length ? "bg-emerald-500" : "bg-amber-500"}`} />
            {activeCount} of {detected.length} will be hidden from the AI
          </span>
          {rememberedCount > 0 && (
            <span className="px-2.5 py-1.5 rounded-full bg-gray-100 text-gray-600">
              {rememberedCount} remembered for next time
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-3">
        {items.length > 1 && (
          <div className="flex justify-end gap-3 text-xs">
            <button type="button" onClick={() => setAllEnabled(true)} className="text-obsidian-700 hover:text-obsidian-900 font-medium">
              Protect all
            </button>
            <button type="button" onClick={() => setAllEnabled(false)} className="text-gray-500 hover:text-gray-700">
              Clear all
            </button>
          </div>
        )}

        {items.map((item, index) => (
          <article
            key={`${item.text}-${index}`}
            className={`rounded-xl border p-4 transition-colors ${
              item.enabled ? "border-obsidian-200 bg-white" : "border-gray-200 bg-gray-50 opacity-70"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={() => update(index, "enabled", !item.enabled)}
                aria-label={`Hide ${item.text} from the AI`}
                className="w-4 h-4 mt-1 rounded accent-obsidian-600"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-gray-900 break-words">{item.text}</span>
                  {item.source && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                      {item.source}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {item.enabled ? `The AI receives ${item.alias}` : "This term will remain visible to the AI"}
                </p>
                {item.context && (
                  <p className="mt-2 text-xs leading-relaxed text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                    {item.context}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-4 grid sm:grid-cols-2 gap-3 pl-7">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">What is it?</span>
                <select
                  value={item.type || "org"}
                  onChange={(event) => update(index, "type", event.target.value)}
                  disabled={!item.enabled}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-obsidian-400 disabled:opacity-50"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Final-note spelling</span>
                <input
                  type="text"
                  value={item.restored}
                  onChange={(event) => update(index, "restored", event.target.value)}
                  disabled={!item.enabled}
                  title="Change only when the detected spelling needs correction"
                  className="w-full text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white focus:outline-none focus:border-obsidian-400 disabled:opacity-50"
                />
                <span className="block text-[11px] text-gray-400 mt-1">Change this only to correct a spelling.</span>
              </label>
            </div>

            <label className="mt-3 ml-7 inline-flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
              <input
                type="checkbox"
                checked={item.saveToList}
                onChange={() => update(index, "saveToList", !item.saveToList)}
                disabled={!item.enabled}
                className="w-3.5 h-3.5 rounded accent-obsidian-600 disabled:opacity-40"
              />
              Remember this protection for future notes
            </label>
          </article>
        ))}

        <details className="rounded-lg border border-gray-200 bg-gray-50">
          <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-gray-600">
            Preview what the AI will receive
          </summary>
          <div className="border-t border-gray-200 px-4 py-3">
            {active.length ? (
              <div className="flex flex-wrap gap-2">
                {active.map((item, index) => (
                  <code key={`${item.alias}-${index}`} className="text-xs px-2 py-1 rounded bg-white border border-gray-200 text-obsidian-700">
                    {item.alias}
                  </code>
                ))}
              </div>
            ) : (
              <p className="text-xs text-amber-700">No new findings will be hidden.</p>
            )}
            <p className="text-[11px] text-gray-400 mt-2">Original terms are replaced locally; this preview intentionally shows placeholders only.</p>
          </div>
        </details>

        {savedReplacements.length > 0 && (
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-gray-600">
              {savedReplacements.length} saved protection{savedReplacements.length === 1 ? "" : "s"} available
            </summary>
            <div className="border-t border-gray-100 px-4 py-3 flex flex-wrap gap-2">
              {savedReplacements.map((replacement, index) => (
                <span key={`${replacement.alias}-${index}`} className="text-xs px-2 py-1 rounded-full bg-obsidian-50 text-obsidian-700 border border-obsidian-200">
                  {replacement.original} → <span className="font-mono">{replacement.alias}</span>
                </span>
              ))}
            </div>
          </details>
        )}

        <button type="button" onClick={handleConfirm} className="btn-primary w-full py-3 text-base">
          {activeCount > 0
            ? `Protect ${activeCount} term${activeCount === 1 ? "" : "s"} & generate`
            : "Generate without protecting new findings"}
        </button>

        <details className="text-center">
          <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-600">Advanced privacy options</summary>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("Send these detected terms to the AI without anonymizing them? Saved protections still apply.")) onSkip();
            }}
            className="mt-3 text-xs text-red-500 hover:text-red-700"
          >
            Bypass new privacy findings for this request
          </button>
        </details>
      </div>
    </section>
  );
}
