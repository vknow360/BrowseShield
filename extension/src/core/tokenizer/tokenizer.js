/// <reference types="chrome" />
import { DEFAULT_PRIVACY_POLICY, generateToken } from "./privacy-policy.js";

// Centralized tokenizer for BrowseShield.
// State (tokenMap, counters) is owned by the background script (agent-loop).
export class PIITokenizer {
  constructor(policy = DEFAULT_PRIVACY_POLICY) {
    this.policy = policy;
    this.counters = {};
    this.tokenMap = {};
  }

  loadState(tokenMap = {}, counters = {}) {
    this.tokenMap = tokenMap;
    this.counters = counters;
  }

  getState() {
    return { tokenMap: this.tokenMap, counters: this.counters };
  }

  _findExistingToken(realValue) {
    for (const [token, data] of Object.entries(this.tokenMap)) {
      if (data.realValue === realValue) return token;
    }
    return null;
  }

  // 1. Extract candidates from tagged DOM nodes without modifying them or the tokenMap
  static extractNodeCandidates(nodes, confidenceThreshold) {
    const candidates = [];
    for (const n of nodes) {
      if (!n.pii || !n.pii.isPII) continue;
      if ((n.pii.confidence ?? 0) < confidenceThreshold) continue;
      
      const realValue = String(n.value ?? "").trim();
      if (realValue.length === 0) continue;
      
      candidates.push({
        realValue,
        entityType: n.pii.entityType,
        selector: n.selector,
        confidence: n.pii.confidence,
        source: n.pii.source
      });
    }
    return candidates;
  }

  // 2. Add raw candidates (from DOM and prompt) to the token map
  assignTokens(candidates) {
    let tokensAdded = false;
    for (const c of candidates) {
      if (!c.realValue || c.realValue.length < 2) continue;
      
      let token = this._findExistingToken(c.realValue);
      if (!token) {
        // Find if we already have a token for this exact input field (DOM candidates only)
        let existingTokenForField = null;
        if (c.selector) {
          for (const [t, data] of Object.entries(this.tokenMap)) {
            if (data.selector === c.selector && data.entityType === c.entityType) {
              existingTokenForField = t;
              break;
            }
          }
        }

        if (existingTokenForField) {
          token = existingTokenForField;
          this.tokenMap[token].realValue = c.realValue;
          this.tokenMap[token].confidence = Math.max(
            this.tokenMap[token].confidence,
            c.confidence || 1.0,
          );
        } else {
          token = generateToken(c.entityType, this.counters, this.policy);
          this.tokenMap[token] = {
            realValue: c.realValue,
            entityType: c.entityType,
            selector: c.selector || null,
            confidence: c.confidence || 1.0,
            source: c.source || "prompt-analyzer",
          };
          tokensAdded = true;
        }
      }
    }
    return tokensAdded;
  }

  // 3. Sanitize text/nodes using the current tokenMap
  sanitizeNodes(nodes) {
    const sanitizedNodes = nodes.map((n) => {
      const copy = {
        ...n,
        box: Array.isArray(n.box) ? [...n.box] : n.box ? { ...n.box } : null,
      };
      delete copy.pii; // do not ship detector internals to the server view
      return copy;
    });

    // Global scrubbing pass: sanitize ANY occurrence of known PII across all nodes, labels, and placeholders
    // Sort by length descending to replace longest strings first (e.g. full name before first name)
    const sortedTokens = Object.entries(this.tokenMap).sort(
      (a, b) => b[1].realValue.length - a[1].realValue.length
    );

    for (const [token, data] of sortedTokens) {
      const val = data.realValue;
      if (!val || val.length < 2) continue;
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gi");

      for (const node of sanitizedNodes) {
        let replaced = false;
        
        if (typeof node.value === "string") {
          const newVal = node.value.replace(regex, token);
          if (newVal !== node.value) {
            node.value = newVal;
            replaced = true;
          }
        }
        if (typeof node.label === "string") {
          const newLabel = node.label.replace(regex, token);
          if (newLabel !== node.label) {
            node.label = newLabel;
            replaced = true;
          }
        }
        if (typeof node.placeholder === "string") {
          const newPlaceholder = node.placeholder.replace(regex, token);
          if (newPlaceholder !== node.placeholder) {
            node.placeholder = newPlaceholder;
            replaced = true;
          }
        }
        
        if (replaced) {
          node.hasPII = true;
        }
      }
    }
    return sanitizedNodes;
  }

  sanitizeString(text) {
    let sanitized = String(text || "");
    const sortedTokens = Object.entries(this.tokenMap).sort(
      (a, b) => b[1].realValue.length - a[1].realValue.length
    );

    for (const [token, data] of sortedTokens) {
      const val = data.realValue;
      if (!val || val.length < 2) continue;
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Use word boundaries for prompt sanitization if applicable to avoid nested replace
      const prefix = /^[\w]/.test(val) ? "\\b" : "";
      const suffix = /[\w]$/.test(val) ? "\\b" : "";
      sanitized = sanitized.replace(new RegExp(`${prefix}${escaped}${suffix}`, "gi"), token);
    }
    return sanitized;
  }

  rehydrate(token) {
    return this.tokenMap[token]?.realValue ?? token;
  }

  rehydrateString(str) {
    return String(str).replace(/\[\[[A-Z_]+_\d+\]\]/g, (m) =>
      this.rehydrate(m),
    );
  }

  getSummary() {
    return Object.entries(this.tokenMap).map(([token, d]) => ({
      token,
      entityType: d.entityType,
      isOpaque: token.startsWith("[[VALUE_"),
      maskedValue: maskValue(d.realValue, d.entityType),
      confidence: d.confidence,
      source: d.source,
    }));
  }
}

export function maskValue(value, entityType) {
  if (entityType === "PASSWORD") return "••••••••";
  const s = String(value).trim();
  if (s.length <= 4) return "••••";
  return s.slice(0, 2) + "•".repeat(Math.max(s.length - 4, 3)) + s.slice(-2);
}
