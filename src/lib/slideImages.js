"use client";

import { MAX_SLIDE_EDGE, SLIDE_MEDIA_TYPES } from "./slides";

// Browser-side preparation of a slide before upload: downscale to the
// longest edge the model needs, re-encode as JPEG, and hand back base64.
// A 4K PNG screenshot is several megabytes and gains nothing over a 1600px
// JPEG for reading slide text — but costs real tokens and upload time.
// PDF pages arrive here already drawn onto a canvas and take the same exit.

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} could not be read as an image.`)); };
    image.src = url;
  });
}

// The scale that brings the longest edge down to maxEdge, never up.
export function fitScale(width, height, maxEdge = MAX_SLIDE_EDGE) {
  return Math.min(1, maxEdge / Math.max(width, height));
}

// A slide record from a drawn canvas — the one exit both screenshots and
// rendered PDF pages take, so they are indistinguishable downstream.
export function slideFromCanvas(canvas, name, { quality = 0.86 } = {}) {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    mediaType: "image/jpeg",
    data,
    previewUrl: dataUrl,
    width: canvas.width,
    height: canvas.height,
    text: "",
    status: "pending", // pending | reading | done | failed
    error: "",
  };
}

export async function prepareSlideImage(file, { maxEdge = MAX_SLIDE_EDGE, quality = 0.86 } = {}) {
  if (!SLIDE_MEDIA_TYPES.includes(file.type)) throw new Error(`${file.name}: only PNG, JPEG, WebP, or GIF screenshots are supported.`);
  const image = await loadImage(file);
  const scale = fitScale(image.naturalWidth, image.naturalHeight, maxEdge);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  // Slides are usually on a white deck; a transparent PNG would otherwise
  // turn black when re-encoded as JPEG.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);

  return slideFromCanvas(canvas, file.name, { quality });
}
