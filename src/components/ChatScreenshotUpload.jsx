"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { calcCost, formatCost, providerLabel, resolveAutoModel } from "@/lib/models";
import { prepareSlideImage } from "@/lib/slideImages";
import { MAX_CHAT_SHOTS, chatTail, sortShotsByName } from "@/lib/chatScreenshots";

// Screenshots of a Teams chat, read into "[time] Sender: message" lines and
// handed to the thread box. The images are the one place real names leave the
// machine un-pseudonymized, so the same explicit approval the slide upload
// uses gates every read; the text that comes back is reviewed like any paste.

export default function ChatScreenshotUpload({ settings, model, onTranscribed }) {
  const [shots, setShots] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [cost, setCost] = useState(null);
  const [allowImageUpload, setAllowImageUpload] = useState(false);
  const [reading, setReading] = useState(false);
  const inputRef = useRef(null);
  const allowRef = useRef(false);
  const shotsRef = useRef([]);
  const resolvedModel = resolveAutoModel(model, { apiKey: settings.apiKey, openaiApiKey: settings.openaiApiKey });

  useEffect(() => { allowRef.current = allowImageUpload; }, [allowImageUpload]);
  useEffect(() => { shotsRef.current = shots; }, [shots]);

  function patch(id, changes) {
    setShots((current) => current.map((shot) => (shot.id === id ? { ...shot, ...changes } : shot)));
  }

  async function addFiles(fileList, { keepOrder = false } = {}) {
    setError("");
    const files = [...(fileList || [])].filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    if (!allowRef.current) {
      setError("Confirm that you reviewed and cropped sensitive image content before adding screenshots.");
      return;
    }
    const room = MAX_CHAT_SHOTS - shotsRef.current.length;
    if (room <= 0) { setError(`At most ${MAX_CHAT_SHOTS} screenshots at a time.`); return; }

    const prepared = [];
    const problems = [];
    // Files picked or dropped together sort by name, which puts OS screenshot
    // names in the order they were taken. A pasted image keeps arrival order.
    const batch = keepOrder ? files : sortShotsByName(files);
    for (const file of batch.slice(0, room)) {
      try {
        prepared.push(await prepareSlideImage(file));
      } catch (e) {
        problems.push(e.message);
      }
    }
    if (batch.length > room) problems.push(`${batch.length - room} left out — the ${MAX_CHAT_SHOTS}-screenshot limit is reached.`);
    if (problems.length) setError(problems.join(" "));
    if (prepared.length) setShots((current) => [...current, ...prepared]);
  }

  // A screenshot copied to the clipboard can be pasted anywhere on the page.
  // Only image pastes are taken, so pasting text into any field is untouched.
  const addFilesRef = useRef(addFiles);
  useEffect(() => { addFilesRef.current = addFiles; });
  useEffect(() => {
    function onPaste(event) {
      const images = [...(event.clipboardData?.files || [])].filter((file) => file.type.startsWith("image/"));
      if (!images.length) return;
      event.preventDefault();
      addFilesRef.current(images, { keepOrder: true });
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  function remove(id) {
    setShots((current) => current.filter((shot) => shot.id !== id));
  }

  function move(id, direction) {
    setShots((current) => {
      const index = current.findIndex((shot) => shot.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  // Reads every screenshot that has not been read yet, in order. The text only
  // goes to the thread box once all of them are read, so a failure never
  // leaves the box holding half a conversation in the wrong order.
  async function readAll() {
    setError("");
    if (!allowRef.current) {
      setError("Confirm that you reviewed and cropped sensitive image content before reading screenshots.");
      return;
    }
    const pending = shotsRef.current.filter((shot) => shot.status !== "done");
    if (!pending.length) return;

    // A retry continues from the nearest screenshot before it that was read.
    const firstPendingIndex = shotsRef.current.findIndex((shot) => shot.status !== "done");
    const before = shotsRef.current.slice(0, firstPendingIndex).filter((shot) => shot.text);
    const previousText = chatTail(before.map((shot) => shot.text).join("\n"));

    setReading(true);
    setShots((current) => current.map((shot) => (shot.status === "done" ? shot : { ...shot, status: "reading", error: "" })));
    const readOk = new Map();
    try {
      const res = await apiFetch("/api/read-chat-screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shots: pending.map(({ id, name, mediaType, data }) => ({ id, name, mediaType, data })),
          previousText,
          model,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
          allowUnredactedImages: true,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Reading screenshots failed");
      for (const read of result.shots || []) {
        if (read.error) patch(read.id, { status: "failed", error: read.error });
        else { patch(read.id, { status: "done", text: read.text }); readOk.set(read.id, read.text); }
      }
      if (result.usage) setCost((previous) => {
        const next = calcCost(result.usage, result.model);
        return previous ? { ...next, cost: previous.cost + next.cost } : next;
      });
    } catch (e) {
      setShots((current) => current.map((shot) => (shot.status === "reading" ? { ...shot, status: "failed", error: e.message } : shot)));
      setError(e.message);
    } finally {
      setReading(false);
    }

    // Everything read (this run or an earlier one)? Hand the text over and
    // drop the images, which are not needed again.
    const finished = shotsRef.current.map((shot) => (readOk.has(shot.id) ? { ...shot, text: readOk.get(shot.id), status: "done" } : shot));
    if (finished.length && finished.every((shot) => shot.status === "done")) {
      onTranscribed(finished.map((shot) => shot.text).filter(Boolean).join("\n"));
      setShots([]);
    }
  }

  const doneCount = shots.filter((shot) => shot.status === "done").length;
  const failedCount = shots.filter((shot) => shot.status === "failed").length;

  return (
    <div className="mb-4 rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-gray-800">Chat screenshots <span className="font-normal text-gray-400">(optional)</span></p>
          <p className="text-xs text-gray-500 mt-0.5">
            Drop, choose, or paste screenshots of the chat, oldest first. {providerLabel(resolvedModel)} reads who said what into the thread box below,
            where you can fix any name before the note is made. A screenshot shows sender names that a copy-paste often drops.
          </p>
        </div>
        {cost && <span className="text-xs text-gray-400 font-mono whitespace-nowrap">{formatCost(cost)}</span>}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragging(false); addFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`rounded-lg border-2 border-dashed px-4 py-4 text-center cursor-pointer transition-colors ${
          isDragging ? "border-obsidian-400 bg-obsidian-50" : "border-gray-300 hover:border-obsidian-300 hover:bg-gray-50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <p className="text-sm text-gray-600">Drop chat screenshots here, click to choose, or paste one with Cmd/Ctrl+V</p>
        <p className="text-[11px] text-gray-400 mt-1">PNG, JPEG, WebP · resized to 1600px before upload · up to {MAX_CHAT_SHOTS} screenshots</p>
      </div>

      <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
        <input
          type="checkbox"
          checked={allowImageUpload}
          onChange={(event) => setAllowImageUpload(event.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 rounded accent-amber-700"
        />
        <span>
          I reviewed and cropped these images. I understand that pixels cannot be pseudonymized and the images are sent to the selected AI as they are.
        </span>
      </label>

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      {shots.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-gray-500">
            <span>
              {shots.length} screenshot{shots.length === 1 ? "" : "s"} in order · {doneCount} read{reading ? " · reading…" : ""}{failedCount ? ` · ${failedCount} failed` : ""}
            </span>
            <button
              type="button"
              onClick={readAll}
              disabled={reading}
              className="btn-secondary text-xs px-3 py-1.5"
            >
              {reading ? "Reading…" : failedCount ? "Retry and add to thread" : "Read into thread"}
            </button>
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {shots.map((shot, index) => (
              <li key={shot.id} className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                {/* A local data URL preview; next/image has nothing to optimize here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shot.previewUrl} alt={`Chat screenshot ${index + 1}`} className="w-full aspect-video object-cover object-top bg-gray-100" />
                <div className="p-1.5 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-medium text-gray-700 truncate" title={shot.name}>{index + 1} · {shot.name}</span>
                    <span
                      className={`text-[10px] rounded-full px-1.5 border ${
                        shot.status === "done" ? "text-green-700 bg-green-50 border-green-200"
                          : shot.status === "failed" ? "text-red-700 bg-red-50 border-red-200"
                          : "text-gray-500 bg-gray-50 border-gray-200"
                      }`}
                      title={shot.error}
                    >
                      {shot.status === "pending" ? "ready" : shot.status === "reading" ? "reading…" : shot.status}
                    </span>
                  </div>
                  {shot.status === "failed" && <p className="text-[10px] text-red-700">{shot.error}</p>}
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <button type="button" onClick={() => move(shot.id, -1)} disabled={index === 0 || reading} className="hover:text-gray-700 disabled:opacity-30" title="Move earlier">←</button>
                    <button type="button" onClick={() => move(shot.id, 1)} disabled={index === shots.length - 1 || reading} className="hover:text-gray-700 disabled:opacity-30" title="Move later">→</button>
                    <button type="button" onClick={() => remove(shot.id)} disabled={reading} className="ml-auto text-red-400 hover:text-red-600 disabled:opacity-30">remove</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
