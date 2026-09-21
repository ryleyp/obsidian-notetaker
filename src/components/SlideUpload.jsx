"use client";

import { useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { calcCost, formatCost, providerLabel, resolveAutoModel } from "@/lib/models";
import { MAX_SLIDES } from "@/lib/slides";
import { prepareSlideImage } from "@/lib/slideImages";

// Screenshots of the deck shown in a meeting. Each one is read into text the
// moment it lands, so by the time the CSM presses Generate the slides are
// already ordinary sources — cited [S#], pseudonymized, saved with the
// transcript — and the images themselves are never sent again.

export default function SlideUpload({ slides, setSlides, settings, model }) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [cost, setCost] = useState(null);
  const inputRef = useRef(null);
  const busy = slides.some((slide) => slide.status === "reading");
  const resolvedModel = resolveAutoModel(model, { apiKey: settings.apiKey, openaiApiKey: settings.openaiApiKey });

  function patch(id, changes) {
    setSlides((current) => current.map((slide) => (slide.id === id ? { ...slide, ...changes } : slide)));
  }

  async function readSlides(batch) {
    if (!batch.length) return;
    setSlides((current) => current.map((slide) => (batch.some((b) => b.id === slide.id) ? { ...slide, status: "reading", error: "" } : slide)));
    try {
      const res = await apiFetch("/api/describe-slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slides: batch.map(({ id, name, mediaType, data }) => ({ id, name, mediaType, data })),
          model,
          apiKey: settings.apiKey || undefined,
          openaiApiKey: settings.openaiApiKey || undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Reading slides failed");
      for (const read of result.slides || []) {
        patch(read.id, read.error ? { status: "failed", error: read.error } : { status: "done", text: read.text });
      }
      if (result.usage) setCost((previous) => {
        const next = calcCost(result.usage, result.model);
        return previous ? { ...next, cost: previous.cost + next.cost } : next;
      });
    } catch (e) {
      for (const slide of batch) patch(slide.id, { status: "failed", error: e.message });
    }
  }

  async function addFiles(fileList) {
    setError("");
    const files = [...(fileList || [])];
    if (!files.length) return;
    const room = MAX_SLIDES - slides.length;
    if (room <= 0) { setError(`At most ${MAX_SLIDES} slides per meeting.`); return; }
    const accepted = files.slice(0, room);
    if (accepted.length < files.length) setError(`Only ${room} more slide${room !== 1 ? "s" : ""} fit — ${files.length - room} left out.`);

    const prepared = [];
    for (const file of accepted) {
      try {
        prepared.push(await prepareSlideImage(file));
      } catch (e) {
        setError((previous) => [previous, e.message].filter(Boolean).join(" "));
      }
    }
    if (!prepared.length) return;
    setSlides((current) => [...current, ...prepared]);
    await readSlides(prepared);
  }

  function remove(id) {
    setSlides((current) => current.filter((slide) => slide.id !== id));
  }

  function move(id, direction) {
    setSlides((current) => {
      const index = current.findIndex((slide) => slide.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  const doneCount = slides.filter((slide) => slide.status === "done").length;
  const failed = slides.filter((slide) => slide.status === "failed");

  return (
    <div className="mt-4 rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-medium text-gray-800">Slides shown in the meeting <span className="font-normal text-gray-400">(optional)</span></p>
          <p className="text-xs text-gray-500 mt-0.5">
            Screenshot the deck and drop the images here. Each slide is read into text by {providerLabel(resolvedModel)} and becomes a source the
            notes can cite as [S#] — figures and product names on a slide count even when nobody read them aloud.
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
        <p className="text-sm text-gray-600">Drop slide screenshots here, or click to choose</p>
        <p className="text-[11px] text-gray-400 mt-1">PNG, JPEG, WebP · resized to 1600px before upload · up to {MAX_SLIDES} per meeting</p>
      </div>

      <p className="text-[11px] text-amber-700">
        Images are sent to the model as they are — privacy replacements apply to the text that comes back, not to what is in the picture.
        Crop out anything that should not leave your machine before dropping it here.
      </p>

      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

      {slides.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {doneCount} of {slides.length} read{busy ? " · reading…" : ""}{failed.length ? ` · ${failed.length} failed` : ""}
            </span>
            {failed.length > 0 && !busy && (
              <button type="button" onClick={() => readSlides(failed)} className="underline text-obsidian-700">Retry failed</button>
            )}
          </div>
          <ul className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {slides.map((slide, index) => (
              <li key={slide.id} className="rounded-lg border border-gray-200 overflow-hidden bg-white">
                {/* A local data URL preview; next/image has nothing to optimize here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={slide.previewUrl} alt={`Slide ${index + 1}`} className="w-full aspect-video object-cover bg-gray-100" />
                <div className="p-1.5 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-medium text-gray-700 truncate" title={slide.name}>S{index + 1} · {slide.name}</span>
                    <span
                      className={`text-[10px] rounded-full px-1.5 border ${
                        slide.status === "done" ? "text-green-700 bg-green-50 border-green-200"
                          : slide.status === "failed" ? "text-red-700 bg-red-50 border-red-200"
                          : "text-gray-500 bg-gray-50 border-gray-200"
                      }`}
                      title={slide.error || (slide.status === "done" ? `${slide.text.length} characters read` : "")}
                    >
                      {slide.status === "reading" ? "reading…" : slide.status}
                    </span>
                  </div>
                  {slide.status === "done" && (
                    <details>
                      <summary className="cursor-pointer text-[10px] text-gray-500">What was read</summary>
                      <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-snug text-gray-700">{slide.text}</pre>
                    </details>
                  )}
                  {slide.status === "failed" && <p className="text-[10px] text-red-700">{slide.error}</p>}
                  <div className="flex items-center gap-2 text-[10px] text-gray-400">
                    <button type="button" onClick={() => move(slide.id, -1)} disabled={index === 0} className="hover:text-gray-700 disabled:opacity-30" title="Move earlier">←</button>
                    <button type="button" onClick={() => move(slide.id, 1)} disabled={index === slides.length - 1} className="hover:text-gray-700 disabled:opacity-30" title="Move later">→</button>
                    <button type="button" onClick={() => remove(slide.id)} className="ml-auto text-red-400 hover:text-red-600">remove</button>
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
