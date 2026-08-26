/// <reference types="chrome" />

// src/background/index.js
// Service Worker: Central extension coordinator and message hub

// 1. Lifecycle: Triggered on extension installation or update
chrome.runtime.onInstalled.addListener(() => {
  console.log('[ShieldBrowse] Background Service Worker initialized.');
});

// 2. Configure Side Panel to open on toolbar action click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error('[ShieldBrowse] Failed to set side panel behavior:', err));

// 3. Central message dispatcher
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[ShieldBrowse SW] Received:', message.type, 'from tab:', sender.tab?.id);

  if (message.type === 'ping') {
    // Relay page scan payload to active Side Panel UI
    chrome.runtime.sendMessage({
      type: 'update-panel',
      payload: message.payload
    }).catch(() => {
      // Normal if side panel is currently closed
    });

    sendResponse({ status: 'received', timestamp: Date.now() });
  }

  // Keep message channel open for async responses
  return true;
});
