/// <reference types="chrome" />

// src/content/index.js
// Content Script Orchestrator: Injected into live web pages

import { extractPageStructure } from "./dom-walker.js";
import { debounce } from "../utils/debounce.js";
import { scanPageForPII, initDetectors } from "../core/detector/index.js";
import { PIITokenizer } from "../core/tokenizer/tokenizer.js";
import { privacyGate } from "../core/tokenizer/privacy-gate.js";
import { DEFAULT_PRIVACY_POLICY } from "../core/tokenizer/privacy-policy.js";
import { executeAction } from "./action-executor.js";
import { scanImagesAndRedact } from "./image-scanner.js";
import browser from "webextension-polyfill";

console.log("[ShieldBrowse] Content script active on:", window.location.href);

initDetectors();

const tokenizer = new PIITokenizer();
let tokenizerReady = tokenizer.initialize();

// Core scan function
async function scanAndEmit() {
  const startTime = performance.now();

  const pageStructure = extractPageStructure(document.body);
  const taggedNodes = await scanPageForPII(pageStructure.nodes);

  await tokenizerReady;
  const tokenizeStart = performance.now();
  const { sanitizedNodes } = await tokenizer.tokenize(taggedNodes);
  const tokenizeMs = Math.round(performance.now() - tokenizeStart);

  // Call the vision pipeline for images concurrently
  scanImagesAndRedact();

  const sanitizedPayload = {
    url: pageStructure.url,
    title: pageStructure.title,
    nodes: sanitizedNodes,
    tokenTypes: Object.keys(tokenizer.counters),
  };

  const piiList = taggedNodes
    .filter((node) => node.pii && node.pii.isPII)
    .map((node) => ({
      fieldId: node.id,
      label: node.label,
      value: node.value,
      entityType: node.pii.entityType,
      confidence: node.pii.confidence,
      source: node.pii.source,
      selector: node.selector,
    }));

  const scanTimeMs = Math.round(performance.now() - startTime);
  console.log(
    `[ShieldBrowse] Detected ${piiList.length} PII items across ${taggedNodes.length} nodes in ${scanTimeMs}ms (Tokenizer: ${tokenizeMs}ms).`,
  );

  const gate = privacyGate(
    sanitizedPayload,
    tokenizer.tokenMap,
    DEFAULT_PRIVACY_POLICY.enforcement,
  );
  if (!gate.allowed) {
    browser.runtime
      .sendMessage({
        type: "privacy-violation",
        payload: {
          violations: gate.violations,
          url: pageStructure.url,
          timestamp: Date.now(),
        },
      })
      .catch(() => {});
    return; // Fail closed: block sending the ping.
  }

  browser.runtime
    .sendMessage({
      type: "ping",
      payload: {
        url: pageStructure.url,
        title: pageStructure.title,
        timestamp: Date.now(),
        metrics: {
          totalNodes: taggedNodes.length,
          piiCount: piiList.length,
          scanTimeMs: scanTimeMs,
          tokenizeMs: tokenizeMs,
        },
        piiList: piiList,
        tokenSummary: tokenizer.getSummary(),
        sanitizedPayload: sanitizedPayload,
      },
    })
    .catch(() => {});
}

// 1. Initial scan on document load
scanAndEmit();

// 2. Debounced live listeners for user input or profile changes
const debouncedScan = debounce(scanAndEmit, 100);

document.addEventListener("input", debouncedScan);
document.addEventListener("change", debouncedScan);
document.addEventListener("scroll", debouncedScan);

// 3. Listen for agent actions to execute
// -------------------------------------------------------------
// Message Listener: Execute commands from Background/Server
// -------------------------------------------------------------
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "rescan") {
    scanAndEmit()
      .then(() => sendResponse({ status: "rescanned" }))
      .catch((err) => sendResponse({ status: "error", error: err.message }));
    return true;
  }

  if (message.type === "execute-action") {
    const { action } = message.payload;

    // Fire off the execution async
    executeAction(action, tokenizer)
      .then((result) => {
        console.log("[ShieldBrowse] Action executed successfully", result);
        sendResponse({ status: "success", result });
        // Force a rescan after execution so the sidepanel updates and the next step can run
        setTimeout(scanAndEmit, 500);
      })
      .catch((err) => {
        console.error("[ShieldBrowse] Action execution failed:", err);
        sendResponse({ status: "error", error: err.message });
      });

    return true; // Keep channel open for async response
  }
});
