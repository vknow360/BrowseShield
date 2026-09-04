import browser from "webextension-polyfill";
import { perceiveScreenOffscreen } from "./vision-proxy.js";
import { redactScreenshot } from "../core/vision/redactor.js";
import { detectSemanticPII, initNERPipeline } from "../core/detector/ner-pipeline.js";
import { privacyGate } from "../core/tokenizer/privacy-gate.js";
import { PIITokenizer } from "../core/tokenizer/tokenizer.js";

export class AgentLoop {
  constructor() {
    this.state = "idle";
    this.step = 0;
    this.maxSteps = 15;  // Increased from 10 — complex forms need more steps
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

    // Track filled fields to prevent re-typing
    this.filledFields = new Set();

    // Track failed actions for VLM context
    this.failedActions = [];

    // OTP/CAPTCHA detection
    this.isWaitingForUser = false;
    this.waitingReason = null;
  }

  async initialize() {
    // Rehydrate from session storage
    const s = await browser.storage.session.get(["agentState", "agentTokenMap", "agentCounters"]);
    if (s.agentState) {
      Object.assign(this, s.agentState);
      // Restore Set from array
      this.filledFields = new Set(s.agentState.filledFields || []);
    }
    if (s.agentTokenMap) {
      this.tokenizer.loadState(s.agentTokenMap, s.agentCounters || {});
    }

    // If the Service Worker restarted while the agent was running, reset
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
        errorReason: this.errorReason,
        filledFields: Array.from(this.filledFields),
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
        isWaitingForUser: this.isWaitingForUser,
        waitingReason: this.waitingReason,
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
    this.isWaitingForUser = false;
    this.waitingReason = null;
    this.filledFields = new Set();
    this.failedActions = [];
    this.consecutiveFailures = 0;
    this.lastFailedActionKey = null;
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

  async resume(newTaskInstruction = null) {
    this.isWaitingForUser = false;
    this.waitingReason = null;
    if (newTaskInstruction && newTaskInstruction.trim()) {
      const inputVal = newTaskInstruction.trim();
      const codeMatch = inputVal.match(/\b\d{4,8}\b/);
      if (codeMatch) {
        const code = codeMatch[0];
        if (this.taskInstruction && !this.taskInstruction.includes(code)) {
          this.taskInstruction = `${this.taskInstruction} (OTP: ${code})`;
        } else if (!this.taskInstruction) {
          this.taskInstruction = `Enter OTP ${code}`;
        }
      } else if (inputVal !== "Fill out this form" && inputVal !== this.taskInstruction) {
        if (this.taskInstruction && !this.taskInstruction.includes(inputVal)) {
          this.taskInstruction = `${this.taskInstruction} - ${inputVal}`;
        } else if (!this.taskInstruction) {
          this.taskInstruction = inputVal;
        }
      }
    }
    console.log(`[AgentLoop] Resuming agent with instruction: "${this.taskInstruction}"`);
    await this.transition("planning");
    await this.requestFreshScan(this.lastTabId);
  }

  async requestFreshScan(tabId) {
    try {
      await this.sendToContentScript(tabId, { type: "rescan" });
    } catch (err) {
      await this.transition("error", "content-script-unreachable");
    }
  }

  /**
   * Detect if the page has OTP or CAPTCHA elements that need user input.
   */
  detectUserInterventionNeeded(nodes) {
    for (const node of nodes) {
      const label = (node.label || "").toLowerCase();
      const placeholder = (node.placeholder || "").toLowerCase();
      const id = (node.id || "").toLowerCase();
      const name = (node.name || "").toLowerCase();
      const type = (node.type || "").toLowerCase();

      // OTP detection
      const isOTP = (
        label.includes("otp") || label.includes("verification code") ||
        label.includes("one time") ||
        placeholder.includes("otp") || placeholder.includes("verification") ||
        id.includes("otp") || name.includes("otp") ||
        (type === "tel" && (node.maxLength || 99) <= 6 && (label.includes("code") || placeholder.includes("code")))
      );

      if (isOTP && !node.value) {
        // Check if an explicit OTP digit code (4-8 digits) is present in the task instruction
        const hasExplicitOTP = (
          /\b\d{4,8}\b/.test(this.taskInstruction) ||
          /otp\s*:?\s*\d{4,8}/i.test(this.taskInstruction) ||
          /code\s*:?\s*\d{4,8}/i.test(this.taskInstruction) ||
          /\(otp\s*:?\s*\d{4,8}\)/i.test(this.taskInstruction)
        );

        if (!hasExplicitOTP) {
          return { needed: true, reason: "otp", message: "OTP field detected. Please enter the OTP, then click Resume." };
        }
      }
    }

    // CAPTCHA detection (check for recaptcha iframes or captcha images/canvases)
    // This is done via the nodes — look for img/canvas with captcha-related attributes
    for (const node of nodes) {
      const label = (node.label || "").toLowerCase();
      const id = (node.id || "").toLowerCase();
      const name = (node.name || "").toLowerCase();

      const isCaptcha = (
        label.includes("captcha") || id.includes("captcha") || name.includes("captcha") ||
        label.includes("security code") || label.includes("verification image")
      );

      if (isCaptcha && node.tagName === "INPUT" && !node.value) {
        return { needed: true, reason: "captcha", message: "CAPTCHA detected. Please solve it, then click Resume." };
      }
    }

    return { needed: false };
  }

  // Handles dom-scan-result and action-complete
  async handleScanPayload(payload, isActionComplete) {
    this.latestScan = payload;

    // 1. Centralized Tokenization
    this.tokenizer.assignTokens(payload.candidates || []);

    // Send update to sidepanel
    const sanitizedNodes = this.tokenizer.sanitizeNodes(payload.nodes);
    this.pushScanUpdate({
      ...payload,
      nodes: sanitizedNodes,
      tokenSummary: this.tokenizer.getSummary()
    });

    if (this.state === "idle" || this.state === "error" || this.state === "done") {
      return; // Ignore scans if we aren't running
    }

    // Check if user intervention is needed (OTP/CAPTCHA)
    if (!this.isWaitingForUser) {
      const intervention = this.detectUserInterventionNeeded(payload.nodes);
      if (intervention.needed) {
        console.log(`[AgentLoop] User intervention needed: ${intervention.reason}`);
        this.isWaitingForUser = true;
        this.waitingReason = intervention.message;
        await this.transition("waiting-for-user", intervention.message);
        return;
      }
    }

    if (this.state === "waiting-for-user") {
      return; // Stay paused until user clicks resume
    }

    if (this.state === "waiting-for-settle") {
      if (isActionComplete) {
        // The action finished and the DOM settled
        if (this.currentPlan.length > 0) {
          await new Promise(r => setTimeout(r, 800));
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
        // Page navigated or reloaded while waiting for action-complete
        console.log("[AgentLoop] Page navigated while waiting. Replanning.");
        this.currentPlan = [];

        // DON'T auto-done on URL change — multi-page workflows are common
        // Instead, replan to continue the task on the new page
        this.step++;
        if (this.step > this.maxSteps) {
          await this.transition("done", "Max steps reached");
          return;
        }
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

        const perception = await perceiveScreenOffscreen(imageBitmap, sanitizedNodes);
        screenType = perception.screenType;
        uiBoxes = perception.uiBoxes || [];

        // Scale content script rects
        const piiFieldBoxes = (payload.sensitiveRects || []).map(r => ({
          x: r.x * f, y: r.y * f, w: r.w * f, h: r.h * f
        }));

        for (const node of payload.nodes) {
          if ((node.hasPII || node.pii) && node.box && node.box.length === 4) {
            piiFieldBoxes.push({
              x: node.box[0] * f, y: node.box[1] * f, w: node.box[2] * f, h: node.box[3] * f
            });
          }
        }

        (perception.piiVisionBoxes || []).forEach(box => {
          piiFieldBoxes.push({ x: box.x, y: box.y, w: box.w, h: box.h });
        });

        redactedImage = await redactScreenshot(imageBitmap, {
          faceBoxes: perception.faceBoxes,
          piiFieldBoxes,
          passwordBoxes: []
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
        filledFields: Array.from(this.filledFields),
        failedActions: this.failedActions.slice(-3),
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

      // Rate limit throttle: ensure at least 3s between VLM requests
      const elapsed = Date.now() - this.lastServerRequestTime;
      const minIntervalMs = 3000;
      if (elapsed < minIntervalMs && this.lastServerRequestTime > 0) {
        const waitMs = minIntervalMs - elapsed;
        console.log(`[AgentLoop] Pacing delay: waiting ${waitMs}ms...`);
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

    // Rehydrate any tokenized values back to raw PII
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
        // Track failed action for VLM context
        this.failedActions.push({
          action: action.action,
          target: action.target,
          error: response.error || "unknown"
        });

        // Loop-breaker: track consecutive identical failures
        const actionKey = `${action.action}|${JSON.stringify(action.target)}|${action.value || ''}`;
        if (actionKey === this.lastFailedActionKey) {
          this.consecutiveFailures++;
        } else {
          this.consecutiveFailures = 1;
          this.lastFailedActionKey = actionKey;
        }

        if (this.consecutiveFailures >= 3) {
          console.warn(`[AgentLoop] Same action failed ${this.consecutiveFailures}x. Stopping.`);
          this.consecutiveFailures = 0;
          this.lastFailedActionKey = null;
          await this.transition("done", "Repeated action failures — task may be stuck");
          return;
        }

        console.warn(`[AgentLoop] Action failed: ${response.error}. Discarding plan, will replan with error context.`);
        this.currentPlan = []; // Force replan
      } else {
        // Success — reset failure tracking
        this.consecutiveFailures = 0;
        this.lastFailedActionKey = null;

        // Track filled fields
        if (action.action === "type" && action.target && typeof action.target === "string") {
          this.filledFields.add(action.target);
        }
      }

      // Wait for content script to push 'action-complete'
      await this.transition("waiting-for-settle");

      // Safety timeout — increased to 30s for slow pages
      setTimeout(() => {
        if (this.state === "waiting-for-settle") {
          console.warn("[AgentLoop] Safety timeout triggered (30s).");
          this.transition("error", "timeout");
        }
      }, 30000);

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
