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
const resumeAgentBtn = document.getElementById("resume-agent-btn");
const agentWaitingNotice = document.getElementById("agent-waiting-notice");
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
  const { state, step, maxSteps, errorReason, detail, isWaitingForUser, waitingReason } = stateObj;

  // Hide resume button and notice by default
  resumeAgentBtn.style.display = "none";
  agentWaitingNotice.style.display = "none";
  runAgentBtn.style.display = "block";
  
  if (state === "idle") {
    agentRunning = false;
    runAgentBtn.textContent = "▶️ Run Agent";
    agentStatus.textContent = "Ready.";
    runAgentBtn.disabled = false;
  } else if (state === "waiting-for-user") {
    agentRunning = true;
    runAgentBtn.style.display = "none"; // Hide Stop button when Resume is shown
    agentStatus.textContent = `⏸️ Step ${step}: Waiting for user input...`;
    resumeAgentBtn.style.display = "block";
    agentWaitingNotice.style.display = "block";
    agentWaitingNotice.textContent = waitingReason || detail || "Please complete the required field and click Resume.";
  } else if (state === "planning") {
    agentRunning = true;
    runAgentBtn.textContent = "⏹️ Stop Agent";
    agentStatus.textContent = `⏳ Step ${step}/${maxSteps} — thinking...`;
    runAgentBtn.disabled = false;
  } else if (state === "executing") {
    agentRunning = true;
    runAgentBtn.textContent = "⏹️ Stop Agent";
    const targetInfo = detail && typeof detail.target === "object" ? `(${detail.target.x},${detail.target.y})` : (detail?.target || "");
    agentStatus.textContent = `🎯 Step ${step}: Executing (${detail?.action || "?"} → ${targetInfo})`;
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
    agentStatus.textContent = `❌ Error: ${errorReason}`;
    runAgentBtn.disabled = false;
  }
}

taskInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (resumeAgentBtn.style.display !== "none") {
      // If waiting for user, enter resumes
      resumeAgentBtn.click();
    } else if (!agentRunning) {
      // If idle, enter starts the agent
      runAgentBtn.click();
    } else {
      // If running, enter stops the agent
      runAgentBtn.click();
    }
  }
});

runAgentBtn.addEventListener("click", () => {
  if (agentRunning) {
    port.postMessage({ type: "stop-agent" });
  } else {
    const taskInstruction = taskInput.value.trim() || "Fill out this form";
    port.postMessage({ type: "start-agent", task: taskInstruction });
  }
});

resumeAgentBtn.addEventListener("click", () => {
  const taskInstruction = taskInput.value.trim() || "Fill out this form";
  port.postMessage({ type: "resume-agent", task: taskInstruction });
  resumeAgentBtn.style.display = "none";
  runAgentBtn.style.display = "block";
  runAgentBtn.textContent = "⏹️ Stop Agent";
  agentWaitingNotice.style.display = "none";
});

function renderScanPayload(payload) {
  if (!payload) return;
  lastPayload = payload;
  const { candidates = [], nodes = [], tokenSummary } = payload;
  
  // Note: Since background tokenizes, we use the candidates + tokenSummary to display the PII
  // We'll construct a simplified view based on what the tokenizer mapped.
  
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
  }
});

const exportAuditBtn = document.getElementById("export-audit-btn");
if (exportAuditBtn) {
  exportAuditBtn.addEventListener("click", () => {
    const markdown = generateAuditReport(lastPayload, sessionBlockCount);
    downloadReport(markdown);
  });
}

// Request initial state on startup
port.postMessage({ type: "request-current-state" });

