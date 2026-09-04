import browser from "webextension-polyfill";

const OFFSCREEN_DOCUMENT_PATH = browser.runtime.getURL("offscreen.html");
let offscreenReady = false;
let initPromise = null;

async function ensureOffscreenDocument() {
  if (offscreenReady) return;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    const existingContexts = await browser.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [OFFSCREEN_DOCUMENT_PATH],
    });

    if (existingContexts.length === 0) {
      await browser.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["DOM_SCRAPING"],
        justification: "Run on-device vision pipeline (MediaPipe + ONNX Runtime) outside Service Worker",
      });
      await new Promise(r => setTimeout(r, 200));
    }

    offscreenReady = true;
  })();

  return initPromise;
}

async function sendToOffscreen(type, payload = {}) {
  await ensureOffscreenDocument();
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Offscreen document timed out"));
    }, 30000);

    function listener(message, sender, sendResponse) {
      if (message.requestId === requestId) {
        clearTimeout(timeout);
        chrome.runtime.onMessage.removeListener(listener);
        if (message.status === "success") {
          resolve(message.result);
        } else {
          reject(new Error(message.error || "Offscreen error"));
        }
      }
    }

    chrome.runtime.onMessage.addListener(listener);
    chrome.runtime.sendMessage({
      target: "offscreen",
      type,
      requestId,
      payload,
    });
  });
}

export async function initVisionPipelineOffscreen() {
  await ensureOffscreenDocument();
  return sendToOffscreen("INIT_VISION");
}

export async function perceiveScreenOffscreen(imageBitmap, nodes = []) {
  const bitmap = await imageBitmap;
  const dataUri = await bitmapToDataUri(bitmap);
  try {
    return await sendToOffscreen("PERCEIVE_SCREEN", { dataUri, nodes });
  } finally {
    bitmap.close();
  }
}

export async function detectFacesOffscreen(imageBitmap) {
  const bitmap = await imageBitmap;
  const dataUri = await bitmapToDataUri(bitmap);
  try {
    return await sendToOffscreen("DETECT_FACES", { dataUri });
  } finally {
    bitmap.close();
  }
}

async function bitmapToDataUri(bitmap) {
  const blob = await new Response(bitmap).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
