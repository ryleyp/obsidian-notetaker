"use client";

import { MAX_SLIDE_EDGE } from "./slides";
import { slideFromCanvas } from "./slideImages";

// An exported deck as one PDF: every page is drawn onto a canvas in the
// browser and becomes a slide, so a PDF and a folder of screenshots end up
// as the same thing — one [S#] per page, one vision read per page, the
// same thumbnails and retry. pdf.js is loaded only when a PDF actually
// arrives; nothing else in the app pays for it.

export const PDF_MEDIA_TYPE = "application/pdf";

export function isPdfFile(file) {
  return file?.type === PDF_MEDIA_TYPE || /\.pdf$/i.test(file?.name || "");
}

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
      // The worker ships as a separate module, copied into public/ on
      // install (scripts/copy-pdf-worker.mjs) so parsing runs off the main
      // thread under dev and production alike.
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

// Renders each page to a slide record. `maxPages` is the room left under the
// per-meeting cap; pages past it are reported, not silently dropped.
export async function pdfToSlides(file, { maxPages = Infinity, maxEdge = MAX_SLIDE_EDGE, onProgress } = {}) {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  // In pdf.js 6 the loading task owns teardown; the document proxy only has cleanup().
  const loadingTask = pdfjs.getDocument({ data: buffer });
  const document = await loadingTask.promise;
  const total = document.numPages;
  const pageCount = Math.min(total, maxPages);
  const base = file.name.replace(/\.pdf$/i, "");
  const slides = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const unscaled = page.getViewport({ scale: 1 });
      // PDF points are 72/in — a 13.33in-wide slide is only 960pt — so unlike
      // a screenshot the page is usually scaled UP to reach maxEdge; text
      // rendered at 960px is noticeably harder for the model to read.
      const scale = maxEdge / Math.max(unscaled.width, unscaled.height);
      const viewport = page.getViewport({ scale });

      const canvas = window.document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      page.cleanup();

      slides.push(slideFromCanvas(canvas, `${base} — page ${pageNumber}`));
      onProgress?.({ done: pageNumber, of: pageCount });
    }
  } finally {
    await loadingTask.destroy();
  }

  return { slides, totalPages: total, skippedPages: total - pageCount };
}
