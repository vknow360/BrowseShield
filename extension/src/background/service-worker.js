/// <reference types="chrome" />
if (typeof window === 'undefined') {
  globalThis.window = globalThis;
}

// src/background/service-worker.js
import browser from "webextension-polyfill";
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
  console.log("[ShieldBrowse] Background Service Worker installed.");
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
      console.error("[ShieldBrowse] Failed to set side panel behavior:", err),
    );
}

// Instantiate the agent loop
const agentLoop = new AgentLoop();
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
        const [activeTab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTab) {
          agentLoop.start(msg.task, activeTab.id, activeTab.windowId);
        }
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
    "[ShieldBrowse SW] Received:",
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
    
  } else if (message.type === "DETECT_FACES") {
    (async () => {
      try {
        const response = await fetch(message.payload.dataUri);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);
        const faces = detectFaces(imageBitmap);
        imageBitmap.close();
        sendResponse({ status: "success", faces });
      } catch (err) {
        console.error("[ShieldBrowse SW] Face detection failed:", err);
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true; // async response
    
  } else if (message.type === "OCR_REGION") {
    (async () => {
      try {
        const response = await fetch(message.payload.dataUri);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);
        const results = await ocrRegion(imageBitmap);
        imageBitmap.close();
        sendResponse({ status: "success", results });
      } catch (err) {
        console.error("[ShieldBrowse SW] OCR failed:", err);
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true; // async response
  }

  // We do NOT return true for every message generically anymore, 
  // only when we explicitly handle it with async.
  // This prevents the "message channel closed" warnings for unhandled messages.
});
