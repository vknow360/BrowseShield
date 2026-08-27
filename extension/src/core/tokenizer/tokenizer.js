/// <reference types="chrome" />
import { DEFAULT_PRIVACY_POLICY, generateToken } from './privacy-policy.js';

import browser from "webextension-polyfill";

const STORAGE_KEYS = { MAP: 'tokenMap', COUNTERS: 'tokenCounters' };

export class PIITokenizer {
  constructor(policy = DEFAULT_PRIVACY_POLICY) {
    this.policy = policy;
    this.counters = {};   // { PERSON: 1, EMAIL: 1, VALUE: 2, ... }
    this.tokenMap = {};   // { '[[PERSON_1]]': { realValue, entityType, selector, confidence, source } }
  }

  // Restore across service-worker/page reloads. Safe if storage empty.
  async initialize() {
    try {
      const s = await browser.storage.local.get([STORAGE_KEYS.MAP, STORAGE_KEYS.COUNTERS]);
      this.tokenMap = s[STORAGE_KEYS.MAP] || {};
      this.counters = s[STORAGE_KEYS.COUNTERS] || {};
    } catch (e) {
      console.warn('[ShieldBrowse] tokenizer.initialize failed (access level?):', e);
    }
  }

  async persist() {
    await browser.storage.local.set({
      [STORAGE_KEYS.MAP]: this.tokenMap,
      [STORAGE_KEYS.COUNTERS]: this.counters
    });
  }

  _findExistingToken(realValue) {
    for (const [token, data] of Object.entries(this.tokenMap)) {
      if (data.realValue === realValue) return token;
    }
    return null;
  }

  // nodes: output of scanPageForPII (each may have node.pii = {isPII, entityType, confidence, source})
  // returns { sanitizedNodes, tokenMap }  — tokenMap is LOCAL ONLY, never sent
  async tokenize(nodes) {
    const sanitizedNodes = nodes.map((n) => {
      const copy = { 
        ...n, 
        box: Array.isArray(n.box) ? [...n.box] : (n.box ? { ...n.box } : null) 
      };
      delete copy.pii; // do not ship detector internals to the server view

      const pii = n.pii;
      const realValue = String(n.value ?? '').trim();
      if (!pii || !pii.isPII) return copy;
      if ((pii.confidence ?? 0) < this.policy.confidenceThreshold) return copy;
      if (realValue.length === 0) return copy; // nothing to tokenize (incl. empty password fields the detector still flags)

      let token = this._findExistingToken(realValue);
      if (!token) {
        token = generateToken(pii.entityType, this.counters, this.policy);
        this.tokenMap[token] = {
          realValue,
          entityType: pii.entityType,
          selector: n.selector,     // real node field name (NOT cssSelector)
          confidence: pii.confidence,
          source: pii.source
        };
      }
      copy.value = token;
      return copy;
    });

    // 2. Global scrubbing pass: sanitize ANY occurrence of known PII across all nodes, labels, and placeholders
    for (const [token, data] of Object.entries(this.tokenMap)) {
      const val = data.realValue;
      if (!val || val.length < 2) continue;
      const escaped = val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      for (const node of sanitizedNodes) {
        if (typeof node.value === 'string') {
          node.value = node.value.replace(new RegExp(escaped, 'gi'), token);
        }
        if (typeof node.label === 'string') {
          node.label = node.label.replace(new RegExp(escaped, 'gi'), token);
        }
        if (typeof node.placeholder === 'string') {
          node.placeholder = node.placeholder.replace(new RegExp(escaped, 'gi'), token);
        }
      }
    }

    await this.persist();
    return { sanitizedNodes, tokenMap: this.tokenMap };
  }

  rehydrate(token) {
    return this.tokenMap[token]?.realValue ?? token;
  }

  // Matches typed ([[EMAIL_1]], [[DATE_OF_BIRTH_2]]) AND opaque ([[VALUE_7]]).
  // [A-Z_]+ greedily takes the type incl. internal underscores; _\d+ pins the counter.
  rehydrateString(str) {
    return String(str).replace(/\[\[[A-Z_]+_\d+\]\]/g, (m) => this.rehydrate(m));
  }

  getSummary() {
    return Object.entries(this.tokenMap).map(([token, d]) => ({
      token,
      entityType: d.entityType,
      isOpaque: token.startsWith('[[VALUE_'),
      maskedValue: maskValue(d.realValue, d.entityType),
      confidence: d.confidence,
      source: d.source
    }));
  }

  async clear() {
    this.tokenMap = {}; this.counters = {};
    await browser.storage.local.remove([STORAGE_KEYS.MAP, STORAGE_KEYS.COUNTERS]);
  }
}

export function maskValue(value, entityType) {
  if (entityType === 'PASSWORD') return '••••••••';
  const s = String(value).trim();
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '•'.repeat(Math.max(s.length - 4, 3)) + s.slice(-2);
}
