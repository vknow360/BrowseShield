import browser from "webextension-polyfill";
// OCR runs in the content script (not the MV3 service worker) because
// tesseract.js references `window` at load time, which throws
// "window is not defined" inside an MV3 background worker and silently
// kills the SW. The content-script world has `window`, so this works.
import { ocrRegion } from "../core/vision/ocr.js";

export async function scanImagesAndRedact() {
  const images = Array.from(
    document.querySelectorAll('img:not([data-redacted="true"])'),
  );
  if (images.length === 0) return;

  console.log(
    `[ShieldBrowse] Found ${images.length} new image(s). Running face detection...`,
  );

  for (const img of images) {
    if (img.width === 0 || img.height === 0) continue; // Skip invisible images

    try {
      // Convert img to Data URI using an offscreen canvas
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const dataUri = canvas.toDataURL("image/jpeg");

      // Send to Background SW for inference
      const response = await browser.runtime.sendMessage({
        type: "DETECT_FACES",
        payload: { dataUri, width: img.width, height: img.height },
      });

      if (
        response &&
        response.status === "success" &&
        response.faces &&
        response.faces.length > 0
      ) {
        applyRedactionBoxes(img, response.faces);
      }

      // Mark as processed
      img.setAttribute("data-redacted", "true");
    } catch (e) {
      console.warn("[ShieldBrowse] Failed to scan image for faces:", e);
    }
  }
}

function applyRedactionBoxes(img, faces) {
  const rect = img.getBoundingClientRect();

  faces.forEach((face) => {
    const box = face.boundingBox;

    // Create redaction div
    const redactionBox = document.createElement("div");
    redactionBox.className = "shieldbrowse-face-redaction";
    redactionBox.style.position = "absolute";
    redactionBox.style.backgroundColor = "black";
    redactionBox.style.zIndex = "999999";
    redactionBox.style.borderRadius = "4px";

    // Calculate absolute position on the page based on the image's layout box
    // Note: MediaPipe bounding box is relative to the image size sent (which was img.width)
    redactionBox.style.left = `${rect.left + window.scrollX + box.originX}px`;
    redactionBox.style.top = `${rect.top + window.scrollY + box.originY}px`;
    redactionBox.style.width = `${box.width}px`;
    redactionBox.style.height = `${box.height}px`;

    // Add title for debugging
    redactionBox.title = "Face Redacted by ShieldBrowse Vision Pipeline";

    document.body.appendChild(redactionBox);
  });

  console.log(`[ShieldBrowse] Redacted ${faces.length} face(s) over image.`);
}

export async function scanCanvasesForOCR() {
  const targets = Array.from(
    document.querySelectorAll('canvas:not([data-ocr="true"])'),
  );
  if (targets.length === 0) return;

  console.log(`[ShieldBrowse] Found ${targets.length} new canvas(es). Running OCR...`);

  for (const canvas of targets) {
    if (canvas.width === 0 || canvas.height === 0) continue;

    try {
      // Serialize the canvas to a data URI first: some sites draw to the
      // canvas asynchronously (after our initial content-script pass) and
      // Tesseract handling of a live HTMLCanvasElement pointer can miss
      // late paints. Sampling as a data URI freezes the pixels at scan time.
      const dataUri = canvas.toDataURL("image/png");
      const results = await ocrRegion(dataUri);
      console.log(
        `[ShieldBrowse] OCR returned ${results?.length ?? 0} word(s) on canvas.`,
      );
      if (results && results.length > 0) {
        injectSyntheticOCRNodes(canvas, results);
        canvas.setAttribute("data-ocr", "true");
      }
      // If OCR returned nothing, do NOT mark the canvas processed — a later
      // rescan (after the canvas is fully drawn) will retry.
    } catch (e) {
      console.warn("[ShieldBrowse] Failed to scan canvas for OCR:", e);
    }
  }
}

function injectSyntheticOCRNodes(sourceEl, results) {
  const rect = sourceEl.getBoundingClientRect();
  const scaleX = rect.width / (sourceEl.width || 1);
  const scaleY = rect.height / (sourceEl.height || 1);

  results.forEach((res) => {
    const hiddenInput = document.createElement("input");
    hiddenInput.type = "text";
    hiddenInput.value = res.text;
    hiddenInput.dataset.syntheticOcr = "true";
    hiddenInput.dataset.sbId = `ocr-${Math.random().toString(36).substring(2, 10)}`;
    
    // Position it invisibly over the exact text location so the walker finds its box
    hiddenInput.style.position = "absolute";
    hiddenInput.style.left = `${rect.left + window.scrollX + (res.box.x0 * scaleX)}px`;
    hiddenInput.style.top = `${rect.top + window.scrollY + (res.box.y0 * scaleY)}px`;
    hiddenInput.style.width = `${(res.box.x1 - res.box.x0) * scaleX}px`;
    hiddenInput.style.height = `${(res.box.y1 - res.box.y0) * scaleY}px`;
    hiddenInput.style.opacity = "0";
    hiddenInput.style.pointerEvents = "none";
    hiddenInput.style.zIndex = "-9999";
    
    document.body.appendChild(hiddenInput);
  });
  
  if (results.length > 0) {
    console.log(`[ShieldBrowse] Injected ${results.length} OCR nodes into DOM.`);
    // Dispatch an input event to trigger a rescan in dom-walker
    document.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
