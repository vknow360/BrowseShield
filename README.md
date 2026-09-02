# ShieldBrowse

> **On-Device Visual Perception for Lightweight, Privacy-Preserving Browser Agents**  
> *Developed for Smart India Hackathon (SIH) 2026 — Indian Space Research Organisation (ISRO) Problem Statement*

---

## Executive Summary

Autonomous AI agents increasingly require visual context and screen state access to automate complex workflows and assist users across web applications. However, existing commercial and open-source agents transmit unredacted screenshots to cloud-hosted Vision-Language Models (VLMs), creating severe privacy vulnerabilities and violating data sovereignty regulations.

**ShieldBrowse** is an edge-native, privacy-preserving browser agent architecture. It executes sensitive perception and Personally Identifiable Information (PII) detection entirely on the client device inside the browser. By employing a **Reversible Tokenization Scheme**, ShieldBrowse sanitizes all private data before network transmission, allowing centralized open-weights VLMs to reason over structured, anonymized context and return actionable commands that the client executes locally.

---

## Key Architectural Principles

1. **Client-Side Isolated Privacy Zone**:
   All screen reading, on-device vision inference, face detection, and PII detection execute within the user's browser runtime. Cleartext personal data never crosses the network boundary, and no model weights are fetched off-device — the extension runs fully offline.

2. **Reversible Tokenization & Dynamic Rehydration**:
   Instead of destructive blurring that renders agents non-functional, sensitive values are replaced with typed, session-scoped tokens (e.g., `[[PERSON_1]]`, `[[AADHAAR_1]]`, `[[EMAIL_1]]`). The AI server reasons over these opaque tokens; the client-side execution engine rehydrates tokens with real local values during DOM action dispatch.

3. **Hybrid DOM & Vision Perception**:
   Combines high-speed deterministic DOM extraction for native web elements with lightweight on-device computer vision (ONNX Runtime Web YOLOv8-nano via WebGPU + MediaPipe BlazeFace) for image, canvas, and face regions. A rule-based screen-state classifier derives `login`/`form`/`dashboard`/`page` from the perceived UI composition, and a compact local semantic detector (gazetteer + contextual heuristics) catches free-text names, addresses, and medical terms — no heavy transformer download required.

4. **Deterministic & Mathematical Checksum Verification**:
   Structured Indian identifiers are validated with exact mathematical algorithms, ensuring near-100% precision:
   - **Aadhaar**: Verhoeff Dihedral Group ($D_5$) Checksum Algorithm
   - **Payment Cards**: Luhn Modulo-10 Algorithm
   - **PAN & IFSC**: Official structured alphanumeric regex syntax

5. **Regulatory Alignment**:
   Designed to adhere to India's **Digital Personal Data Protection (DPDP) Act 2023** and GDPR data minimization requirements by maintaining an immutable client-side audit trail.

---

## Repository Structure

```text
SIH26/
├── extension/                  # Chrome Extension (Manifest V3)
│   ├── src/
│   │   ├── background/         # Service Worker & extension message router
│   │   ├── content/            # DOM walker & page injection orchestrator
│   │   ├── core/
│   │   │   ├── detector/       # Multi-layer PII engine (regex, checksums, DOM rules, local semantic NER)
│   │   │   ├── tokenizer/      # Reversible tokenization, session mapping & Privacy Gate
│   │   │   └── vision/         # YOLO pre/post-processing + pixel-level redactor
│   │   ├── ui/
│   │   │   ├── sidepanel/      # Real-time inspection & privacy dashboard
│   │   │   └── popup/          # Toolbar action trigger
│   │   └── utils/              # Shared timing, debounce, and messaging utilities
│   ├── manifest.config.js      # Manifest V3 configuration with WebAssembly CSP
│   └── vite.config.js          # CRXJS build system
│
├── server/                     # FastAPI server + VLM (Qwen2.5-VL via Ollama)
│   ├── app/                    # Routes, schemas, and the multimodal VLM service
│   ├── tests/                  # Endpoint, prompt-build, and image-in-payload tests
│   └── README.md               # Server setup & run instructions
│
├── benchmark/                  # PIIBench: real measurement harness for all 5 SIH metrics
│   ├── dataset/                # Labeled DOM + region fixtures (healthcare, banking, gov, login, ...)
│   └── evaluate.js             # Emits measured metrics to metrics_report.json
│
├── mock-site/                  # Benchmark Healthcare Claim Portal (Testbed)
│   ├── index.html              # Page 1: High-PII personal information intake
│   ├── demo-profiles.js        # Synthetic Indian PII profiles (Rahul Sharma, etc.)
│   ├── app.js                  # Dynamic form behaviors & live inspector
│   └── styles.css              # Enterprise healthcare portal UI
│
├── plans/                      # Architecture, PRD, and Research documentation
│   ├── PLAN.md                 # Detailed technical implementation plan
│   ├── RESEARCH.md             # Literature review, benchmarks, and threat model
│   └── PRD.md                  # Product requirement document & presentation guide
│
└── .gitignore                  # Monorepo version control rules
```

---

## Getting Started & Running Instructions

### Prerequisites
- Node.js (v18.0.0 or higher)
- npm (v9.0.0 or higher)
- Google Chrome (v114+ with Side Panel API support) **or** Mozilla Firefox (via `sidebar_action` fallback)
- Python 3.10+ and (optional) [Ollama](https://ollama.com) with a `qwen2.5-vl` model for the server VLM

> **Cross-browser:** `npm run build` produces a Chrome MV3 bundle in `extension/dist`; `npm run build:firefox` produces the Firefox target. All extension code uses the `webextension-polyfill` `browser.*` namespace, and Chrome-only `sidePanel` calls are guarded.

---

### Step 1: Start the Mock Hospital Testbed Portal

```bash
# Navigate to the mock portal directory
cd mock-site

# Install dependencies
npm install

# Start local server (runs on port 3000)
npm run dev
```
Open `http://localhost:3000` in your browser to verify the healthcare intake portal.

---

### Step 2: Build and Run the Extension

```bash
# In a new terminal, navigate to the extension directory
cd extension

# Install dependencies
npm install

# Start development mode with Hot Module Reloading (HMR)
npm run dev
```

---

### Step 3: Load the Extension in Google Chrome

1. Open Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle in the upper-right corner.
3. Click **Load unpacked** and select the `extension/dist` folder.
4. Pin **ShieldBrowse** to the browser toolbar.
5. Open `http://localhost:3000`, click the ShieldBrowse toolbar icon, and view the persistent Side Panel dashboard.

> **Firefox:** build with `npm run build:firefox`, then load `extension/dist` via `about:debugging` → *This Firefox* → *Load Temporary Add-on*. The agent opens in the sidebar (`sidebar_action`) instead of the Chrome side panel.

---

### Step 4: Start the Privacy Server (VLM backend)

```bash
# In a new terminal, from the repo root
cd server
python -m venv venv && venv\Scripts\activate      # (or source venv/bin/activate)
pip install -r requirements.txt

# Optional: pull the vision model for real inference (else a clearly-labeled mock is returned)
ollama run qwen2.5-vl:3b

# Start the API on http://localhost:8000
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

See `server/README.md` for details. Run the server tests with `pytest tests/`.
When Ollama is unreachable the server returns a mock action whose `reasoning` is prefixed `[MOCK/OLLAMA-DOWN]`, so a demo failure is never mistaken for a real inference.

---

## Benchmark

```bash
# From the repo root — reports real, measured values for all 5 SIH metrics
node benchmark/evaluate.js
```

---

## Current Progress & Implementation Status

| Milestone | Component | Scope / Deliverables | Status |
|---|---|---|---|
| **Phase 1** | **Extension Scaffold** | MV3 structure, CRXJS build, 3-way message routing (Content ➔ Worker ➔ Side Panel) | **Completed** |
| **Phase 1** | **Evaluation Testbed** | Healthcare Claim Intake Portal with 14+ PII fields and synthetic profile switcher | **Completed** |
| **Phase 1** | **DOM Walker** | TreeWalker interactive node extraction, label resolution, bounding box mapping | **Completed** |
| **Phase 2** | **PII Engine (Deterministic)** | Aadhaar (Verhoeff), PAN, Phone, Email, Credit Card (Luhn), IFSC, Pincode | **Completed** |
| **Phase 2** | **PII Engine (Heuristics)** | Input type validation, autocomplete attribute detection, keyword matching | **Completed** |
| **Phase 2** | **Live Inspector UI** | Real-time PII detection cards, type badges, and masked data streaming | **Completed** |
| **Phase 3** | **Reversible Tokenizer** | Bidirectional token-to-value mapper with `chrome.storage.local` persistence | **Completed** |
| **Phase 3** | **Payload Sanitizer** | Generation of zero-PII structured JSON for server telemetry | **Completed** |
| **Phase 4** | **Server Agent & VLM** | FastAPI endpoint calling Qwen2.5-VL via Ollama with multimodal image support | **Completed** |
| **Phase 4** | **Action Executor** | DOM event synthesis, keyboard event dispatch, and client-side rehydration | **Completed** |
| **Phase 5** | **Edge Vision Models** | WebGPU YOLOv8-nano UI grounding, MediaPipe face blur, rule-based screen-state classifier, and a lightweight local semantic PII detector (fully offline) | **Completed** |
| **Phase 5** | **Pixel Redaction & Visual Loop** | On-device face blur + password/PII blackout baked into the screenshot, then sent to the multimodal VLM | **Completed** |
| **Phase 5** | **Benchmark Suite** | PIIBench harness reporting real measured values for all 5 SIH rubric metrics | **Completed** |
| **Phase 5** | **Cross-Browser** | Chrome MV3 side panel + Firefox `sidebar_action` fallback via `webextension-polyfill` | **Completed** |

---

## Measured Results (SIH Rubric)

Produced by the real harness in `benchmark/evaluate.js` over the labeled fixtures in `benchmark/dataset/`
(run `node benchmark/evaluate.js`; latest numbers saved to `benchmark/metrics_report.json`). No figures are hardcoded.

| # | Metric (weight) | Measured | How it is measured |
|---|---|---|---|
| 1 | **Accuracy of visual context (25%)** | 100% field-region IoU (15 regions) | IoU of perceived sensitive-field regions vs labeled regions |
| 2 | **PII detection recall & precision (20%)** | Precision 1.00 / Recall 0.79 / F1 0.88 (micro) | Per-entity P/R/F1 across 6 labeled samples incl. hard negatives |
| 3 | **Redaction precision (20%)** | 83% precision / 74% coverage | Pixel-coverage IoU of redacted vs labeled sensitive regions |
| 4 | **Client resource utilization (20%)** | Shipped bundle 84.39 MB (model weights 21.21 MB, inference wasm 33.93 MB, rest JS) | On-disk size of the built `dist/` artifact |
| 5 | **End-to-end latency (15%)** | On-device detection ~0.53 ms/sample; capture/perceive/redact/network timed at runtime | Wall-clock in the harness + `background/index.js` stage timers |

> **Honesty note:** the resource footprint is dominated by the ONNX Runtime Web (WebGPU) and MediaPipe WASM runtimes required for genuine on-device inference; the model weights themselves are 12.5 MB. Metrics 1–3 are computed on a small labeled fixture set — they demonstrate the harness measures real geometry/detection, not that production accuracy is a perfect 100%. The finale evaluation set (provided by ISRO) should be dropped into `benchmark/dataset/` to reproduce these numbers on judge data.
