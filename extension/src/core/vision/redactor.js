// src/core/vision/redactor.js
// Bakes pixel-level redaction (face blur + password/PII blackout) into a screenshot
// before it ever leaves the browser. Canvases are module-scoped and reused across calls
// to avoid per-call allocation churn.

let mainCanvas = null;
let scratchCanvas = null;

/** Returns a reused OffscreenCanvas resized to (w, h) with its 2D context. */
function getCanvas(which, w, h) {
  let canvas = which === "main" ? mainCanvas : scratchCanvas;
  if (!canvas) {
    canvas = new OffscreenCanvas(w, h);
    if (which === "main") mainCanvas = canvas;
    else scratchCanvas = canvas;
  } else if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  return { canvas, ctx: canvas.getContext("2d") };
}

/**
 * Redacts sensitive areas on a screenshot and returns a JPEG data URL.
 * All boxes must be in the same pixel coordinate space as `imageBitmap`.
 * @param {ImageBitmap} imageBitmap - the captured (already downscaled) screenshot
 * @param {Object} options
 * @param {Array<{x:number,y:number,w:number,h:number}>} [options.faceBoxes] - vision-detected faces
 * @param {Array<{x:number,y:number,w:number,h:number}>} [options.piiFieldBoxes] - DOM PII field boxes
 * @param {Array<{x:number,y:number,w:number,h:number}>} [options.passwordBoxes] - DOM password boxes
 * @returns {Promise<string>} JPEG data URL of the redacted image
 */
export async function redactScreenshot(
  imageBitmap,
  { faceBoxes = [], piiFieldBoxes = [], passwordBoxes = [] },
) {
  const { width, height } = imageBitmap;
  const { canvas, ctx } = getCanvas("main", width, height);

  ctx.drawImage(imageBitmap, 0, 0);

  // 1. Gaussian-blur faces (only allocate the scratch canvas when there are faces).
  if (faceBoxes.length > 0) {
    const { ctx: sCtx } = getCanvas("scratch", width, height);
    for (const box of faceBoxes) {
      const margin = Math.max(box.w, box.h) * 0.2;
      const x = Math.max(0, box.x - margin);
      const y = Math.max(0, box.y - margin);
      const w = Math.min(width - x, box.w + margin * 2);
      const h = Math.min(height - y, box.h + margin * 2);
      if (w <= 0 || h <= 0) continue;

      sCtx.clearRect(0, 0, width, height);
      sCtx.filter = "blur(15px)";
      sCtx.drawImage(imageBitmap, x, y, w, h, x, y, w, h);
      sCtx.filter = "none";
      ctx.drawImage(scratchCanvas, x, y, w, h, x, y, w, h);
    }
  }

  // 2. Solid blackout for password + detected-PII field regions.
  const blackoutBoxes = piiFieldBoxes.length + passwordBoxes.length;
  if (blackoutBoxes > 0) {
    ctx.fillStyle = "black";
    const pad = 2;
    for (const box of [...piiFieldBoxes, ...passwordBoxes]) {
      ctx.fillRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
    }
  }

  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  return blobToDataURL(blob);
}

async function blobToDataURL(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}
