/// <reference types="chrome" />
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// src/background/service-worker.js
import browser from "webextension-polyfill";
import { setupOffscreenDocument } from "./offscreen-setup.js";
import {
  initVisionPipeline,
  detectFaces,
} from "./vision-pipeline.js";
import { ocrRegion } from "../core/vision/ocr.js";
import { AgentLoop } from "./agent-loop.js";

// Call immediately to avoid race conditions with content script
initVisionPipeline();

// 1. Lifecycle: Triggered on extension installation or update
browser.runtime.onInstalled.addListener(() => {
  console.log("[BrowseShield] Background Service Worker installed.");
});

// Also run on browser startup (Service Worker wakeup)
browser.runtime.onStartup.addListener(() => {
  initVisionPipeline();
});

// 2. Configure Side Panel to open on toolbar action click
if (browser.sidePanel) {
  browser.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) =>
      console.error("[BrowseShield] Failed to set side panel behavior:", err),
    );
}

// Instantiate the agent loop
const agentLoop = new AgentLoop();
globalThis.agentLoop = agentLoop; // Exposed for benchmarking
agentLoop.initialize();

// Port connection for sidepanel
browser.runtime.onConnect.addListener(port => {
  if (port.name === "agent-panel") {
    agentLoop.connectPort(port);
    
    port.onMessage.addListener(async (msg) => {
      if (msg.type === "request-current-state") {
        agentLoop.pushState();
        if (agentLoop.latestScan) {
           const sanitizedNodes = agentLoop.tokenizer.sanitizeNodes(agentLoop.latestScan.nodes);
           agentLoop.pushScanUpdate({
             ...agentLoop.latestScan,
             nodes: sanitizedNodes,
             tokenSummary: agentLoop.tokenizer.getSummary()
           });
        }
      } else if (msg.type === "start-agent") {
        // Find active tab
        const tabs = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        let activeTab = tabs[0];
        if (!activeTab || !activeTab.id) {
          const fallbackTabs = await browser.tabs.query({ active: true, currentWindow: true });
          activeTab = fallbackTabs[0];
        }

        if (!activeTab || !activeTab.id) {
          agentLoop.transition("error", "no-active-tab");
          return;
        }

        const url = activeTab.url || "";
        if (
          url.startsWith("chrome://") ||
          url.startsWith("edge://") ||
          url.startsWith("chrome-extension://") ||
          url.startsWith("about:") ||
          url.startsWith("devtools://") ||
          url.startsWith("view-source:")
        ) {
          agentLoop.transition("error", "restricted-page");
          return;
        }

        agentLoop.start(msg.task, activeTab.id, activeTab.windowId);
      } else if (msg.type === "stop-agent") {
        agentLoop.stop();
      }
    });
    
    port.onDisconnect.addListener(() => {
      agentLoop.sidepanelPort = null;
    });
  }
});

// 3. Central message dispatcher
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    "[BrowseShield SW] Received:",
    message.type,
    "from tab:",
    sender.tab?.id,
  );

  if (message.type === "dom-scan-result" || message.type === "action-complete") {
    agentLoop.handleScanPayload(message.payload, message.type === "action-complete");
    sendResponse({ status: "received", timestamp: Date.now() });
    
  } else if (message.type === "privacy-violation") {
    // Relay violation to active Side Panel UI if it's open (for manual scanning)
    browser.runtime
      .sendMessage({
        type: "privacy-violation",
        payload: message.payload,
      })
      .catch(() => {});
    sendResponse({ status: "received", timestamp: Date.now() });
    
  } else if (message.type === "INIT_NER") {
    (async () => {
      try {
        await setupOffscreenDocument('src/offscreen/index.html');
        const response = await browser.runtime.sendMessage({
          target: "offscreen",
          type: "INIT_NER"
        });
        sendResponse(response || { success: true });
      } catch (err) {
        console.error("[BrowseShield SW] INIT_NER failed:", err);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;

  } else if (message.type === "RUN_NER") {
    (async () => {
      try {
        await setupOffscreenDocument('src/offscreen/index.html');
        const results = await browser.runtime.sendMessage({
          target: "offscreen",
          type: "RUN_NER",
          input: message.input
        });
        sendResponse(results || []);
      } catch (err) {
        console.error("[BrowseShield SW] RUN_NER failed:", err);
        sendResponse([]);
      }
    })();
    return true;

  } else if (message.type === "DETECT_FACES") {
    (async () => {
      try {
        await setupOffscreenDocument('src/offscreen/index.html');
        await browser.runtime.sendMessage({ target: "offscreen", type: "INIT_VISION" });
        const response = await browser.runtime.sendMessage({
          target: "offscreen",
          type: "PERCEIVE_SCREEN",
          dataUrl: message.payload.dataUri,
          width: message.payload.width,
          height: message.payload.height
        });
        sendResponse({ status: "success", faces: response?.faceBoxes || [] });
      } catch (err) {
        console.error("[BrowseShield SW] Face detection failed:", err);
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true;

  } else if (message.type === "OCR_REGION") {
    (async () => {
      try {
        await setupOffscreenDocument('src/offscreen/index.html');
        const results = await browser.runtime.sendMessage({
          target: "offscreen",
          type: "RUN_OCR",
          dataUrl: message.payload.dataUri
        });
        sendResponse({ status: "success", results });
      } catch (err) {
        console.error("[BrowseShield SW] OCR failed:", err);
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true;
  }
});

