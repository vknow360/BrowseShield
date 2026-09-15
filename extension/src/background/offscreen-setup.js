// src/background/offscreen-setup.js

let creating = null;

export async function setupOffscreenDocument(path = 'src/offscreen/index.html') {
  if (typeof chrome === "undefined" || !chrome.offscreen) {
    return;
  }

  const offscreenUrl = chrome.runtime.getURL(path);

  try {
    if (typeof chrome.runtime?.getContexts === 'function') {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });
      if (contexts && contexts.length > 0) {
        return;
      }
    } else if (typeof chrome.offscreen?.hasDocument === 'function') {
      if (await chrome.offscreen.hasDocument()) {
        return;
      }
    }
  } catch (err) {
    console.warn("[OffscreenSetup] Context check warning:", err);
  }

  if (creating) {
    await creating;
    return;
  }

  creating = (async () => {
    try {
      await chrome.offscreen.createDocument({
        url: path,
        reasons: ['DOM_PARSER', 'WEB_RTC'],
        justification: 'Running heavy ML models in offscreen document to avoid SW crashes'
      });
    } catch (err) {
      if (!err?.message?.includes('Only a single offscreen document')) {
        console.error("[OffscreenSetup] Failed to create offscreen document:", err);
      }
    } finally {
      creating = null;
    }
  })();

  await creating;
}
