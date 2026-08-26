/// <reference types="chrome" />

// src/ui/sidepanel/index.js

const outputBox = document.getElementById('output-box');
const statusBadge = document.getElementById('status-badge');
const piiListContainer = document.getElementById('pii-list');
const piiCountBadge = document.getElementById('pii-count-badge');

// Helper to partially mask values for privacy preview
function maskValue(val, type) {
  if (type === 'PASSWORD') return '••••••••';
  const s = String(val).trim();
  if (s.length <= 4) return '••••';
  return s.substring(0, 2) + '•'.repeat(Math.max(s.length - 4, 3)) + s.substring(s.length - 2);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'update-panel') {
    const { piiList, metrics, fields } = message.payload;

    // 1. Update Connection Status
    if (statusBadge) {
      statusBadge.textContent = 'Active';
      statusBadge.className = 'badge active';
    }

    // 2. Update PII Count Badge
    if (piiCountBadge) {
      piiCountBadge.textContent = `${piiList.length} PII Items`;
      piiCountBadge.className = piiList.length > 0 ? 'count-badge danger' : 'count-badge';
    }

    // 3. Render PII List
    if (piiListContainer) {
      if (!piiList || piiList.length === 0) {
        piiListContainer.innerHTML = '<p class="empty-state">No PII detected on active page.</p>';
      } else {
        piiListContainer.innerHTML = piiList
          .map(
            (item) => `
          <div class="pii-item">
            <div class="pii-item-header">
              <span class="pii-badge tag-${item.entityType.toLowerCase()}">${item.entityType}</span>
              <span class="pii-source">${item.source} (${Math.round(item.confidence * 100)}%)</span>
            </div>
            <div class="pii-item-body">
              <span class="pii-label">${item.label || item.fieldId || 'Unnamed field'}:</span>
              <span class="pii-value">${maskValue(item.value, item.entityType)}</span>
            </div>
          </div>
        `
          )
          .join('');
      }
    }

    // 4. Update Raw JSON output
    if (outputBox) {
      outputBox.textContent = JSON.stringify(message.payload, null, 2);
    }
  }
});
