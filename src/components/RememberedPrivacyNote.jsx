"use client";

const plural = (count, word) => `${count} ${word}${count !== 1 ? "s" : ""}`;

// Shown when a run went ahead on remembered Privacy Review decisions. When
// every detected term was decided before, no card appears at all, so this
// line is the only place that says what was anonymized on the CSM's behalf.
export default function RememberedPrivacyNote({ remembered }) {
  const anonymized = remembered?.anonymized || 0;
  const ignored = remembered?.ignored || 0;
  if (!anonymized && !ignored) return null;

  return (
    <p className="text-xs text-gray-500 px-1" data-testid="remembered-note">
      Privacy:{" "}
      {[
        anonymized ? `${plural(anonymized, "remembered term")} anonymized automatically` : null,
        ignored ? `${plural(ignored, "term")} you marked not sensitive left as written` : null,
      ].filter(Boolean).join(", ")}
      . Review or remove remembered choices in Settings.
    </p>
  );
}
