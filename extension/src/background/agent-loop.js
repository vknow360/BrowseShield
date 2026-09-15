import browser from "webextension-polyfill";
import { perceiveScreen, detectVisualPII } from "./vision-pipeline.js";
import { redactScreenshot } from "../core/vision/redactor.js";
import { detectSemanticPII, initNERPipeline } from "../core/detector/ner-pipeline.js";
import { privacyGate } from "../core/tokenizer/privacy-gate.js";
import { PIITokenizer } from "../core/tokenizer/tokenizer.js";
import { tryLocalAction } from "../core/local-agent.js";
import { validateAction } from "../core/action-safety-gate.js";
import { auditLogger } from "../core/audit/audit-logger.js";

export class AgentLoop {
  constructor() {
    this.state = "idle";
    this.step = 0;
    this.maxSteps = 10;
    this.taskInstruction = "";
    this.actionHistory = [];
    this.currentPlan = [];
    this.tokenizer = new PIITokenizer();
    this.sidepanelPort = null;

    // Internal state references
    this.latestScan = null;
    this.lastTabId = null;
    this.lastWindowId = null;
    this.errorReason = null;
    this.isPlanningInFlight = false;
    this.lastServerRequestTime = 0;

    // Loop-breaker: detect consecutive identical failed actions
    this.consecutiveFailures = 0;
    this.lastFailedActionKey = null;
    this.lastPlanUrl = null;
    this.executionId = 0;
  }

  async initialize() {
    // Rehydrate from session storage
    const s = await browser.storage.session.get(["agentState", "agentTokenMap", "agentCounters"]);
    if (s.agentState) {
      Object.assign(this, s.agentState);
    }
    if (s.agentTokenMap) {
      this.tokenizer.loadState(s.agentTokenMap, s.agentCounters || {});
    }

    // If the Service Worker restarted while the agent was running (e.g. Vite HMR or Chrome suspend),
    // the execution promises are dead. We must reset to prevent a zombie state.
    if (["planning", "executing", "waiting-for-settle"].includes(this.state)) {
      console.warn(`[AgentLoop] Recovered from zombie state '${this.state}'. Resetting.`);
      this.state = "error";
      this.errorReason = "Agent process was interrupted (e.g. extension reloaded). Please restart.";
      this.persist();
    }
  }

  async persist() {
    const { tokenMap, counters } = this.tokenizer.getState();
    await browser.storage.session.set({
      agentState: {
        state: this.state,
        step: this.step,
        maxSteps: this.maxSteps,
        taskInstruction: this.taskInstruction,
        actionHistory: this.actionHistory,
        currentPlan: this.currentPlan,
        lastTabId: this.lastTabId,
        lastWindowId: this.lastWindowId,
        errorReason: this.errorReason
      },
      agentTokenMap: tokenMap,
      agentCounters: counters
    });
  }

  connectPort(port) {
    this.sidepanelPort = port;
    this.pushState();
  }

  pushState(detail = null) {
    if (this.sidepanelPort) {
      this.sidepanelPort.postMessage({
        type: "state",
        state: this.state,
        step: this.step,
        maxSteps: this.maxSteps,
        errorReason: this.errorReason,
        canRetry: ["content-script-unreachable", "network-error", "timeout"].includes(this.errorReason),
        detail,
        timestamp: Date.now()
      });
    }
    this.persist();
  }

  pushScanUpdate(payload) {
    if (this.sidepanelPort) {
      this.sidepanelPort.postMessage({
        type: "update-panel",
        payload
      });
    }
  }

  async transition(newState, detail = null) {
    console.log(`[AgentLoop] State: ${this.state} -> ${newState}`);
    this.state = newState;
    if (newState === "error" && detail) {
      this.errorReason = detail;
    }
    this.pushState(detail);
  }

  async stop() {
    this.taskInstruction = "";
    this.actionHistory = [];
    this.currentPlan = [];
    this.step = 0;
    this.errorReason = null;
    this.isPlanningInFlight = false;
    this.executionId++; // Invalidate any in-flight async operations
    
    // Disconnect active WebSocket to prevent trailing responses
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    
    this.tokenizer.loadState({}, {}); // Reset tokens
    await this.transition("idle");
  }

  async start(taskInstruction, tabId, windowId) {
    await this.stop();
    this.taskInstruction = taskInstruction;
    this.lastTabId = tabId;
    this.lastWindowId = windowId;
    this.step = 1;

    await this.transition("planning");

    // Request a fresh scan to kick off the loop
    await this.requestFreshScan(tabId);
  }

  async requestFreshScan(tabId) {
    try {
      await this.sendToContentScript(tabId, { type: "rescan" });
    } catch (err) {
      await this.transition("error", "content-script-unreachable");
    }
  }

  // Handles dom-scan-result and action-complete
  async handleScanPayload(payload, isActionComplete) {
    this.latestScan = payload;

    // 1. Centralized Tokenization
    // Add candidates from DOM
    this.tokenizer.assignTokens(payload.candidates || []);

    // Send update to sidepanel (we sanitize the nodes first)
    const sanitizedNodes = this.tokenizer.sanitizeNodes(payload.nodes);
    this.pushScanUpdate({
      ...payload,
      nodes: sanitizedNodes,
      tokenSummary: this.tokenizer.getSummary()
    });

    if (this.state === "idle" || this.state === "error" || this.state === "done") {
      return; // Ignore scans if we aren't running
    }

    if (this.state === "waiting-for-settle") {
      if (isActionComplete) {
        // The action finished and the DOM settled natively.
        if (this.currentPlan.length > 0) {
          // Gentle pacing delay between consecutive DOM actions
          await new Promise(r => setTimeout(r, 1200));
          await this.executeNextActionInPlan();
        } else {
          // Plan exhausted, need to plan again
          this.step++;
          if (this.step > this.maxSteps) {
            await this.transition("done", "Max steps reached");
            return;
          }
          await this.transition("planning");
          this.planNextStep();
        }
      } else {
        // We received a fresh 'dom-scan-result' while waiting for an action to complete!
        // This implies the page navigated or reloaded, wiping out the content script before it could send 'action-complete'.
        console.log("[AgentLoop] Page navigated or hard reloaded. Discarding remaining plan.");
        this.currentPlan = [];

        // Auto-done logic removed: URL changes should just cause a replan for multi-page flows
        const newUrl = payload.url || "";
        if (this.lastPlanUrl && newUrl && newUrl !== this.lastPlanUrl) {
          console.log(`[AgentLoop] URL changed: ${this.lastPlanUrl} → ${newUrl}. Replanning.`);
        }

        this.step++;
        await this.transition("planning");
        this.planNextStep();
      }
    } else if (this.state === "planning" && !isActionComplete) {
      // We got the fresh scan we requested to start planning
      this.planNextStep();
    }
  }

  async planNextStep() {
    if (this.isPlanningInFlight) {
      console.warn("[AgentLoop] planNextStep() already in flight, skipping duplicate call.");
      return;
    }
    this.isPlanningInFlight = true;
    const currentExecutionId = this.executionId;
    try {
      await this.transition("planning");
      console.log(`[AgentLoop:Timing] planNextStep START ${Date.now()}`);

      const payload = this.latestScan;
      this.lastPlanUrl = payload.url || "";
      const sanitizedNodes = this.tokenizer.sanitizeNodes(payload.nodes);
      console.log(`[AgentLoop:Timing] dom_sanitization DONE ${Date.now()}`);

      // Check if this task can be handled locally (e.g. scroll, dismiss popup) without a VLM call
      const localResult = tryLocalAction(this.taskInstruction, sanitizedNodes);
      if (localResult.canHandle && localResult.action) {
        console.log("[AgentLoop] Local agent intercepted task:", localResult.action);
        this.currentPlan = [localResult.action];
        // Execute it immediately and skip the heavy vision pipeline
        await this.executeNextActionInPlan();
        return;
      }

      // Prompt Tokenization
      await initNERPipeline();
      const promptRegexes = [
        { type: "AADHAAR", regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
        { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
        { type: "PHONE", regex: /\b(?:\+91|0)?[6-9]\d{9}\b/g },
        { type: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g },
        { type: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,16}\b/g },
        { type: "PINCODE", regex: /\b[1-9]\d{5}\b/g },
        { type: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g }
      ];

      const detectedEntities = [];
      for (const { type, regex } of promptRegexes) {
        const matches = [...this.taskInstruction.matchAll(regex)];
        for (const match of matches) {
          detectedEntities.push({ type, value: match[0].trim() });
        }
      }

      // Contextual Key-Value extraction for credentials
      const credentialRegex = /(?:password|pass|pwd|secret|key|token)\s*(?:is|:|=>|=|-|>)\s*([^\s,;."']+)/gi;
      const usernameRegex = /(?:username|user|login|id|email)\s*(?:is|:|=>|=|-|>)\s*([^\s,;."']+)/gi;

      for (const match of this.taskInstruction.matchAll(credentialRegex)) {
        if (match[1]) detectedEntities.push({ type: "PASSWORD", value: match[1].trim() });
      }
      for (const match of this.taskInstruction.matchAll(usernameRegex)) {
        if (match[1]) detectedEntities.push({ type: "PERSON", value: match[1].trim() });
      }
      const semanticEntities = await detectSemanticPII(this.taskInstruction);
      for (const ent of semanticEntities) {
        detectedEntities.push({ type: ent.entityType, value: ent.value });
      }

      this.tokenizer.assignTokens(detectedEntities.map(e => ({ entityType: e.type, realValue: e.value })));
      const sanitizedInstruction = this.tokenizer.sanitizeString(this.taskInstruction);
      console.log(`[AgentLoop:Timing] prompt_tokenization DONE ${Date.now()}`);

      let redactedImage = null;
      let originalImage = null;
      let screenType = "unknown";
      let uiBoxes = [];
      let f = 1;

      // Vision Loop
      try {
        const dataUrl = await browser.tabs.captureVisibleTab(this.lastWindowId, { format: "jpeg", quality: 75 });
        originalImage = dataUrl;
        const blob = await (await fetch(dataUrl)).blob();
        const fullBitmap = await createImageBitmap(blob);

        const MAX_EDGE = 1280;
        const longest = Math.max(fullBitmap.width, fullBitmap.height);
        f = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
        let imageBitmap = fullBitmap;
        if (f < 1) {
          imageBitmap = await createImageBitmap(fullBitmap, {
            resizeWidth: Math.round(fullBitmap.width * f),
            resizeHeight: Math.round(fullBitmap.height * f),
            resizeQuality: "high",
          });
          fullBitmap.close();
        }
        console.log(`[AgentLoop:Timing] screen_capture DONE ${Date.now()}`);

        const perception = await perceiveScreen(imageBitmap, sanitizedNodes);
        console.log(`[AgentLoop:Timing] yolo_inference DONE ${Date.now()}`);
        screenType = perception.screenType;
        uiBoxes = perception.uiBoxes || [];

        // Scale content script rects (full device coordinates -> downscaled imageBitmap)
        const piiFieldBoxes = (payload.sensitiveRects || []).map(r => ({
          x: r.x * f, y: r.y * f, w: r.w * f, h: r.h * f
        }));

        // Add DOM elements that were identified as containing PII
        for (const node of payload.nodes) {
          if ((node.hasPII || node.pii) && node.box && node.box.length === 4) {
            piiFieldBoxes.push({
              x: node.box[0] * f, y: node.box[1] * f, w: node.box[2] * f, h: node.box[3] * f
            });
          }
        }

        // Perception boxes are already in imageBitmap coordinate space
        (perception.piiVisionBoxes || []).forEach(box => {
          piiFieldBoxes.push({ x: box.x, y: box.y, w: box.w, h: box.h });
        });

        // Fast Visual Pass for static PII missed by DOM
        const tokenMap = this.tokenizer.getState().tokenMap;
        const visualPiiBoxes = await detectVisualPII(imageBitmap, tokenMap);
        visualPiiBoxes.forEach(box => {
          piiFieldBoxes.push({ x: box.x, y: box.y, w: box.w, h: box.h });
        });

        redactedImage = await redactScreenshot(imageBitmap, {
          faceBoxes: perception.faceBoxes,
          piiFieldBoxes,
          passwordBoxes: [] // Handled by sensitiveRects
        });
        imageBitmap.close();
        console.log(`[AgentLoop:Timing] redaction DONE ${Date.now()}`);
      } catch (visionErr) {
        console.error("[AgentLoop] Vision loop failed, degrading gracefully to DOM-only mode:", visionErr);
        // Do not crash the loop. Continue without visual context.
      }

      const reqBody = {
        sanitizedDom: sanitizedNodes,
        pageUrl: payload.url,
        pageTitle: payload.title,
        screenType,
        taskInstruction: sanitizedInstruction,
        tokenTypes: Object.keys(this.tokenizer.counters),
        actionHistory: this.actionHistory,
        uiBoxes,
      };

      if (redactedImage) {
        reqBody.redactedImage = redactedImage;
        reqBody.originalImage = originalImage;
      }

      // 🔒 PRIVACY GATE
      const gate = privacyGate(reqBody, this.tokenizer.getState().tokenMap, "block");
      if (!gate.allowed) {
        await this.transition("error", "privacy-gate-blocked");
        return;
      }
      console.log(`[AgentLoop:Timing] privacy_gate DONE ${Date.now()}`);

      if (this.sidepanelPort) {
        this.sidepanelPort.postMessage({
          type: "vlm-request-preview",
          payload: reqBody
        });
      }

      if (this.executionId !== currentExecutionId) return;

      // Rate limit throttle: ensure at least 4s between VLM requests
      const elapsed = Date.now() - this.lastServerRequestTime;
      const minIntervalMs = 4000;
      if (elapsed < minIntervalMs && this.lastServerRequestTime > 0) {
        const waitMs = minIntervalMs - elapsed;
        console.log(`[AgentLoop] Pacing delay: waiting ${waitMs}ms before VLM request to prevent 429...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
      this.lastServerRequestTime = Date.now();

      auditLogger.log("SERVER_REQUEST_SENT", {
        tokenCount: Object.keys(this.tokenizer.getState().tokenMap).length,
        nodesCount: reqBody.sanitizedDom.length,
        hasImage: !!reqBody.redactedImage
      });

      const storage = await browser.storage.local.get(["serverEndpoint"]);
      const serverEndpoint = storage.serverEndpoint || "http://localhost:8000";
      const httpUrl = serverEndpoint.replace(/\/$/, "") + "/agent/plan";
      const wsUrl = serverEndpoint.replace(/^http/, "ws").replace(/\/$/, "") + "/agent/ws/plan";

      let planJSON = null;

      // 1. Try WebSocket transport for persistent, low-latency streaming
      try {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.ws = new WebSocket(wsUrl);
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("WebSocket connection timeout")), 3000);
            this.ws.onopen = () => { clearTimeout(timer); resolve(); };
            this.ws.onerror = (err) => { clearTimeout(timer); reject(err); };
          });
        }

        planJSON = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("WebSocket response timeout")), 20000);
          this.ws.onmessage = (event) => {
            clearTimeout(timer);
            try {
              resolve(JSON.parse(event.data));
            } catch (err) {
              reject(err);
            }
          };
          this.ws.onerror = (err) => { clearTimeout(timer); reject(err); };
          this.ws.send(JSON.stringify(reqBody));
        });
      } catch (wsErr) {
        console.warn("[AgentLoop] WebSocket transport failed, falling back to HTTP POST:", wsErr);
        if (this.ws) {
          try { this.ws.close(); } catch (_) {}
          this.ws = null;
        }

        // 2. Graceful Fallback: Standard HTTP POST /agent/plan
        const response = await fetch(httpUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(reqBody)
        });

        if (!response.ok) {
          throw new Error(`HTTP planning fallback failed: ${response.status} ${response.statusText}`);
        }
        planJSON = await response.json();
      }
      console.log(`[AgentLoop:Timing] server_response DONE ${Date.now()}`);

      if (planJSON.error) {
        throw new Error(planJSON.error);
      }

      this.currentPlan = planJSON.actions || [];
      if (this.currentPlan.length === 0) {
        await this.transition("done", "VLM returned empty plan");
        return;
      }

      // Inject scale factor for click coordinates
      this.currentPlan.forEach(a => a.f = f);

      if (this.executionId !== currentExecutionId) return;

      await this.executeNextActionInPlan();
      console.log(`[AgentLoop:Timing] action_execution DONE ${Date.now()}`);

    } catch (err) {
      if (this.executionId === currentExecutionId) {
        console.error("[AgentLoop] Planning failed:", err);
        await this.transition("error", "network-error");
      }
    } finally {
      if (this.executionId === currentExecutionId) {
        this.isPlanningInFlight = false;
      }
    }
  }

  async executeNextActionInPlan() {
    if (this.currentPlan.length === 0) return;

    const action = this.currentPlan.shift();

    // Validate the action before executing it to prevent malicious payload execution
    const validation = validateAction(action, null);
    if (!validation.valid) {
      console.warn(`[AgentLoop] Action Safety Gate blocked action:`, action, `Reason: ${validation.reason}`);
      this.currentPlan = []; // Discard the rest of the unsafe plan
      await this.transition("error", `Safety check failed: ${validation.reason}`);
      return;
    }

    if (action.action === "done") {
      await this.transition("done", action.reasoning || "Task completed");
      return;
    }

    this.actionHistory.push(action);
    await this.transition("executing", action);

    // Rehydrate any tokenized values back to raw PII before sending to the active tab
    if (action.value) {
      action.value = this.tokenizer.rehydrateString(action.value);
    }

    // Scale click targets based on vision downsampling
    if (action.action === "click" && action.target && typeof action.target === "object") {
      const f = action.f || 1;
      action.target.x = action.target.x / f;
      action.target.y = action.target.y / f;
    }

    try {
      const response = await this.sendToContentScript(this.lastTabId, {
        type: "execute-action",
        payload: { action, actionId: Date.now() }
      });

      if (response && response.status === "error") {
        // Loop-breaker: track consecutive identical failures
        const actionKey = `${action.action}|${JSON.stringify(action.target)}|${action.value || ''}`;
        if (actionKey === this.lastFailedActionKey) {
          this.consecutiveFailures++;
        } else {
          this.consecutiveFailures = 1;
          this.lastFailedActionKey = actionKey;
        }

        if (this.consecutiveFailures >= 2) {
          console.warn(`[AgentLoop] Same action failed ${this.consecutiveFailures}x in a row. Stopping.`);
          this.consecutiveFailures = 0;
          this.lastFailedActionKey = null;
          await this.transition("done", "Repeated action failures — task may already be complete");
          return;
        }

        console.warn(`[AgentLoop] Action failed on page: ${response.error}. Discarding remaining plan.`);
        this.currentPlan = []; // Force replan on next settle
      } else {
        // Reset failure tracking on success
        this.consecutiveFailures = 0;
        this.lastFailedActionKey = null;
      }

      // We successfully sent it. Now we wait for the content script to push 'action-complete'
      await this.transition("waiting-for-settle");

      // Set a safety timeout in case the content script never pushes back
      setTimeout(() => {
        if (this.state === "waiting-for-settle") {
          this.transition("error", "timeout");
        }
      }, 10000);

    } catch (err) {
      await this.transition("error", "content-script-unreachable");
    }
  }

  async sendToContentScript(tabId, msg) {
    try {
      return await browser.tabs.sendMessage(tabId, msg);
    } catch (err) {
      console.warn("[AgentLoop] Content script unreachable, attempting reinjection...", err);
      try {
        const manifest = browser.runtime.getManifest();
        const contentScripts = manifest.content_scripts?.[0]?.js || [];
        if (browser.scripting && contentScripts.length > 0) {
          await browser.scripting.executeScript({
            target: { tabId },
            files: contentScripts
          });
          await new Promise(r => setTimeout(r, 300));
          return await browser.tabs.sendMessage(tabId, msg);
        }
      } catch (reinjectErr) {
        console.warn("[AgentLoop] Script reinjection failed:", reinjectErr);
      }
      throw err;
    }
  }
}
