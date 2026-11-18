"use client";

import { useState } from "react";

// The types a remembered "not sensitive" choice applies to. Everything else is
// a deterministic identifier and is asked about every time.
const GUESSED_TYPES = new Set(["person", "org", "location", "name"]);

// Certain identifiers first, then the typed guesses, then capitalized terms
// the local pass could not classify. The last group is where an ordinary
// word is most likely, so it is the group worth reading for rows to uncheck.
const TYPE_ORDER = ["email", "phone", "id", "secret", "url", "ip", "address", "person", "org", "location", "name"];
const typeRank = (type) => {
  const rank = TYPE_ORDER.indexOf(type);
  return rank === -1 ? TYPE_ORDER.length : rank;
};

const plural = (count, word) => `${count} ${word}${count !== 1 ? "s" : ""}`;

export default function SanitizeReview({ detected, savedReplacements, remembered, onConfirm, onSkip }) {
  const [items, setItems] = useState(() => detected
    .map((d, order) => ({ ...d, order, enabled: true, saveToList: false, restored: d.text }))
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.order - b.order)
  );
  // On by default: the point of the card is to be asked once per term.
  const [remember, setRemember] = useState(true);

  function update(i, field, value) {
    setItems((prev) => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item));
  }

  function handleConfirm() {
    const confirmed = items.filter((i) => i.enabled);
    const toSave = items.filter((i) => i.enabled && i.saveToList);
    onConfirm(confirmed, toSave, { remember, reviewed: items });
  }

  const activeCount = items.filter((i) => i.enabled).length;
  const autoAnonymized = remembered?.anonymized || 0;
  const autoIgnored = remembered?.ignored || 0;
  const uncheckedGuesses = items.filter((i) => !i.enabled && GUESSED_TYPES.has(i.type)).length;
  const unclassified = items.filter((i) => i.type === "name").length;

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Privacy Review</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Found {detected.length} new term{detected.length !== 1 ? "s" : ""} to anonymize.
            Edit "Restored as" to fix spellings — that's what appears in your final notes.
          </p>
          {unclassified > 0 && (
            <p className="text-xs text-gray-500 mt-1.5" data-testid="name-hint">
              {plural(unclassified, "row")} marked <span className="font-medium">name</span> at the end {unclassified !== 1 ? "are" : "is a"} capitalized
              {unclassified !== 1 ? " terms" : " term"} that may be a person, company, or site. Uncheck any that are ordinary words.
            </p>
          )}
          {(autoAnonymized > 0 || autoIgnored > 0) && (
            <p className="text-xs text-gray-500 mt-1.5" data-testid="remembered-summary">
              Already decided, so not shown:{" "}
              {[
                autoAnonymized > 0 ? `${plural(autoAnonymized, "term")} anonymized automatically` : null,
                autoIgnored > 0 ? `${plural(autoIgnored, "term")} you marked not sensitive left as written` : null,
              ].filter(Boolean).join(", ")}.
            </p>
          )}
        </div>
        <button
          onClick={() => {
            if (window.confirm("Generate with these detected sensitive terms still visible to the AI? This bypasses the privacy filter for this request.")) onSkip();
          }}
          className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap ml-4"
        >
          Bypass privacy filter…
        </button>
      </div>

      {savedReplacements.length > 0 && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-xs font-medium text-gray-600 mb-1.5">Already in your list:</p>
          <div className="flex flex-wrap gap-1.5">
            {savedReplacements.map((r) => (
              <span key={r.original} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-obsidian-50 text-obsidian-700 border border-obsidian-200">
                {r.original} → <span className="font-mono">{r.alias}</span>{r.restored && r.restored !== r.original ? ` → ${r.restored}` : ""}
              </span>
            ))}
          </div>
        </div>
      )}

      {items.length > 0 ? (
        <div className="space-y-2 mb-5">
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 items-center text-xs text-gray-500 font-medium px-1">
            <span></span>
            <span>Detected</span>
            <span>Alias (sent to Claude)</span>
            <span>Restored as</span>
            <span title="Always use this exact alias. Added to Privacy Replacements in Settings.">Fixed alias</span>
          </div>
          {items.map((item, i) => (
            <div
              key={i}
              className={`grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-2 items-center p-2.5 rounded-lg border transition-colors ${
                item.enabled ? "bg-white border-gray-200" : "bg-gray-50 border-gray-100 opacity-50"
              }`}
            >
              <input
                type="checkbox"
                checked={item.enabled}
                onChange={() => update(i, "enabled", !item.enabled)}
                className="w-4 h-4 rounded accent-obsidian-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">{item.text}</span>
                <span className="ml-2 text-xs text-gray-400">{item.type}</span>
              </div>
              <input
                type="text"
                value={item.alias}
                onChange={(e) => update(i, "alias", e.target.value)}
                disabled={!item.enabled}
                title="Placeholder sent to Claude"
                className="font-mono text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 w-40 focus:outline-none focus:border-obsidian-400 disabled:opacity-40"
              />
              <input
                type="text"
                value={item.restored}
                onChange={(e) => update(i, "restored", e.target.value)}
                disabled={!item.enabled}
                title="Correct spelling — this is what appears in your notes"
                className={`text-xs px-2 py-1 rounded border w-32 focus:outline-none disabled:opacity-40 ${
                  item.restored !== item.text
                    ? "border-obsidian-300 bg-obsidian-50 text-obsidian-700 focus:border-obsidian-500"
                    : "border-gray-200 bg-gray-50 text-gray-700 focus:border-obsidian-400"
                }`}
              />
              <input
                type="checkbox"
                checked={item.saveToList}
                onChange={() => update(i, "saveToList", !item.saveToList)}
                disabled={!item.enabled}
                title="Always use this exact alias. Added to Privacy Replacements in Settings."
                className="w-4 h-4 rounded accent-obsidian-600 disabled:opacity-40"
              />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-500 mb-5">No new terms detected beyond your saved list.</p>
      )}

      <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 rounded accent-obsidian-600"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
        />
        <span>
          <span className="block text-sm font-medium text-gray-800">Remember these choices and only ask about new terms</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Checked terms are anonymized automatically from now on, under a new random alias each time.
            Unchecked names, companies, and places are treated as not sensitive and not asked about again.
            Emails, phone numbers, and other identifiers are always asked about.
            Choices are kept in your browser and glossary file, never sent to an AI, and can be removed in Settings.
          </span>
          {remember && uncheckedGuesses > 0 && (
            <span className="block text-xs text-amber-700 mt-1" data-testid="ignore-warning">
              {plural(uncheckedGuesses, "unchecked term")} will be sent as written on every future request.
            </span>
          )}
        </span>
      </label>

      <button onClick={handleConfirm} className="btn-primary w-full py-3 text-base">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        {activeCount > 0 ? `Anonymize ${activeCount} term${activeCount !== 1 ? "s" : ""} & Generate` : "Generate without anonymizing"}
      </button>
    </div>
  );
}
