/// <reference types="chrome" />

// src/ui/sidepanel/index.js

import browser from "webextension-polyfill";
import "./index.css";
import { maskValue } from "../../core/tokenizer/tokenizer.js";
import { tryLocalAction } from "../../core/local-agent.js";

const outputBox = document.getElementById("output-box");
const statusBadge = document.getElementById("status-badge");
const piiListContainer = document.getElementById("pii-list");
const piiCountBadge = document.getElementById("pii-count-badge");
const gateBadge = document.getElementById("gate-badge");
const runAgentBtn = document.getElementById("run-agent-btn");
const agentStatus = document.getElementById("agent-status");
const taskInput = document.getElementById("task-instruction");

let lastPayload = null;
let actionHistoryState = [];
let lastTaskInstruction = "";
let agentRunning = false;

const MAX_AGENT_STEPS = 20;
const STEP_SETTLE_MS = 800; // wait after each action for the page to settle

const DOM_STABLE_ACTIONS = new Set(["type", "wait"]);

/**
 * Runs a single agent cycle: fresh-scan → VLM decision → get action plan.
 * Returns the array of actions, or throws on failure.
 */
async function getPlanFromVLM(taskInstruction) {
  // 1. Force a fresh scan so DOM + coordinates are current
  const [activeTab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab) {
    await browser.tabs
      .sendMessage(activeTab.id, { type: "rescan" })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
  }

  // 2. Get the latest scan from background
  const bgRes = await browser.runtime
    .sendMessage({ type: "get-latest-scan" })
    .catch(() => null);
  const freshPayload =
    bgRes?.scanPayload?.sanitizedPayload || lastPayload?.sanitizedPayload;
  if (!freshPayload) throw new Error("No page data available");

  // 2.5 Intercept locally if possible
  const localDecision = tryLocalAction(taskInstruction, freshPayload.nodes || []);
  if (localDecision.canHandle) {
    console.log("[Local Agent] Handling locally:", localDecision.action);
    // Add "done" so it doesn't loop infinitely after doing local action
    return [localDecision.action, { action: "done", reasoning: localDecision.action.reasoning }];
  }

  // 3. Ask VLM for the next action plan
  const response = await browser.runtime.sendMessage({
    type: "run-agent",
    payload: {
      sanitizedPayload: freshPayload,
      tokenTypes: Array.isArray(freshPayload.tokenTypes)
        ? freshPayload.tokenTypes
        : Object.keys(freshPayload.tokenTypes || {}),
      taskInstruction,
      actionHistory: actionHistoryState,
    },
  });

  if (response.status !== "success") {
    throw new Error(response.error || "VLM request failed");
  }

  return response.plan.actions || [];
}

runAgentBtn.addEventListener("click", async () => {
  // If already running, act as a Stop button
  if (agentRunning) {
    agentRunning = false;
    runAgentBtn.textContent = "▶️ Run Agent";
    agentStatus.textContent = "⏹️ Stopped by user.";
    return;
  }

  if (!lastPayload) {
    agentStatus.textContent = "❌ No active page data. Focus a web page first.";
    return;
  }

  const taskInstruction = taskInput.value.trim() || "Fill out this form";

  // Reset history if the task changed
  if (taskInstruction !== lastTaskInstruction) {
    actionHistoryState = [];
    lastTaskInstruction = taskInstruction;
  }

  agentRunning = true;
  runAgentBtn.textContent = "⏹️ Stop Agent";

  try {
    let isTaskDone = false;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 3;

    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
      if (!agentRunning || isTaskDone) break; // user clicked Stop or task done

      agentStatus.textContent = `⏳ Step ${step}/${MAX_AGENT_STEPS} — thinking...`;

      const actions = await getPlanFromVLM(taskInstruction);
      if (actions.length === 0) {
          agentStatus.textContent = `⚠️ VLM returned empty plan. Stopping.`;
          break;
      }

      for (let i = 0; i < actions.length; i++) {
          if (!agentRunning) break;
          const action = actions[i];

          // Track action history (keep last 5 for loop detection)
          actionHistoryState.push(action);
          if (actionHistoryState.length > 5) {
            actionHistoryState.shift();
          }

          if (action.action === "done") {
            agentStatus.textContent = `✅ Done in ${step} step(s): ${action.reasoning || "Task completed."}`;
            isTaskDone = true;
            break;
          }

          agentStatus.textContent = `🎯 Step ${step}: Executing ${i+1}/${actions.length} (${action.action} → ${typeof action.target === "object" ? `(${action.target.x},${action.target.y})` : action.target || ""})`;

          // Execute the action on the active tab
          const [tab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
          });
          if (!tab) throw new Error("No active tab found");

          const execResult = await browser.tabs.sendMessage(tab.id, {
            type: "execute-action",
            payload: { action },
          });

          if (execResult?.status === "error") {
            consecutiveFailures++;
            console.warn(`[Agent Loop] Execution error (${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, execResult.error);
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              agentStatus.textContent = `❌ ${MAX_CONSECUTIVE_FAILURES} consecutive actions failed. Stopping. Last error: ${execResult.error}`;
              isTaskDone = true; // break outer loop too
              break;
            }
          } else {
            consecutiveFailures = 0; // reset on success
          }

          // Wait for the page to settle before the next action
          await new Promise((r) => setTimeout(r, STEP_SETTLE_MS));

          // If action mutates DOM, break inner loop to force rescan
          if (!DOM_STABLE_ACTIONS.has(action.action)) {
              break;
          }
      }

      if (step === MAX_AGENT_STEPS && !isTaskDone) {
        agentStatus.textContent = `⚠️ Reached ${MAX_AGENT_STEPS}-step limit. Click Run to continue.`;
      }
    }
  } catch (err) {
    agentStatus.textContent = `❌ Step failed: ${err.message}`;
  } finally {
    agentRunning = false;
    runAgentBtn.textContent = "▶️ Run Agent";
  }
});

function renderScanPayload(payload) {
  if (!payload) return;
  lastPayload = payload;
  const { piiList = [], metrics, fields, sanitizedPayload } = payload;

  // 1. Update Connection Status
  if (statusBadge) {
    statusBadge.textContent = "Active";
    statusBadge.className = "badge active";
  }

  // 2. Update PII Count Badge
  if (piiCountBadge) {
    piiCountBadge.textContent = `${piiList.length} PII Items`;
    piiCountBadge.className =
      piiList.length > 0 ? "count-badge danger" : "count-badge";
  }

  // 3. Render PII List
  if (piiListContainer) {
    if (!piiList || piiList.length === 0) {
      piiListContainer.innerHTML =
        '<p class="empty-state">No PII detected on active page.</p>';
    } else {
      piiListContainer.innerHTML = piiList
        .map(
          (item) => `
        <div class="pii-item">
          <div class="pii-item-header">
            <span class="pii-badge tag-${(item.entityType || "").toLowerCase()}">${item.entityType}</span>
            <span class="pii-source">${item.source} (${Math.round((item.confidence || 1) * 100)}%)</span>
          </div>
          <div class="pii-item-body">
            <span class="pii-label">${item.label || item.fieldId || "Unnamed field"}:</span>
            <span class="pii-value">${maskValue(item.value, item.entityType)}</span>
          </div>
        </div>
      `,
        )
        .join("");
    }
  }

  // 4. Update Raw JSON output
  if (outputBox && sanitizedPayload) {
    outputBox.textContent = JSON.stringify(
      sanitizedPayload.nodes || [],
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

function renderViolationPayload(payload) {
  if (!payload) return;
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

// Listen for messages from background
browser.runtime.onMessage.addListener((message) => {
  if (message.type === "update-panel") {
    renderScanPayload(message.payload);
  } else if (message.type === "privacy-violation") {
    renderViolationPayload(message.payload);
  }
});

// On side panel startup: get latest cached scan and request active tab to rescan
(async function initPanel() {
  try {
    // 1. Check if background already has cached scan result
    const bgRes = await browser.runtime
      .sendMessage({ type: "get-latest-scan" })
      .catch(() => null);
    if (bgRes?.scanPayload) {
      renderScanPayload(bgRes.scanPayload);
    } else if (bgRes?.violationPayload) {
      renderViolationPayload(bgRes.violationPayload);
    }

    // 2. Trigger active tab to perform a fresh scan
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      await browser.tabs.sendMessage(tab.id, { type: "rescan" }).catch(() => {
        // Tab might be chrome:// or un-injected page
      });
    }
  } catch (err) {
    console.warn("[ShieldBrowse Panel] Initial scan sync error:", err);
  }
})();
