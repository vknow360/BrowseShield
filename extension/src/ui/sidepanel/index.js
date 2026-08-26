/// <reference types="chrome" />

// src/ui/sidepanel/index.js
// Runs inside the persistent Side Panel UI

const outputBox = document.getElementById('output-box');
const statusBadge = document.getElementById('status-badge');

// Listen for updates forwarded from Service Worker
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'update-panel') {
    if (statusBadge) {
      statusBadge.textContent = 'Connected';
      statusBadge.className = 'badge active';
    }

    if (outputBox) {
      outputBox.textContent = JSON.stringify(message.payload, null, 2);
    }
  }
});
