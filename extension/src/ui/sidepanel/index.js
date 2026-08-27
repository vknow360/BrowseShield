/// <reference types="chrome" />

// src/ui/sidepanel/index.js

import browser from "webextension-polyfill";
import './index.css';
import { maskValue } from '../../core/tokenizer/tokenizer.js';

const outputBox = document.getElementById('output-box');
const statusBadge = document.getElementById('status-badge');
const piiListContainer = document.getElementById('pii-list');
const piiCountBadge = document.getElementById('pii-count-badge');
const gateBadge = document.getElementById('gate-badge');
const runAgentBtn = document.getElementById('run-agent-btn');
const agentStatus = document.getElementById('agent-status');
const taskInput = document.getElementById('task-instruction');

let lastPayload = null;

runAgentBtn.addEventListener('click', async () => {
  if (!lastPayload) {
    agentStatus.textContent = '❌ No active page data. Focus a web page first.';
    return;
  }
  
  const taskInstruction = taskInput.value.trim() || 'Fill out this form';
  
  runAgentBtn.disabled = true;
  agentStatus.textContent = '⏳ Asking AI (checking Privacy Gate)...';
  
  try {
    // Force a fresh scan to guarantee perfect scroll coordinates right before screenshot
    const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await browser.tabs.sendMessage(activeTab.id, { type: 'rescan' }).catch(() => {});
      await new Promise(r => setTimeout(r, 200)); // wait for background to receive ping
    }
    const bgRes = await browser.runtime.sendMessage({ type: 'get-latest-scan' }).catch(() => null);
    const freshPayload = bgRes?.scanPayload?.sanitizedPayload || lastPayload.sanitizedPayload;

    const response = await browser.runtime.sendMessage({
      type: 'run-agent',
      payload: {
        sanitizedPayload: freshPayload,
        tokenTypes: Array.isArray(freshPayload.tokenTypes)
          ? freshPayload.tokenTypes
          : Object.keys(freshPayload.tokenTypes || {}),
        taskInstruction,
        actionHistory: [] // Future: maintain history array here
      }
    });
    
    if (response.status === 'success') {
      agentStatus.textContent = `🎯 Action: ${response.action.action}`;
      
      // Dispatch action to active tab's content script
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await browser.tabs.sendMessage(tab.id, {
          type: 'execute-action',
          payload: { action: response.action }
        });
        agentStatus.textContent = `✅ Executed: ${response.action.action}`;
      } else {
        agentStatus.textContent = '❌ Could not find active tab to execute action.';
      }
    } else {
      agentStatus.textContent = `❌ ${response.error || 'Unknown error'}`;
    }
  } catch (err) {
    agentStatus.textContent = `❌ Extension Error: ${err.message}`;
  } finally {
    runAgentBtn.disabled = false;
  }
});

function renderScanPayload(payload) {
  if (!payload) return;
  lastPayload = payload;
  const { piiList = [], metrics, fields, sanitizedPayload } = payload;

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
            <span class="pii-badge tag-${(item.entityType || '').toLowerCase()}">${item.entityType}</span>
            <span class="pii-source">${item.source} (${Math.round((item.confidence || 1) * 100)}%)</span>
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
  if (outputBox && sanitizedPayload) {
    outputBox.textContent = JSON.stringify(sanitizedPayload.nodes || [], null, 2);
  }
  
  // 5. Update Gate Status (Pass)
  if (gateBadge) {
    gateBadge.textContent = '🔒 GATE: PASS';
    gateBadge.className = 'badge gate-pass';
  }
}

function renderViolationPayload(payload) {
  if (!payload) return;
  if (gateBadge) {
    const violationsCount = payload.violations?.length || 0;
    gateBadge.textContent = `🔒 GATE: BLOCKED (${violationsCount})`;
    gateBadge.className = 'badge gate-blocked';
  }
  
  if (outputBox && payload.violations) {
    outputBox.textContent = "🚨 PRIVACY BOUNDARY VIOLATION PREVENTED\n\nThe following raw PII was detected in the outbound payload and blocked from leaving the browser:\n\n" + JSON.stringify(payload.violations, null, 2);
  }
}

// Listen for messages from background
browser.runtime.onMessage.addListener((message) => {
  if (message.type === 'update-panel') {
    renderScanPayload(message.payload);
  } else if (message.type === 'privacy-violation') {
    renderViolationPayload(message.payload);
  }
});

// On side panel startup: get latest cached scan and request active tab to rescan
(async function initPanel() {
  try {
    // 1. Check if background already has cached scan result
    const bgRes = await browser.runtime.sendMessage({ type: 'get-latest-scan' }).catch(() => null);
    if (bgRes?.scanPayload) {
      renderScanPayload(bgRes.scanPayload);
    } else if (bgRes?.violationPayload) {
      renderViolationPayload(bgRes.violationPayload);
    }

    // 2. Trigger active tab to perform a fresh scan
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: 'rescan' }).catch(() => {
        // Tab might be chrome:// or un-injected page
      });
    }
  } catch (err) {
    console.warn('[ShieldBrowse Panel] Initial scan sync error:', err);
  }
})();
