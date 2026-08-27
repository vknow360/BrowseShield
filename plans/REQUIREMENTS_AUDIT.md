# ShieldBrowse — SIH 2026 Requirements Audit

> **Problem Statement:** On-device Visual Perception for Light-weight Browser Agents
> **Organisation:** Indian Space Research Organisation (ISRO) — Theme: Smart Automation
> **Audit date:** 2026-08-27
> **Scope audited:** `extension/`, `server/`, `benchmark/`, `mock-site/`, docs

---

## Short Answer

**No — the project is not yet complete.** The architecture and privacy plumbing are
genuinely strong, but the single most important required capability — *a client-side
vision model that "reads"/evaluates the screen state* — is only partially present, and
that same visual context never actually reaches the server. There are also several loose
ends (Firefox support, semantic PII, and 4 of the 5 scoring metrics have no measurement
harness). For a team that wants to win "in any condition", these are exactly the gaps a
judge will probe.

---

## Requirement Compliance Matrix

| # | Required by problem statement | Status | Evidence / Notes |
|---|---|---|---|
| 1 | **Local vision model evaluates screen state (WebGPU/WASM)** | ⚠️ **Partial / mostly missing** | Only MediaPipe BlazeFace face detection is wired and working (`extension/src/background/vision-pipeline.js:9-58`). YOLOv8-nano / MobileNet ONNX are only *initialized* — the `.onnx` model files are absent from `public/models/`, and there is **no logic that actually understands the screen**. Face detection ≠ screen-state perception. |
| 2 | **Privacy-preserving filter: face blur, password blackout, PII masking, bbox redaction** | ⚠️ **Partial** | Face redaction = black `div` overlays on the DOM (`extension/src/content/image-scanner.js:39-67`); text PII is tokenized. No confirmed password blackout, and no true image/canvas bounding-box redaction that is actually transmitted (see #4). |
| 3 | **PII detection recall/precision (structured + free text)** | ⚠️ **Partial** | Excellent structured detection: Aadhaar (Verhoeff), PAN, IFSC, Credit Card (Luhn), DOM heuristics (`extension/src/core/detector/regex.js`). **But** the semantic NER for free-text PII is a **stub** — hardcoded tensors returning empty results (`extension/src/core/detector/ner-pipeline.js:44-67`). |
| 4 | **Send anonymized *visual* context to server VLM** | ❌ **Broken round-trip** | Schema has `redactedImage` (`server/app/schemas/agent.py:10`), but `vlm_service.py` **never sends the image** to Ollama — the VLM reasons over sanitized DOM text only. The "visual perception → server" loop the statement centers on is not closed. |
| 5 | **Server VLM interprets sanitized data, returns executable actions** | ✅ **Implemented (text-only)** | FastAPI `POST /agent/action`, Qwen2.5-VL via Ollama, token-aware system prompt, structured `AgentAction` schema (`type/click/scroll/done`). Has a **mock fallback** when Ollama is down (`server/app/services/vlm_service.py:106`). |
| 6 | **Client executes returned action + token rehydration** | ✅ **Implemented** | Real DOM event synthesis + rehydration + safety gate (`extension/src/content/action-executor.js`, `extension/src/core/action-safety-gate.js`). |
| 7 | **Runs in Chrome *and* Firefox** | ❌ **Chrome-only** | `manifest.config.js` is MV3 with `side_panel` (Chrome-specific); no `browser_specific_settings`, no Firefox build. Statement explicitly lists Firefox. |
| 8 | **Privacy boundary enforcement** | ✅ **Strong** | Privacy Gate in the service worker blocks any outbound payload containing raw token-map values (`extension/src/core/tokenizer/privacy-gate.js`, `extension/src/background/index.js:100`). This is the project's best feature. |
| 9 | **End-to-end demonstrable task** | ⚠️ **Fragile** | Pieces exist, but with the image not sent (#4) and NER stubbed (#3), the "visual" end-to-end story is incomplete. |

---

## The Scoring Metrics — Biggest Risk

The rubric has 5 weighted metrics; the benchmark (`benchmark/evaluate.js`, only **2 sample
files**) measures **only one of them** (PII precision/recall):

| Metric (weight) | Measured today? |
|---|---|
| Accuracy of visual context — **25%** | ❌ No harness; and vision doesn't reach server anyway |
| PII detection recall/precision — **20%** | ✅ Partially (2 samples, structured only) |
| Redaction precision — **20%** | ❌ No harness |
| Client resource utilization — **20%** | ❌ Not measured (README's <45MB is a target) |
| End-to-end latency — **15%** | ❌ Not measured |

So **80% of the score weight has no supporting measurement**, and the top-weighted metric
(visual context, 25%) targets the weakest part of the implementation.

---

## Concrete Loose Ends to Close (priority order)

1. **Close the visual loop (highest impact, 25% metric):** actually pass `redactedImage`
   into the Ollama VLM call and have a real on-device model produce screen-state
   understanding (WebGPU/ONNX YOLO or a ViT). Right now it's DOM-only text — a judge can
   argue "this isn't a vision agent."
2. **Ship the missing vision model files + inference logic** (`extension/public/models/*.onnx`)
   or replace with a working Transformers.js/ONNX-Web model.
3. **Implement real semantic NER** (Transformers.js + WordPiece) — the current one returns
   empty results, hurting the 20% PII recall metric on free text.
4. **Add Firefox support** (`browser_specific_settings` + sidebar fallback /
   webextension-polyfill) — it's explicitly required.
5. **Build measurement harnesses** for redaction precision, client resource footprint, and
   end-to-end latency; expand the dataset well beyond 2 samples.
6. **Verify redaction breadth:** password blackout and true image-region (bbox) redaction on
   the transmitted payload.
7. **Server hygiene:** run docs, tests, and make the mock fallback obviously distinguishable
   from a real inference so a demo failure isn't mistaken for success.
8. **Sync the README status table** — it lists Server/Executor as "Pending" though they're
   built; misleading to judges/reviewers.

---

## What Is Genuinely Strong (keep and highlight)

- **Reversible tokenizer** — bidirectional value↔token mapping with session persistence
  (`extension/src/core/tokenizer/tokenizer.js:6-115`).
- **Privacy Gate** — final firewall in the service worker that stringifies every outbound
  request and blocks it if any raw token-map value is present
  (`extension/src/background/index.js:100`).
- **Deterministic structured PII** — Aadhaar Verhoeff, Luhn, PAN, IFSC with correct math
  (`extension/src/core/detector/regex.js`).
- **Action executor** — native-setter DOM synthesis that bypasses React controlled inputs,
  plus a whitelist + dangerous-pattern safety gate
  (`extension/src/content/action-executor.js`, `extension/src/core/action-safety-gate.js`).
- **Server** — clean FastAPI service with a token-aware system prompt and strict Pydantic
  action schema (`server/app/api/agent_router.py`, `server/app/schemas/agent.py`).

---

## Bottom Line

You have a well-engineered *privacy/tokenization* backbone (tokenizer, Privacy Gate, action
executor, structured PII) that many teams won't match. But as a *vision* agent it currently
under-delivers on the statement's core ask: on-device screen perception that feeds the
server. Fixing items **#1–#4** above is essential before you can credibly claim the
requirements are met.
