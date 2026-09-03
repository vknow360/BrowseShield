/// <reference types="chrome" />

// src/background/index.js
import "./polyfill.js";
import browser from "webextension-polyfill";
import {
  initVisionPipeline,
  detectFaces,
  perceiveScreen,
} from "./vision-pipeline.js";
import { redactScreenshot } from "../core/vision/redactor.js";

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

let latestScanPayload = null;
let latestViolationPayload = null;

// 3. Central message dispatcher
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log(
    "[ShieldBrowse SW] Received:",
    message.type,
    "from tab:",
    sender.tab?.id,
  );

  if (message.type === "get-latest-scan") {
    sendResponse({
      status: "success",
      scanPayload: latestScanPayload,
      violationPayload: latestViolationPayload,
    });
    return true;
  }

  if (message.type === "ping") {
    latestScanPayload = message.payload;
    latestViolationPayload = null;
    // Relay page scan payload to active Side Panel UI
    browser.runtime
      .sendMessage({
        type: "update-panel",
        payload: message.payload,
      })
      .catch(() => {
        // Normal if side panel is currently closed
      });

    sendResponse({ status: "received", timestamp: Date.now() });
  } else if (message.type === "privacy-violation") {
    latestViolationPayload = message.payload;
    // Relay violation to active Side Panel UI
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
        const { width, height, data } = message.payload;
        // The data is a Uint8ClampedArray passed as an array or base64.
        // For MediaPipe, we need an ImageData object.
        // Wait, in a Service Worker, we can't create an ImageData object directly.
        // We can pass an ImageBitmap instead, which IS supported in SW!

        // Convert the data URL back to a Blob, then to an ImageBitmap
        const response = await fetch(message.payload.dataUri);
        const blob = await response.blob();
        const imageBitmap = await createImageBitmap(blob);

        const faces = detectFaces(imageBitmap);

        // Clean up the bitmap
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
        const { ocrRegion } = await import("../core/vision/ocr.js");
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
  } else if (message.type === "run-agent") {
    const { sanitizedPayload, taskInstruction, actionHistory, tokenTypes } =
      message.payload;
    let tabId = sender.tab ? sender.tab.id : null;
    let windowId = sender.tab ? sender.tab.windowId : null;

    (async () => {
      try {
        if (tabId === null || windowId === null) {
          // Request came from sidepanel/popup, so find the active tab
          const [activeTab] = await browser.tabs.query({
            active: true,
            lastFocusedWindow: true,
          });
          if (activeTab) {
            tabId = activeTab.id;
            windowId = activeTab.windowId;
          }
        }

        let redactedImage = null;
        let screenType = "unknown";
        let uiBoxes = [];
        let f = 1;
        const timing = {};

        // Visual Loop: Capture -> Downscale -> Perceive -> Redact.
        // Runs only on this explicit user-triggered agent cycle (not per DOM mutation).
        if (tabId !== null && windowId !== null) {
          try {
            // Capture at a moderate quality (avoids a wasteful full-quality double encode).
            const tCap = performance.now();
            const dataUrl = await browser.tabs.captureVisibleTab(windowId, {
              format: "jpeg",
              quality: 80,
            });
            const blob = await (await fetch(dataUrl)).blob();
            const fullBitmap = await createImageBitmap(blob);

            // Downscale once (longest edge <= 384) to massively shrink inference, redaction, and upload.
            const MAX_EDGE = 384;
            const longest = Math.max(fullBitmap.width, fullBitmap.height);
            f = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
            let imageBitmap = fullBitmap;
            if (f < 1) {
              imageBitmap = await createImageBitmap(fullBitmap, {
                resizeWidth: Math.round(fullBitmap.width * f),
                resizeHeight: Math.round(fullBitmap.height * f),
                resizeQuality: "medium",
              });
              fullBitmap.close();
            }
            timing.captureMs = Math.round(performance.now() - tCap);

            const tPer = performance.now();
            const perception = await perceiveScreen(
              imageBitmap,
              sanitizedPayload.nodes,
            );
            screenType = perception.screenType;
            uiBoxes = perception.uiBoxes || [];
            const piiVisionBoxes = perception.piiVisionBoxes || [];
            timing.perceiveMs = Math.round(performance.now() - tPer);

            // DOM boxes are in full-capture device pixels; scale them to the downscaled bitmap.
            const piiFieldBoxes = [];
            const passwordBoxes = [];
            sanitizedPayload.nodes.forEach((node) => {
              if (
                node.box &&
                Array.isArray(node.box) &&
                node.box.length === 4
              ) {
                const boxObj = {
                  x: node.box[0] * f,
                  y: node.box[1] * f,
                  w: node.box[2] * f,
                  h: node.box[3] * f,
                };
                if (node.type === "password") {
                  passwordBoxes.push(boxObj);
                } else if (
                  typeof node.value === "string" &&
                  node.value.includes("[[")
                ) {
                  piiFieldBoxes.push(boxObj);
                } else if (
                  typeof node.label === "string" &&
                  node.label.includes("[[")
                ) {
                  piiFieldBoxes.push(boxObj);
                } else if (
                  node.pii &&
                  node.pii.type &&
                  node.pii.type !== "LABEL_0"
                ) {
                  piiFieldBoxes.push(boxObj);
                }
              }
            });

            // Merge vision-detected PII boxes
            piiVisionBoxes.forEach(box => {
              piiFieldBoxes.push({
                x: box.x * f,
                y: box.y * f,
                w: box.w * f,
                h: box.h * f,
              });
            });

            const tRed = performance.now();
            timing.redactPrepMs = Math.round(
              performance.now() - tPer - timing.perceiveMs,
            );
            redactedImage = await redactScreenshot(imageBitmap, {
              faceBoxes: perception.faceBoxes,
              piiFieldBoxes,
              passwordBoxes,
            });
            timing.redactMs = Math.round(performance.now() - tRed);

            imageBitmap.close();
            console.log(
              `[ShieldBrowse SW] Visual loop complete. ScreenType: ${screenType} | ` +
                `capture ${timing.captureMs}ms, perceive ${timing.perceiveMs}ms, redact ${timing.redactMs}ms`,
            );
          } catch (visionErr) {
            console.error(
              "[ShieldBrowse SW] Vision loop failed, continuing text-only:",
              visionErr,
            );
          }
        }

        const s = await browser.storage.local.get([
          "tokenMap",
          "tokenCounters",
        ]);
        const tokenMap = s.tokenMap || {};
        const counters = s.tokenCounters || {};

        let sanitizedInstruction = taskInstruction;

        // 🔒 1. Prompt Tokenization: If the user typed RAW PII in the prompt, tokenize it first!
        const { detectSemanticPII, initNERPipeline } = await import("../core/detector/ner-pipeline.js");
        await initNERPipeline();

        // 1a. Structured Regex Extraction
        const promptRegexes = [
          { type: "AADHAAR", regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
          { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
          { type: "PHONE", regex: /\b(?:\+91|0)?[6-9]\d{9}\b/g },
          { type: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g },
          { type: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,16}\b/g },
          { type: "PINCODE", regex: /\b[1-9]\d{5}\b/g },
          { type: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g }
        ];

        let tokensAdded = false;
        let detectedEntities = [];

        for (const { type, regex } of promptRegexes) {
          const matches = [...sanitizedInstruction.matchAll(regex)];
          for (const match of matches) {
            detectedEntities.push({ type, value: match[0].trim() });
          }
        }

        // 1b. Semantic NER Extraction (Names, Addresses, Orgs)
        const semanticEntities = await detectSemanticPII(sanitizedInstruction);
        for (const ent of semanticEntities) {
          detectedEntities.push({ type: ent.entityType, value: ent.value });
        }

        // 1c. Tokenize and Replace
        // Sort by length descending so we replace longer substrings first (e.g. full name before first name)
        detectedEntities.sort((a, b) => b.value.length - a.value.length);

        for (const { type, value } of detectedEntities) {
          if (!value || value.length < 2) continue;
          
          let tokenToUse = null;
          // check if already tokenized
          for (const [t, data] of Object.entries(tokenMap)) {
            if (data.realValue === value) {
              tokenToUse = t;
              break;
            }
          }
          
          // generate new token if not found
          if (!tokenToUse) {
            counters[type] = (counters[type] || 0) + 1;
            tokenToUse = `[[${type}_${counters[type]}]]`;
            tokenMap[tokenToUse] = {
              realValue: value,
              entityType: type,
              confidence: 1.0,
              source: "prompt-analyzer",
            };
            tokensAdded = true;
          }

          // Replace in instruction
          const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          sanitizedInstruction = sanitizedInstruction.replace(
            new RegExp(escaped, "g"),
            tokenToUse
          );
        }

        if (tokensAdded) {
          await browser.storage.local.set({
            tokenMap,
            tokenCounters: counters,
          });
        }

        // 🔒 2. Sanitize existing known tokens that might be in the prompt
        for (const [token, data] of Object.entries(tokenMap)) {
          const val = data.realValue;
          if (!val || val.length < 2) continue;
          const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          sanitizedInstruction = sanitizedInstruction.replace(
            new RegExp(escaped, "gi"),
            token,
          );
        }

        // Build the request body
        const reqBody = {
          sanitizedDom: sanitizedPayload.nodes,
          pageUrl: sanitizedPayload.url,
          pageTitle: sanitizedPayload.title,
          screenType,
          taskInstruction: sanitizedInstruction,
          tokenTypes,
          actionHistory: actionHistory || [],
          uiBoxes,
        };

        if (redactedImage) {
          reqBody.redactedImage = redactedImage;
        }

        // 🔒 MANDATORY PRIVACY BOUNDARY CHECK BEFORE FETCH 🔒
        // Re-verified here as the absolute egress point, even though the content script also checks.

        // Import the gate defensively — but a genuine BLOCK must propagate (never be swallowed as
        // an "import failed" warning), otherwise the privacy boundary is bypassed.
        let privacyGate = null;
        try {
          ({ privacyGate } = await import("../core/tokenizer/privacy-gate.js"));
        } catch (importErr) {
          console.warn(
            "[ShieldBrowse SW] Could not import privacyGate; relying on content-script gate.",
            importErr,
          );
        }
        if (privacyGate) {
          const gate = privacyGate(reqBody, tokenMap, "block");
          if (!gate.allowed) {
            throw new Error(
              `Privacy Gate blocked network egress: raw PII detected (${gate.violations.map((v) => v.token).join(", ")})`,
            );
          }
        }

        console.log("[ShieldBrowse SW] Sending sanitized request to server...");
        const tNet = performance.now();
        const response = await fetch("http://localhost:8000/agent/plan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody),
        });

        if (!response.ok) throw new Error(`Server returned ${response.status}`);
        const planJSON = await response.json();

        // Attach the image downscale factor 'f' so the executor can translate vision coordinates back
        if (planJSON.actions) {
          planJSON.actions.forEach(a => a.f = typeof f !== "undefined" ? f : 1);
        }

        timing.networkMs = Math.round(performance.now() - tNet);
        timing.totalMs =
          (timing.captureMs || 0) +
          (timing.perceiveMs || 0) +
          (timing.redactMs || 0) +
          timing.networkMs;

        console.log(
          `[ShieldBrowse SW] Server plan received in ${timing.networkMs}ms ` +
            `(end-to-end ~${timing.totalMs}ms):`,
          planJSON,
        );
        sendResponse({ status: "success", plan: planJSON, timing });
      } catch (err) {
        console.error("[ShieldBrowse SW] run-agent failed:", err);
        sendResponse({ status: "error", error: err.message });
      }
    })();
    return true; // async response
  }

  // Keep message channel open for async responses
  return true;
});
