import browser from "webextension-polyfill";
import { perceiveScreen } from "./vision-pipeline.js";
import { redactScreenshot } from "../core/vision/redactor.js";
import { detectSemanticPII, initNERPipeline } from "../core/detector/ner-pipeline.js";
import { privacyGate } from "../core/tokenizer/privacy-gate.js";
import { PIITokenizer } from "../core/tokenizer/tokenizer.js";

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

        // Auto-done: if the URL changed, the original task likely succeeded (e.g. login → dashboard)
        const newUrl = payload.url || "";
        if (this.lastPlanUrl && newUrl && newUrl !== this.lastPlanUrl) {
          console.log(`[AgentLoop] URL changed: ${this.lastPlanUrl} → ${newUrl}. Marking task done.`);
          await this.transition("done", "Page navigated — task appears complete");
          return;
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
    try {
      await this.transition("planning");

      const payload = this.latestScan;
      this.lastPlanUrl = payload.url || "";
      const sanitizedNodes = this.tokenizer.sanitizeNodes(payload.nodes);

      let redactedImage = null;
      let screenType = "unknown";
      let uiBoxes = [];
      let f = 1;

      // Vision Loop
      try {
        const dataUrl = await browser.tabs.captureVisibleTab(this.lastWindowId, { format: "jpeg", quality: 90 });
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

        const perception = await perceiveScreen(imageBitmap, sanitizedNodes);
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

        redactedImage = await redactScreenshot(imageBitmap, {
          faceBoxes: perception.faceBoxes,
          piiFieldBoxes,
          passwordBoxes: [] // Handled by sensitiveRects
        });
        imageBitmap.close();
      } catch (visionErr) {
        console.error("[AgentLoop] Vision loop failed:", visionErr);
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
      }

      // 🔒 PRIVACY GATE
      const gate = privacyGate(reqBody, this.tokenizer.getState().tokenMap, "block");
      if (!gate.allowed) {
        await this.transition("error", "privacy-gate-blocked");
        return;
      }

      if (this.sidepanelPort) {
        this.sidepanelPort.postMessage({
          type: "vlm-request-preview",
          payload: reqBody
        });
      }

      // Rate limit throttle: ensure at least 4s between VLM requests
      const elapsed = Date.now() - this.lastServerRequestTime;
      const minIntervalMs = 4000;
      if (elapsed < minIntervalMs && this.lastServerRequestTime > 0) {
        const waitMs = minIntervalMs - elapsed;
        console.log(`[AgentLoop] Pacing delay: waiting ${waitMs}ms before VLM request to prevent 429...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
      this.lastServerRequestTime = Date.now();

      const response = await fetch("http://localhost:8000/agent/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      const planJSON = await response.json();

      this.currentPlan = planJSON.actions || [];
      if (this.currentPlan.length === 0) {
        await this.transition("done", "VLM returned empty plan");
        return;
      }

      // Inject scale factor for click coordinates
      this.currentPlan.forEach(a => a.f = f);

      await this.executeNextActionInPlan();

    } catch (err) {
      console.error("[AgentLoop] Planning failed:", err);
      await this.transition("error", "network-error");
    } finally {
      this.isPlanningInFlight = false;
    }
  }

  async executeNextActionInPlan() {
    if (this.currentPlan.length === 0) return;

    const action = this.currentPlan.shift();

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
      console.warn("[AgentLoop] Content script unreachable, attempting reinjection...");
      await browser.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await new Promise(r => setTimeout(r, 200));
      return await browser.tabs.sendMessage(tabId, msg);
    }
  }
}
