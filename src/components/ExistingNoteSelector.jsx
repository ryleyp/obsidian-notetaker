"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/apiClient";

function isRollupOrMapping(note) {
  const name = String(note?.filename || "").toLowerCase();
  return name === "customer facts & callouts.md"
    || name.includes("customer site mapping")
    || name.includes("customer & site mapping");
}

export default function ExistingNoteSelector({
  vaultPath,
  folderPath,
  updateMode,
  onUpdateModeChange,
  selectedNote,
  onSelect,
}) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!updateMode || !vaultPath) {
      setNotes([]);
      setError(null);
      return;
    }

    let canceled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ vaultPath, folderPath: folderPath || "", allTime: "true" });
    apiFetch(`/api/notes?${params}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Failed to load existing notes");
        return (data.notes || []).filter((note) => note.source === "obsidian" && !isRollupOrMapping(note));
      })
      .then((nextNotes) => {
        if (!canceled) setNotes(nextNotes);
      })
      .catch((fetchError) => {
        if (!canceled) setError(fetchError.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });

    return () => { canceled = true; };
  }, [vaultPath, folderPath, updateMode]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return notes;
    return notes.filter((note) => `${note.filename} ${note.title}`.toLowerCase().includes(query));
  }, [notes, search]);

  function setMode(nextMode) {
    onUpdateModeChange(nextMode);
    if (!nextMode) onSelect(null);
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Save behavior</h2>
          <p className="text-xs text-gray-500 mt-1">
            Create a new note, or migrate an old meeting note to the current format.
          </p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
          <button
            type="button"
            onClick={() => setMode(false)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${!updateMode ? "bg-white text-obsidian-700 shadow-sm" : "text-gray-500"}`}
          >
            New note
          </button>
          <button
            type="button"
            onClick={() => setMode(true)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${updateMode ? "bg-white text-obsidian-700 shadow-sm" : "text-gray-500"}`}
          >
            Update existing
          </button>
        </div>
      </div>

      {updateMode && (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            The selected note will be used as a secondary source, backed up, then replaced only after you review and save the regenerated note.
          </div>
          <input
            type="search"
            className="input"
            placeholder="Search notes in this folder..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />

          {loading ? (
            <p className="text-sm text-gray-500">Loading existing notes...</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-gray-500">No meeting notes found in this folder.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 divide-y divide-gray-100">
              {filtered.map((note) => {
                const selected = selectedNote?.relativePath === note.relativePath;
                return (
                  <button
                    type="button"
                    key={note.relativePath}
                    onClick={() => onSelect(note)}
                    className={`w-full px-3 py-2.5 text-left text-sm ${selected ? "bg-obsidian-50 text-obsidian-700 font-medium" : "bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    <span className="block truncate">{note.filename}</span>
                    {note.date && <span className="block mt-0.5 text-xs text-gray-400">{note.date}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {selectedNote && (
            <p className="text-xs text-green-700">
              Updating <code className="font-mono bg-green-50 px-1 rounded">{selectedNote.relativePath}</code>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
