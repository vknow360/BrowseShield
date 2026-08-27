# ShieldBrowse — Next Features Implementation Plan
### Feature 1: Reversible Tokenizer (+ Privacy Policy) · Feature 2: Privacy Gate
#### SIH 2026 | ISRO — On-Device Visual Perception for Lightweight Browser Agents

> **Status of this doc:** actionable engineering plan for the next two features. Grounded in the *actual* code in `extension/src/`, not the idealized snippets in `PLAN.md`. Paths, function names, and data shapes below match what is really in the repo as of the latest commit (`feat(detector): add PII engine and live inspector UI`).

---

## 1. Why these two, and in this order

`PLAN.md` describes a 9-step core loop (capture → detect → **redact/tokenize** → send → reason → return → rehydrate → execute → re-capture). Today the build stops after **detect**. The two features in this plan cover step 3 (tokenize) and the enforcement boundary that guards step 4 (send):

- **Reversible Tokenizer (Component 5 + 5a)** is the keystone dependency. `extension/src/core/tokenizer/tokenizer.js` exists but is **empty (0 bytes)**. Nothing downstream — the "what the server sees" preview, the network layer, the action executor, the DPDP report — can be built until tokens exist. It is also the project's headline differentiator and the Day-3 item on the schedule.
- **Privacy Gate (Component 5b)** is the natural companion. It consumes the tokenizer's token map and turns "we sanitize before sending" into "unsanitized data *cannot* leave." It is the centre of the updated PRD narrative ("enforceable privacy boundary") and is small, testable, and demo-able **even before the server exists**.

Together they produce a self-contained, judge-visible artifact: *real PII in → tokens out → gate proves no raw PII crosses the boundary*, all with no server dependency.

**Explicitly out of scope for this plan** (tracked as follow-ups in §8): the FastAPI/Ollama server, the network `fetch()` layer, the action executor/rehydration-on-execute, NER (Layer 2), semantic medical/financial detection (Layer 5), vision/OCR/face pipeline, image redaction, benchmark suite, DPDP report.

---

## 2. Current state this plan builds on (self-contained recap)

Real module layout (nested, **not** the flat `src/*.js` in PLAN.md §18):

```
extension/src/
├── background/index.js         # service worker: onInstalled, sidePanel behavior, relays 'ping' → 'update-panel'
├── content/
│   ├── index.js                # orchestrator: extract → scanPageForPII → build piiList → sendMessage('ping', …)
│   └── dom-walker.js           # extractPageStructure(root) + findLabelForInput(el)
├── core/
│   ├── detector/
│   │   ├── index.js            # detectFieldPII(node) + scanPageForPII(nodes)
│   │   └── regex.js            # isValidAadharNumber/Pan/PhoneNumber/Email/CreditCard/IFSC/Pincode
│   └── tokenizer/tokenizer.js  # ⬅ EMPTY — Feature 1 fills this
├── ui/
│   ├── popup/                  # opens side panel
│   └── sidepanel/{index.html,index.js,index.css}   # renders PII list + raw DOM stream
└── utils/debounce.js
```

**Exact data shapes we must code against** (these differ from PLAN.md — respect the real ones):

A DOM-walker node (`extractPageStructure().nodes[i]`):
```js
{ id, name, tagName, type, label, value, placeholder, autocomplete, selector, box:{x,y,width,height} }
// NOTE: field is `selector` (not `cssSelector`); there is NO `nodeIndex`.
```

A detector result (`detectFieldPII(node)`), attached by `scanPageForPII` as `node.pii`:
```js
{ isPII: true, entityType: 'AADHAAR', confidence: 1.0, source: 'checksum-verhoeff' }  // or null
```

Entity types the detector currently emits: `AADHAAR, PAN, EMAIL, PHONE, CREDIT_CARD, IFSC, PINCODE, PASSWORD, PERSON, DATE_OF_BIRTH, ADDRESS, CITY, STATE`. (No `MEDICAL`/`FINANCIAL` yet — relevant to opaque-token planning in §3.4.)

**Critical current-flow fact the plan must fix:** `content/index.js` today sends `payload: { …, piiList, fields: taggedNodes }` to the background, and `fields`/`piiList` contain **raw** `node.value`s. That is acceptable for the *local* side panel, but it means there is currently **no sanitized payload object** anywhere. Feature 1 introduces a distinct `sanitizedPayload` (tokens only); Feature 2's gate validates *that* object, and the side panel's "what the server sees" view renders *that* object — never the raw `fields`.

Detection today is **whole-field**: one `entityType` per node, no character offsets. So tokenization replaces the **entire** `node.value` with a single token — simpler and more robust than PLAN.md's substring `startPos/endPos` scheme. We keep it whole-field.

---

## 3. Feature 1 — Reversible Tokenizer (+ Privacy Policy)

### 3.1 Goal
Given the array of scanned nodes (each possibly carrying `.pii`), produce:
1. `sanitizedNodes` — a deep copy where every PII field's `value` is replaced by a token (`[[PERSON_1]]`, or opaque `[[VALUE_1]]` for sensitive categories).
2. `tokenMap` — `{ token → { realValue, entityType, selector, confidence, source } }`, held **only** in the browser, persisted to `chrome.storage.session`, never serialized into any outbound object.
3. A rehydration API (`rehydrate`, `rehydrateString`) for the future action executor.
4. A side-panel summary (masked values + token + which category is opaque).

### 3.2 Design decisions (and rationale)
- **Whole-value tokenization.** Detector is field-level, so `node.value` → one token. Avoids offset bookkeeping the detector can't currently supply.
- **Where it runs: the content script.** Detection already runs there (`content/index.js`), and the future action executor (rehydration consumer) will also run there. Keeping tokenization + map + rehydration co-located in the content-script context is the least-surprising design.
- **Storage: `chrome.storage.session`.** Session-scoped, auto-cleared on browser close, never hits disk or sync. **Gotcha (must handle):** `chrome.storage.session` defaults to `TRUSTED_CONTEXTS` only — a content script (an *untrusted* context) cannot read/write it until the **service worker** calls `chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })`. This one line in `background/index.js` is a hard prerequisite; without it the content-script tokenizer's `persist()`/`initialize()` throw. (See §3.7.)
- **Dedup by real value.** The same real value reuses its existing token (so two "Rahul Sharma" fields both map to `[[PERSON_1]]`), which is what the agent expects.
- **Policy-driven typed vs opaque.** A separate `privacy-policy.js` decides, per entity type, whether the token reveals the category (`[[EMAIL_1]]`) or is opaque (`[[VALUE_1]]`). Built now so it's ready; opaque categories (`MEDICAL`, `FINANCIAL`) won't actually fire until Layer 5 detection lands, and the plan says so rather than pretending otherwise.
- **Confidence threshold.** Respect `policy.confidenceThreshold` (default 0.70). Current detections are 0.75–1.0, so all pass today; the hook matters once fuzzier layers arrive.

### 3.3 Files
| File | Action | Purpose |
|---|---|---|
| `extension/src/core/tokenizer/privacy-policy.js` | **create** | Typed/opaque category config, threshold, enforcement mode, `generateToken()` |
| `extension/src/core/tokenizer/tokenizer.js` | **fill (currently empty)** | `PIITokenizer` class: tokenize, dedup, persist/restore, rehydrate, summary |
| `extension/src/content/index.js` | **modify** | Call tokenizer after `scanPageForPII`; build + attach `sanitizedPayload`; send tokens-only view |
| `extension/src/background/index.js` | **modify** | `setAccessLevel` for session storage on startup |
| `extension/tests/tokenizer.test.js` | **create** (see §3.10) | Round-trip + dedup + opaque + rehydrate unit tests |

### 3.4 `privacy-policy.js` — specification

```js
// extension/src/core/tokenizer/privacy-policy.js

export const DEFAULT_PRIVACY_POLICY = {
  // Category is revealed in the token; value is not. Server learns "there is an email".
  typedTokenCategories: [
    'PERSON', 'EMAIL', 'PHONE', 'AADHAAR', 'PAN', 'CREDIT_CARD', 'IFSC',
    'PINCODE', 'PASSWORD', 'ADDRESS', 'CITY', 'STATE', 'DATE_OF_BIRTH'
  ],
  // Even the category leaks meaning → emit [[VALUE_N]]. (Fires once Layer 5 detects these.)
  opaqueTokenCategories: ['MEDICAL', 'FINANCIAL'],
  enforcement: 'block',        // 'block' = fail-closed (prod/demo). 'warn' = log only (dev).
  confidenceThreshold: 0.70
};

// counters shape: { PERSON: 2, EMAIL: 1, VALUE: 5, ... }  (VALUE is the shared opaque counter)
export function generateToken(entityType, counters, policy = DEFAULT_PRIVACY_POLICY) {
  if (policy.opaqueTokenCategories.includes(entityType)) {
    counters.VALUE = (counters.VALUE || 0) + 1;
    return `[[VALUE_${counters.VALUE}]]`;
  }
  counters[entityType] = (counters[entityType] || 0) + 1;
  return `[[${entityType}_${counters[entityType]}]]`;
}
```

### 3.5 `tokenizer.js` — specification (fills the empty file)

```js
// extension/src/core/tokenizer/tokenizer.js
/// <reference types="chrome" />
import { DEFAULT_PRIVACY_POLICY, generateToken } from './privacy-policy.js';

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
      const s = await chrome.storage.session.get([STORAGE_KEYS.MAP, STORAGE_KEYS.COUNTERS]);
      this.tokenMap = s[STORAGE_KEYS.MAP] || {};
      this.counters = s[STORAGE_KEYS.COUNTERS] || {};
    } catch (e) {
      console.warn('[ShieldBrowse] tokenizer.initialize failed (access level?):', e);
    }
  }

  async persist() {
    await chrome.storage.session.set({
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
      const copy = { ...n, box: { ...n.box } };
      delete copy.pii; // do not ship detector internals to the server view

      const pii = n.pii;
      const realValue = String(n.value ?? '');
      if (!pii || !pii.isPII) return copy;
      if ((pii.confidence ?? 0) < this.policy.confidenceThreshold) return copy;
      if (realValue.trim().length === 0) return copy; // nothing to tokenize (incl. empty password fields the detector still flags)

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
    await chrome.storage.session.remove([STORAGE_KEYS.MAP, STORAGE_KEYS.COUNTERS]);
  }
}

export function maskValue(value, entityType) {
  if (entityType === 'PASSWORD') return '••••••••';
  const s = String(value).trim();
  if (s.length <= 4) return '••••';
  return s.slice(0, 2) + '•'.repeat(Math.max(s.length - 4, 3)) + s.slice(-2);
}
```

> Note: `sidepanel/index.js` already has a local `maskValue`. Export one from the tokenizer and have the side panel import it (single source of truth), or leave the panel's copy — pick one to avoid drift. Recommendation: import from tokenizer.

### 3.6 Integration into `content/index.js`

Insert tokenization between `scanPageForPII` and the outbound message, and build a **tokens-only** `sanitizedPayload`:

```js
import { PIITokenizer } from '../core/tokenizer/tokenizer.js';
const tokenizer = new PIITokenizer();
let tokenizerReady = tokenizer.initialize();   // fire once

async function scanAndEmit() {
  const t0 = performance.now();
  const pageStructure = extractPageStructure(document.body);
  const taggedNodes   = scanPageForPII(pageStructure.nodes);

  await tokenizerReady;
  const tokenizeStart = performance.now();
  const { sanitizedNodes } = await tokenizer.tokenize(taggedNodes);
  const tokenizeMs = Math.round(performance.now() - tokenizeStart);

  const sanitizedPayload = {                 // ← this is the ONLY thing modelled as "server-bound"
    url: pageStructure.url,
    title: pageStructure.title,
    nodes: sanitizedNodes,                    // tokens only
    tokenTypes: Object.keys(tokenizer.counters)
  };

  // (Feature 2 hooks in HERE — run the Privacy Gate over sanitizedPayload before sending.)

  const piiList = /* unchanged: built from taggedNodes for LOCAL panel display */;
  chrome.runtime.sendMessage({
    type: 'ping',
    payload: {
      url: pageStructure.url, title: pageStructure.title, timestamp: Date.now(),
      metrics: { totalNodes: taggedNodes.length, piiCount: piiList.length,
                 scanTimeMs: Math.round(performance.now() - t0), tokenizeMs },
      piiList,                                 // raw — local UI only
      tokenSummary: tokenizer.getSummary(),    // masked + token, for the "detected" list
      sanitizedPayload                         // tokens only, for "what server sees"
      // NOTE: stop sending `fields: taggedNodes` (raw values) as the server-facing object.
    }
  }).catch(() => {});
}
```

`scanAndEmit` becomes `async`; the `input`/`change` listeners already call it fine (fire-and-forget).

### 3.7 `background/index.js` — enable session storage for the content script

```js
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch((e) => console.error('[ShieldBrowse] setAccessLevel failed:', e));
  console.log('[ShieldBrowse] Background Service Worker initialized.');
});
```
Also call it in an `onStartup` listener so it survives browser restarts, not just install/update.

### 3.8 Before / after (using the real node shape)

Input node (post-detect):
```js
{ id:'aadhaar', name:'aadhaar', tagName:'INPUT', type:'text', label:'Aadhaar Number',
  value:'2345 6789 0123', selector:'#aadhaar', box:{…},
  pii:{ isPII:true, entityType:'AADHAAR', confidence:1.0, source:'checksum-verhoeff' } }
```
Sanitized node (in `sanitizedPayload.nodes`):
```js
{ id:'aadhaar', name:'aadhaar', tagName:'INPUT', type:'text', label:'Aadhaar Number',
  value:'[[AADHAAR_1]]', selector:'#aadhaar', box:{…} }        // pii stripped, value tokenized
```
Token map (local only, in `chrome.storage.session`):
```js
{ '[[AADHAAR_1]]': { realValue:'2345 6789 0123', entityType:'AADHAAR',
                     selector:'#aadhaar', confidence:1.0, source:'checksum-verhoeff' } }
```

### 3.9 Edge cases to cover
- **Empty PASSWORD field:** detector flags `type=password` even with no value; skip creating a token when there's genuinely no value (nothing to protect), but keep the field in `sanitizedNodes`.
- **Duplicate values across fields:** must reuse the same token (dedup by `realValue`).
- **Re-scan on every keystroke:** `tokenize()` runs on each debounced input. Because dedup is by value, partial values while typing create throwaway tokens (`[[EMAIL_1]]` for `r`, then `[[EMAIL_2]]` for `ra`…). **Mitigation:** only tokenize fields whose `pii.confidence` clears threshold *and* (for regex/checksum types) that actually validate — a half-typed Aadhaar fails Verhoeff so won't tokenize until complete. For label-heuristic types (PERSON/ADDRESS) that fire on any value, accept transient tokens for now and note token-map growth as a known limitation; add a `clear()` on navigation. (A later optimization: tokenize only on `change`/blur, not every `input`.)
- **Token counter monotonicity:** counters persist in session storage, so numbering is stable across service-worker restarts within a session.
- **`box` mutation:** deep-copy `box` (done above) so the sanitized copy can't mutate the live node.

### 3.10 Tests & acceptance — Feature 1
Unit (Vitest/Jest — add `extension/tests/tokenizer.test.js`; mock `chrome.storage.session` with an in-memory object):
- round-trip: `rehydrateString(tokenize(nodes).sanitizedNodes[i].value)` returns the original real value.
- dedup: two nodes, same value → one token, map size 1.
- typed vs opaque: `MEDICAL` → `[[VALUE_1]]`; `EMAIL` → `[[EMAIL_1]]`.
- threshold: a detection at confidence 0.5 with `confidenceThreshold 0.70` is **not** tokenized.
- underscore types: `DATE_OF_BIRTH` tokenizes to `[[DATE_OF_BIRTH_1]]` and rehydrates correctly (regex correctness).

Manual acceptance (maps to PLAN.md §20.1):
- [ ] Tokenizer generates unique tokens per PII instance.
- [ ] Opaque tokens work for MEDICAL/FINANCIAL categories (verify with a stubbed detection until Layer 5 exists).
- [ ] Token map persists in `chrome.storage.session` across service-worker restarts.
- [ ] Sanitized `nodes` contain ONLY tokens (manually inspect `sanitizedPayload`).

---

## 4. Feature 2 — Privacy Gate (fail-closed outbound inspection)

### 4.1 Goal
Before any object leaves its context toward the server, scan its serialized form for **any** real PII value from the token map. If even one appears → **block** (fail-closed) and report the violation. This is the enforcement that makes the privacy boundary real rather than aspirational.

### 4.2 Design decisions
- **Pure, dependency-free function** (`validateOutboundPayload`) so it is trivially unit-testable and reusable at multiple egress points.
- **Two egress points, same function (defense-in-depth):**
  1. **Now:** in `content/index.js`, immediately before `chrome.runtime.sendMessage(... sanitizedPayload ...)`. Since there is no server yet, the content→background hop is treated as the boundary; the gate result is surfaced in the side panel. This makes the gate demo-able today.
  2. **Later (when Component 7 lands):** in `background/index.js`, immediately before `fetch()` — the authoritative network egress. The same function is called again.
- **Match strategy:** structured types (`AADHAAR, PAN, PHONE, EMAIL, CREDIT_CARD, IFSC, PINCODE`) use exact substring match; free-text types (`PERSON, ADDRESS, CITY, STATE`) use case-insensitive match. Skip values ≤ 2 chars (noise).
- **What the gate scans:** the `sanitizedPayload` object only. It must **not** be handed the raw `piiList`/`tokenSummary` (those legitimately contain masked/raw values for local UI and would trip the gate). Clear separation of "server-bound" vs "local-UI" objects (established in §3.6) is what makes the gate meaningful.

### 4.3 Files
| File | Action | Purpose |
|---|---|---|
| `extension/src/core/tokenizer/privacy-gate.js` | **create** | `validateOutboundPayload()` + `privacyGate()` |
| `extension/src/content/index.js` | **modify** | Run gate on `sanitizedPayload`; only send if allowed; else emit `privacy-violation` |
| `extension/src/ui/sidepanel/index.html` + `index.js` + `index.css` | **modify** | Add "What the server sees" panel + Privacy-Gate status chip |
| `extension/tests/privacy-gate.test.js` | **create** | block/allow/edge tests |

### 4.4 `privacy-gate.js` — specification

```js
// extension/src/core/tokenizer/privacy-gate.js

const STRUCTURED_TYPES = new Set([
  'AADHAAR','PAN','PHONE','EMAIL','CREDIT_CARD','IFSC','PINCODE','PASSPORT','VEHICLE','BANK_ACCOUNT'
]);

export function validateOutboundPayload(serializedPayload, tokenMap) {
  const violations = [];
  if (!tokenMap || typeof tokenMap !== 'object') return { allowed: true, violations };

  for (const [token, data] of Object.entries(tokenMap)) {
    const v = data?.realValue;
    if (!v || typeof v !== 'string' || v.trim().length <= 2) continue;
    const hit = STRUCTURED_TYPES.has(data.entityType)
      ? serializedPayload.includes(v)
      : serializedPayload.toLowerCase().includes(v.toLowerCase());
    if (hit) violations.push({ token, realValue: v, entityType: data.entityType });
  }
  return { allowed: violations.length === 0, violations };
}

// enforcement: 'block' (default) or 'warn'
export function privacyGate(outboundPayload, tokenMap, enforcement = 'block') {
  const serialized = JSON.stringify(outboundPayload);
  const result = validateOutboundPayload(serialized, tokenMap);
  if (!result.allowed && enforcement === 'block') {
    console.error('[ShieldBrowse] 🔒 PRIVACY GATE BLOCKED — raw PII in outbound:',
      result.violations.map(v => `${v.entityType} "${v.realValue}" should be ${v.token}`));
  }
  return { ...result, serialized };
}
```

### 4.5 Integration in `content/index.js` (the §3.6 hook)

```js
import { privacyGate } from '../core/tokenizer/privacy-gate.js';
import { DEFAULT_PRIVACY_POLICY } from '../core/tokenizer/privacy-policy.js';

const gate = privacyGate(sanitizedPayload, tokenizer.tokenMap, DEFAULT_PRIVACY_POLICY.enforcement);
if (!gate.allowed) {
  chrome.runtime.sendMessage({
    type: 'privacy-violation',
    payload: { violations: gate.violations, url: pageStructure.url, timestamp: Date.now() }
  }).catch(() => {});
  return; // ← sanitizedPayload is NOT sent. Fail closed.
}
// allowed → send the 'ping' message as in §3.6 (optionally include gateStatus:'PASS')
```

Background relays `privacy-violation` to the side panel the same way it relays `ping`→`update-panel` (add one `if` branch in `background/index.js`).

### 4.6 Side-panel additions
- **"📡 What the server sees"** card: render `payload.sanitizedPayload.nodes` (tokens only). This is the demo's Moment 3 / Moment 1 artifact.
- **Privacy-Gate status chip:** green `🔒 GATE: PASS` on `update-panel`; red `🔒 GATE: BLOCKED (n)` on `privacy-violation`, listing `entityType → token` for each violation.
- Reuse existing card/badge CSS; add `.gate-pass` / `.gate-blocked` classes.

### 4.7 Edge cases
- **False positive from legitimate repetition:** if a real value also appears in an un-tokenized spot (e.g., a name echoed in `title` or a `placeholder`), the gate blocks. This is *correct* — it means the tokenizer missed an instance. Treat a block as a tokenizer bug to fix, not a gate to loosen.
- **Very common short values** (e.g., city "Goa", state "Bihar"): the ≤2-char skip plus the case-insensitive match can over-trigger on common substrings inside longer words. Note as a known precision risk; the whole-field detector currently only flags actual field values so real-world incidence is low. If it bites, tighten free-text matching to word-boundary (`\b`) matching in a later iteration.
- **`enforcement:'warn'`** path for local dev (logs, still sends) — keep default `'block'` for demos.
- **Empty token map** (page with no PII) → `allowed:true`, gate shows PASS.

### 4.8 Tests & acceptance — Feature 2
Unit (`privacy-gate.test.js`):
- allow: payload of tokens only, map present → `allowed:true`, no violations.
- block: inject one real Aadhaar into the serialized payload → `allowed:false`, one violation with correct token/type.
- case-insensitive: lowercase copy of a PERSON value in payload → detected.
- skip-short: 2-char real value never triggers.
Manual acceptance (maps to PLAN.md §20.1):
- [ ] Privacy Gate blocks the message when raw PII is present in the outbound payload.
- [ ] Privacy Gate allows the message when the payload is properly sanitized.
- [ ] **Network/console proof:** deliberately break the tokenizer (comment out one `copy.value = token`) → gate blocks + side panel shows the violation (Demo Moment 2).
- [ ] Side panel "what the server sees" shows tokens only.

---

## 5. Updated data flow (after both features)

```
extract DOM ─▶ scanPageForPII ─▶ tokenizer.tokenize()
                                      │        │
                          sanitizedPayload   tokenMap (chrome.storage.session, local only)
                                      │        │
                                      ▼        ▼
                              🔒 privacyGate(sanitizedPayload, tokenMap)
                                      │
                         ┌────────────┴─────────────┐
                    allowed? no                  allowed? yes
                         │                            │
                'privacy-violation'            'ping' {sanitizedPayload, tokenSummary, metrics}
                         │                            │
                         └────────────▶ background ◀──┘
                                        │ relay
                                        ▼
                                    side panel  (PII list · what-server-sees · GATE status · metrics)
```
When Component 7 (network) lands, the same `privacyGate()` runs again in `background` right before `fetch()`.

---

## 6. Sequencing & estimated effort

| # | Step | Depends on | Est. |
|---|---|---|---|
| 1 | `privacy-policy.js` (config + `generateToken`) | — | 0.5 h |
| 2 | `tokenizer.js` (`PIITokenizer`) | 1 | 2–3 h |
| 3 | `background` `setAccessLevel` (install + startup) | — | 0.25 h |
| 4 | Wire tokenizer into `content/index.js` (async, `sanitizedPayload`, stop shipping raw `fields`) | 2,3 | 1 h |
| 5 | `privacy-gate.js` (pure fns) | — | 0.75 h |
| 6 | Gate integration in `content/index.js` + `privacy-violation` relay in `background` | 4,5 | 1 h |
| 7 | Side panel: "what server sees" + gate chip | 4,6 | 1.5 h |
| 8 | Unit tests (tokenizer + gate) | 2,5 | 1.5 h |
| 9 | Manual demo pass (fill profile, inspect, trigger block) | all | 0.5 h |

Rough total **~9–10 h** (≈ the Day-3 slot). Steps 1–4 are the critical path; 5–6 can proceed in parallel once shapes are agreed.

---

## 7. Risks & mitigations
- **Session-storage access from content script** → the `setAccessLevel` prerequisite; test `initialize()`/`persist()` early (step 3 before step 4).
- **Token-map growth from per-keystroke scans** → checksum/regex types self-gate; consider tokenizing on `change` only; add `clear()` on navigation.
- **Gate false positives on common short strings** → ≤2-char skip now; word-boundary matching later if needed.
- **Two `maskValue` copies drifting** → export from tokenizer, import in side panel.
- **`async scanAndEmit`** → ensure listeners tolerate a returned promise (they do; fire-and-forget).

## 8. Out of scope (explicit follow-ups, unblocked by this work)
Network layer (`fetch` + gate re-check at true egress) → FastAPI/Ollama server (Qwen2.5-VL-3B) → Action Executor + rehydrate-on-execute (`tokenizer.rehydrateString`) → Action Safety Gate (Component 5c) → PII Layers 2 & 5 (NER + semantic medical/financial; the latter activates opaque tokens for real) → vision/OCR/face + image redaction → PIIBench-mini → DPDP report → mock-site pages 2–6.

## 9. Consolidated acceptance checklist (from PLAN.md §20.1, the slice these two features close)
- [ ] Tokenizer generates unique tokens per PII instance
- [ ] Opaque tokens work for MEDICAL/FINANCIAL categories
- [ ] Token map persists in `chrome.storage.session` across service-worker restarts
- [ ] Sanitized JSON contains ONLY tokens (manually inspect payload)
- [ ] Privacy Gate blocks request when raw PII is detected in outbound payload
- [ ] Privacy Gate allows request when payload is properly sanitized
- [ ] Side panel shows: PII list, tokenized "what server sees" preview
- [ ] Console/UI proof: zero raw PII in the outbound (sanitized) object
