/// <reference types="chrome" />

// src/ui/popup/index.js

document.getElementById('open-panel-btn')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    chrome.sidePanel.open({ tabId: tab.id });
    window.close();
  }
});
