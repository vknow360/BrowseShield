/// <reference types="chrome" />

// src/ui/sidepanel/index.js

import browser from "webextension-polyfill";
import "./index.css";
import { maskValue } from "../../core/tokenizer/tokenizer.js";
import { generateAuditReport, downloadReport } from "../../core/audit/report-generator.js";

const outputBox = document.getElementById("output-box");
const statusBadge = document.getElementById("status-badge");
const piiListContainer = document.getElementById("pii-list");
const piiCountBadge = document.getElementById("pii-count-badge");
const gateBadge = document.getElementById("gate-badge");
const runAgentBtn = document.getElementById("run-agent-btn");
const agentStatus = document.getElementById("agent-status");
const taskInput = document.getElementById("task-instruction");

let lastPayload = null;
let agentRunning = false;
let sessionBlockCount = 0;

// Connect to background agent loop
const port = browser.runtime.connect({ name: "agent-panel" });

port.onMessage.addListener((msg) => {
  if (msg.type === "state") {
    renderAgentState(msg);
  } else if (msg.type === "update-panel") {
    renderScanPayload(msg.payload);
  } else if (msg.type === "privacy-violation") {
    renderViolationPayload(msg.payload);
  } else if (msg.type === "vlm-request-preview") {
    renderVlmPreview(msg.payload);
  }
});

function renderAgentState(stateObj) {
  const { state, step, maxSteps, errorReason, detail } = stateObj;
  
  if (state === "idle") {
    agentRunning = false;
    runAgentBtn.textContent = "▶️ Run Agent";
    agentStatus.textContent = "Ready.";
    runAgentBtn.disabled = false;
  } else if (state === "planning") {
    agentRunning = true;
    runAgentBtn.textContent = "⏹️ Stop Agent";
    agentStatus.textContent = `⏳ Step ${step}/${maxSteps} — thinking...`;
    runAgentBtn.disabled = false;
  } else if (state === "executing") {
    agentRunning = true;
    runAgentBtn.textContent = "⏹️ Stop Agent";
    const targetInfo = typeof detail.target === "object" ? `(${detail.target.x},${detail.target.y})` : detail.target || "";
    agentStatus.textContent = `🎯 Step ${step}: Executing (${detail.action} → ${targetInfo})`;
    runAgentBtn.disabled = false;
  } else if (state === "waiting-for-settle") {
    agentRunning = true;
    runAgentBtn.textContent = "⏹️ Stop Agent";
    agentStatus.textContent = `🔄 Step ${step}: Waiting for page to settle...`;
    runAgentBtn.disabled = false;
  } else if (state === "done") {
    agentRunning = false;
    runAgentBtn.textContent = "▶️ Run Agent";
    agentStatus.textContent = `✅ Done in ${step} step(s): ${detail || "Task completed."}`;
    runAgentBtn.disabled = false;
  } else if (state === "error") {
    agentRunning = false;
    runAgentBtn.textContent = "▶️ Run Agent";
    let message = errorReason;
    if (errorReason === "content-script-unreachable") {
      message = "Page unreachable. Please refresh the web page (F5) and try again.";
    } else if (errorReason === "restricted-page") {
      message = "Cannot run on browser internal page. Please switch to a web tab (e.g. localhost:5173).";
    } else if (errorReason === "no-active-tab") {
      message = "No active web tab detected. Please click onto a web tab.";
    } else if (errorReason === "network-error") {
      message = "Server unreachable. Check server status or settings (⚙️).";
    }
    agentStatus.textContent = `❌ ${message}`;
    runAgentBtn.disabled = false;
  }
}

runAgentBtn.addEventListener("click", () => {
  if (agentRunning) {
    port.postMessage({ type: "stop-agent" });
  } else {
    const taskInstruction = taskInput.value.trim() || "Fill out this form";
    port.postMessage({ type: "start-agent", task: taskInstruction });
  }
});

function renderScanPayload(payload) {
  if (!payload) return;
  lastPayload = payload;
  const { candidates = [], nodes = [], tokenSummary } = payload;
  
  // 1. Update Connection Status
  if (statusBadge) {
    statusBadge.textContent = "Active";
    statusBadge.className = "badge active";
  }

  // 2. Update PII Count Badge
  if (piiCountBadge) {
    piiCountBadge.textContent = `${candidates.length} PII Items`;
    piiCountBadge.className =
      candidates.length > 0 ? "count-badge danger" : "count-badge";
  }

  // 3. Render PII List
  if (piiListContainer) {
    if (!candidates || candidates.length === 0) {
      piiListContainer.innerHTML =
        '<p class="empty-state">No PII detected on active page.</p>';
    } else {
      piiListContainer.innerHTML = candidates
        .map(
          (item) => `
        <div class="pii-item">
          <div class="pii-item-header">
            <span class="pii-badge tag-${(item.entityType || "").toLowerCase()}">${item.entityType}</span>
            <span class="pii-source">DOM (${Math.round((item.confidence || 1) * 100)}%)</span>
          </div>
          <div class="pii-item-body">
            <span class="pii-value">${maskValue(item.realValue, item.entityType)}</span>
          </div>
        </div>
      `,
        )
        .join("");
    }
  }

  // 4. Update Raw JSON output
  if (outputBox) {
    outputBox.textContent = JSON.stringify(
      nodes || [],
      null,
      2,
    );
  }

  // 5. Update Gate Status (Pass)
  if (gateBadge) {
    gateBadge.textContent = "🔒 GATE: PASS";
    gateBadge.className = "badge gate-pass";
  }
}

function renderVlmPreview(reqBody) {
  if (!reqBody) return;
  
  if (reqBody.redactedImage) {
    document.getElementById("vlm-preview-container").style.display = "block";
    document.getElementById("vlm-redacted-image").src = reqBody.redactedImage;
    if (reqBody.originalImage) {
      document.getElementById("vlm-original-image").src = reqBody.originalImage;
    }
  }

  // Render confidence overlays
  const overlayContainer = document.getElementById("confidence-overlays");
  if (overlayContainer && reqBody.uiBoxes) {
    overlayContainer.innerHTML = "";
    reqBody.uiBoxes.forEach(box => {
      if (box.conf !== undefined) {
        const div = document.createElement("div");
        div.className = "conf-box";
        div.style.left = `${box.x}px`;
        div.style.top = `${box.y}px`;
        div.style.width = `${box.w}px`;
        div.style.height = `${box.h}px`;
        
        const label = document.createElement("div");
        label.className = "conf-label";
        label.textContent = `${Math.round(box.conf * 100)}%`;
        div.appendChild(label);
        
        overlayContainer.appendChild(div);
      }
    });
  }
  
  const tokenizedInputs = (reqBody.sanitizedDom || []).filter(node => {
    const hasToken = (str) => /\[\[.*?\]\]/.test(str || "");
    return hasToken(node.value) || hasToken(node.label);
  }).map(node => ({
    tagName: node.tagName,
    label: node.label,
    value: node.value,
    selector: node.selector
  }));
  
  const previewData = {
    taskInstruction: reqBody.taskInstruction,
    tokenTypes: reqBody.tokenTypes,
    tokenizedInputs: tokenizedInputs,
    actionHistory: reqBody.actionHistory || [],
    uiBoxes: reqBody.uiBoxes || []
  };
  
  if (outputBox) {
    outputBox.textContent = JSON.stringify(previewData, null, 2);
  }
}

function renderViolationPayload(payload) {
  if (!payload) return;
  sessionBlockCount++;
  if (gateBadge) {
    const violationsCount = payload.violations?.length || 0;
    gateBadge.textContent = `🔒 GATE: BLOCKED (${violationsCount})`;
    gateBadge.className = "badge gate-blocked";
  }

  if (outputBox && payload.violations) {
    outputBox.textContent =
      "🚨 PRIVACY BOUNDARY VIOLATION PREVENTED\n\nThe following raw PII was detected in the outbound payload and blocked from leaving the browser:\n\n" +
      JSON.stringify(payload.violations, null, 2);
  }
}

// Global fallback listener for messages not handled by the port
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "privacy-violation") {
    renderViolationPayload(message.payload);
  } else if (message.type === "AUDIT_EVENT") {
    renderAuditEvent(message.payload);
  }
});

const auditFeed = document.getElementById("audit-log-feed");
function renderAuditEvent(event) {
  if (!auditFeed) return;
  
  // Remove empty state if present
  const emptyState = auditFeed.querySelector(".empty-state");
  if (emptyState) emptyState.remove();

  const entry = document.createElement("div");
  entry.style.borderBottom = "1px solid #2d3748";
  entry.style.padding = "4px 0";
  entry.style.marginBottom = "4px";

  const time = new Date(event.timestamp).toLocaleTimeString();
  let color = "#a0aec0";
  if (event.event === "PRIVACY_GATE_BLOCKED") color = "#fc8181";
  if (event.event === "PII_DETECTED") color = "#f6ad55";
  if (event.event === "SERVER_REQUEST_SENT") color = "#68d391";

  entry.innerHTML = `
    <div style="color: ${color}; font-weight: bold;">[${time}] ${event.event}</div>
    <div style="color: #cbd5e0; white-space: pre-wrap; font-family: monospace;">${JSON.stringify(event, (k, v) => (k === 'id' || k === 'timestamp' || k === 'event' ? undefined : v), 2)}</div>
  `;
  
  auditFeed.prepend(entry);
  
  // Keep only last 50 in UI to prevent lag
  if (auditFeed.children.length > 50) {
    auditFeed.lastElementChild.remove();
  }
}

const exportAuditBtn = document.getElementById("export-audit-btn");
if (exportAuditBtn) {
  exportAuditBtn.addEventListener("click", () => {
    const markdown = generateAuditReport(lastPayload, sessionBlockCount);
    downloadReport(markdown);
  });
}

// Settings logic
const toggleSettingsBtn = document.getElementById("toggle-settings-btn");
const settingsPanel = document.getElementById("settings-panel");
const serverEndpointInput = document.getElementById("server-endpoint");
const saveSettingsBtn = document.getElementById("save-settings-btn");
const settingsStatus = document.getElementById("settings-status");

if (toggleSettingsBtn && settingsPanel) {
  toggleSettingsBtn.addEventListener("click", () => {
    const isCollapsed = settingsPanel.classList.toggle("collapsed");
    toggleSettingsBtn.classList.toggle("active", !isCollapsed);
    if (!isCollapsed && serverEndpointInput) {
      serverEndpointInput.focus();
    }
  });
}

browser.storage.local.get(["serverEndpoint"]).then((result) => {
  if (result.serverEndpoint && serverEndpointInput) {
    serverEndpointInput.value = result.serverEndpoint;
  }
});

function handleSaveSettings() {
  if (!serverEndpointInput) return;
  const endpoint = serverEndpointInput.value.trim() || "http://localhost:8000";
  browser.storage.local.set({ serverEndpoint: endpoint }).then(() => {
    settingsStatus.textContent = "Saved!";
    setTimeout(() => { settingsStatus.textContent = ""; }, 2000);
  });
}

if (saveSettingsBtn) {
  saveSettingsBtn.addEventListener("click", handleSaveSettings);
}

if (serverEndpointInput) {
  serverEndpointInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      handleSaveSettings();
    }
  });
}

// Slider logic
const imageSlider = document.getElementById("image-slider");
const redactedImage = document.getElementById("vlm-redacted-image");

if (imageSlider && redactedImage) {
  imageSlider.addEventListener("input", (e) => {
    const val = e.target.value;
    redactedImage.style.clipPath = `inset(0 0 0 ${val}%)`;
  });
}

// Request initial state on startup
port.postMessage({ type: "request-current-state" });
