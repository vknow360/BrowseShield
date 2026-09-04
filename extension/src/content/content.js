/// <reference types="chrome" />

// src/content/content.js
// Content Script Orchestrator: Injected into live web pages

import { extractPageStructure } from "./dom-walker.js";
import { debounce } from "../utils/debounce.js";
import { scanPageForPII, initDetectors } from "../core/detector/index.js";
import { PIITokenizer } from "../core/tokenizer/tokenizer.js";
import { executeAction } from "./action-executor.js";
import { scanImagesAndRedact, scanCanvasesForOCR } from "./image-scanner.js";
import browser from "webextension-polyfill";

console.log("[ShieldBrowse] Content script active on:", window.location.href);

initDetectors();

// DOM Settle Detection — waits for DOM to stop mutating
function waitForSettle(timeoutMs = 3000, silenceMs = 600) {
  return new Promise(resolve => {
    let timer, ceiling;
    const obs = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => { obs.disconnect(); clearTimeout(ceiling); resolve(); }, silenceMs);
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    timer = setTimeout(() => { obs.disconnect(); clearTimeout(ceiling); resolve(); }, silenceMs);
    ceiling = setTimeout(() => { obs.disconnect(); clearTimeout(timer); resolve(); }, timeoutMs);
  });
}

// Collect sensitive rects for background redaction
function collectSensitiveRects() {
  const rects = [];
  const dpr = window.devicePixelRatio || 1;
  document.querySelectorAll('input[type=password], [data-sensitive]').forEach(el => {
    const r = el.getBoundingClientRect();
    rects.push({ x: r.x * dpr, y: r.y * dpr, w: r.width * dpr, h: r.height * dpr, type: 'password' });
  });
  return { rects, dpr };
}

// Core scan function
async function scanAndEmit(isActionComplete = false, actionId = null) {
  const startTime = performance.now();

  const pageStructure = extractPageStructure(document.body);
  const taggedNodes = await scanPageForPII(pageStructure.nodes);
  
  // Extract candidates (stateless)
  const candidates = PIITokenizer.extractNodeCandidates(taggedNodes, 0.7);
  
  // Call the vision pipeline for images and canvases concurrently
  scanImagesAndRedact();
  scanCanvasesForOCR();
  
  const { rects, dpr } = collectSensitiveRects();

  const scanTimeMs = Math.round(performance.now() - startTime);
  console.log(`[ShieldBrowse] Detected ${candidates.length} PII candidates across ${taggedNodes.length} nodes in ${scanTimeMs}ms.`);

  const messageType = isActionComplete ? "action-complete" : "dom-scan-result";

  browser.runtime.sendMessage({
    type: messageType,
    payload: {
      url: pageStructure.url,
      title: pageStructure.title,
      nodes: taggedNodes, // raw nodes with .pii
      candidates,
      sensitiveRects: rects,
      dpr,
      actionId,
      timestamp: Date.now(),
      metrics: {
        totalNodes: taggedNodes.length,
        candidatesCount: candidates.length,
        scanTimeMs
      }
    }
  }).catch(() => {});
}

// 1. Initial scan on document load
scanAndEmit();

// 2. Debounced live listeners for user input — increased to 300ms for less churn
let isAgentExecuting = false;
const debouncedScan = debounce(() => {
  if (isAgentExecuting) return;
  scanAndEmit(false);
}, 300);

document.addEventListener("input", debouncedScan);
document.addEventListener("change", debouncedScan);

// 3. MutationObserver for dynamically added elements (OTP fields, AJAX forms, etc.)
const mutationDebounce = debounce(() => {
  if (isAgentExecuting) return;
  scanAndEmit(false);
}, 500);

const domObserver = new MutationObserver((mutations) => {
  // Only trigger rescan if meaningful elements were added
  const hasNewInteractives = mutations.some(m => {
    if (m.type === "childList") {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches?.("input, select, textarea, button, form, [role='button']")) return true;
          if (node.querySelector?.("input, select, textarea, button, form")) return true;
        }
      }
    }
    return false;
  });

  if (hasNewInteractives) {
    console.log("[ShieldBrowse] New interactive elements detected in DOM. Rescanning...");
    mutationDebounce();
  }
});

domObserver.observe(document.body, { childList: true, subtree: true });

// 4. Listen for agent actions to execute
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "rescan") {
    scanAndEmit(false)
      .then(() => sendResponse({ status: "rescanned" }))
      .catch((err) => sendResponse({ status: "error", error: err.message }));
    return true;
  }

  if (message.type === "execute-action") {
    const { action, actionId } = message.payload;
    
    isAgentExecuting = true;
    executeAction(action)
      .then(async (result) => {
        console.log("[ShieldBrowse] Action executed successfully", result);
        sendResponse({ status: "success", result });
        
        await waitForSettle();
        isAgentExecuting = false;
        scanAndEmit(true, actionId);
      })
      .catch(async (err) => {
        console.error("[ShieldBrowse] Action execution failed:", err);

        // Return richer error info for better VLM replanning
        const errorInfo = {
          message: err.message,
          target: action.target,
          action: action.action,
        };

        // Try to find what's actually at the target location
        if (typeof action.target === "string") {
          try {
            const el = document.querySelector(action.target);
            if (el) {
              errorInfo.elementState = {
                tagName: el.tagName,
                type: el.type,
                disabled: el.disabled,
                readonly: el.readOnly,
                visible: el.getBoundingClientRect().width > 0,
                value: el.value?.substring(0, 50),
              };
            }
          } catch (e) { /* ignore */ }
        }

        sendResponse({ status: "error", error: err.message, errorInfo });
        
        await waitForSettle();
        isAgentExecuting = false;
        scanAndEmit(true, actionId);
      });

    return true; // Keep channel open for async response
  }
});
