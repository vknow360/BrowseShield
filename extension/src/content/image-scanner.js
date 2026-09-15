import browser from "webextension-polyfill";
// OCR runs in the content script (not the MV3 service worker) because
// tesseract.js references `window` at load time, which throws
// "window is not defined" inside an MV3 background worker and silently
// kills the SW. The content-script world has `window`, so this works.
import { ocrRegion } from "../core/vision/ocr.js";

// Live DOM face redaction is disabled because redaction is handled for the agent
// in the background screenshot pipeline (redactor.js). We also provide a helper to
// remove any leftover overlay divs from the DOM.
export function clearDomFaceRedactions() {
  document.querySelectorAll(".browseshield-face-redaction").forEach((el) => el.remove());
}

export async function scanImagesAndRedact() {
  // Blur is strictly for agent screenshots, not for live DOM.
  clearDomFaceRedactions();
}


export async function scanCanvasesForOCR() {
  const targets = Array.from(
    document.querySelectorAll('canvas:not([data-ocr="true"])'),
  );
  if (targets.length === 0) return;

  console.log(`[BrowseShield] Found ${targets.length} new canvas(es). Running OCR...`);

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
        `[BrowseShield] OCR returned ${results?.length ?? 0} word(s) on canvas.`,
      );
      if (results && results.length > 0) {
        injectSyntheticOCRNodes(canvas, results);
        canvas.setAttribute("data-ocr", "true");
      }
      // If OCR returned nothing, do NOT mark the canvas processed — a later
      // rescan (after the canvas is fully drawn) will retry.
    } catch (e) {
      console.warn("[BrowseShield] Failed to scan canvas for OCR:", e);
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
    console.log(`[BrowseShield] Injected ${results.length} OCR nodes into DOM.`);
    // Dispatch an input event to trigger a rescan in dom-walker
    document.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
