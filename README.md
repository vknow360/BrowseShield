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
   All screen reading, optical recognition, face detection, and PII detection execute within the user's browser runtime. Cleartext personal data never crosses the network boundary.

2. **Reversible Tokenization & Dynamic Rehydration**:
   Instead of destructive blurring that renders agents non-functional, sensitive values are replaced with typed, session-scoped tokens (e.g., `[[PERSON_1]]`, `[[AADHAAR_1]]`, `[[EMAIL_1]]`). The AI server reasons over these opaque tokens; the client-side execution engine rehydrates tokens with real local values during DOM action dispatch.

3. **Hybrid DOM & Vision Perception**:
   Combines high-speed deterministic DOM extraction for native web elements with lightweight, quantized on-device computer vision models (YOLOv8-nano, BlazeFace) for image, canvas, and unstructured visual regions.

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
│   │   │   ├── detector/       # Multi-layer PII detection engine (Regex, Checksums, DOM rules)
│   │   │   ├── tokenizer/      # Reversible tokenization & local session mapping
│   │   │   └── executor/       # DOM action execution & token rehydration
│   │   ├── ui/
│   │   │   ├── sidepanel/      # Real-time inspection & privacy dashboard
│   │   │   └── popup/          # Toolbar action trigger
│   │   └── utils/              # Shared timing, debounce, and messaging utilities
│   ├── manifest.config.js      # Manifest V3 configuration with WebAssembly CSP
│   └── vite.config.js          # CRXJS build system
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
- Google Chrome (v114+ with Side Panel API support)

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
| **Phase 3** | **Reversible Tokenizer** | Bidirectional token-to-value mapper with `chrome.storage.session` persistence | *In Progress* |
| **Phase 3** | **Payload Sanitizer** | Generation of zero-PII structured JSON for server telemetry | *Pending* |
| **Phase 4** | **Server Agent & VLM** | FastAPI / Go endpoint calling Qwen2.5-VL via Ollama | *Pending* |
| **Phase 4** | **Action Executor** | DOM event synthesis, keyboard event dispatch, and client-side rehydration | *Pending* |
| **Phase 5** | **Edge Vision Models** | WebGPU YOLOv8-nano UI grounding and MediaPipe face blur | *Grand Finale Scope* |
| **Phase 5** | **Benchmark Suite** | PIIBench-mini evaluation script reporting per-entity Precision, Recall, and F1 | *Grand Finale Scope* |

---

## Evaluation Metric Targets (SIH Rubric)

- **Accuracy of Visual Context (25%)**: Near 100% text accuracy on DOM native nodes; WebGPU-accelerated grounding for canvas/image regions.
- **PII Detection Recall & Precision (20%)**: Deterministic checksum validation guarantees >98% precision on structured Indian IDs.
- **Redaction Precision (20%)**: Reversible placeholder tokenization prevents over-redaction and retains full agent utility.
- **Client Resource Utilization (20%)**: Compact on-device model ensemble (<45 MB total footprint) optimized for consumer hardware.
- **End-to-End Latency (15%)**: Sub-150ms client-side detection and tokenization pipeline.
