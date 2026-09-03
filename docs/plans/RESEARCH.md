# ShieldBrowse — Research Document
### SIH 2026 | ISRO — On-Device Visual Perception for Lightweight Browser Agents

---

## Table of Contents
1. [Problem Statement Analysis](#1-problem-statement-analysis)
2. [Key Concepts Explained](#2-key-concepts-explained)
3. [Existing Solutions & Landscape](#3-existing-solutions--landscape)
4. [Academic References & Papers](#4-academic-references--papers)
5. [Rubric Analysis & Winning Strategy](#5-rubric-analysis--winning-strategy)
6. [Technology Landscape](#6-technology-landscape)
7. [Key Risks & Open Questions](#7-key-risks--open-questions)

---

## 1. Problem Statement Analysis

### 1.1 What ISRO is Asking For

ISRO wants a **browser extension** that:

1. **Sees the user's screen** using a local (on-device) AI vision model running inside the browser
2. **Detects and redacts sensitive/personal data** (PII — Personally Identifiable Information) before sending anything to a server
3. **Sends only the sanitized (cleaned) version** of the screen context to a server
4. **The server processes the sanitized data** using an LLM/VLM and returns instructions (like "click this button" or "type this text")
5. **The browser extension executes those instructions** on the user's behalf

### 1.2 Breaking Down the PS Into Requirements

| PS Requirement | What It Means Technically |
|---|---|
| "Local Vision Transformer (ViT) or equivalent CV model reads the user's screen" | Run a computer vision model **inside the browser** using WebGPU/WASM — NOT on a server |
| "Sanitize sensitive/PII data using DOM tags or any other method" | Before sending data to the server, find and remove/mask personal information |
| "Dynamically detect and redact sensitive elements" | Real-time detection: blur faces, black out passwords, mask PII like Aadhaar/PAN numbers |
| "Only anonymized, unidentifiable data should be transmitted" | The server must NEVER receive real personal data — only cleaned/tokenized versions |
| "Server processes sanitized context and returns actionable commands" | Server-side LLM/VLM looks at the cleaned data and decides what the browser agent should do next |
| "Participants must balance trade-offs between inference latency and accuracy" | Models must be small/fast enough to run in-browser without making the user wait too long |
| "Running in popular browsers (Chrome, Firefox)" | Must work as a Chrome extension (MV3), ideally Firefox too |
| "Any offline deployable (open-source/open-weights) model on server" | Server must use open-source models (Llama, Qwen, etc.), not proprietary APIs (though cloud versions allowed during SIH) |

### 1.3 What "Privacy-Preserving" Actually Means Here

The core innovation ISRO wants is a **split architecture**:

```
BROWSER (private zone)                    SERVER (untrusted zone)
┌──────────────────────┐                  ┌──────────────────────┐
│ • Has access to real  │   sanitized     │ • Never sees real     │
│   screen content      │   data only     │   user data           │
│ • Runs AI models      │ ──────────────▶ │ • Processes only      │
│   locally             │                 │   cleaned/tokenized   │
│ • Detects & removes   │   action        │   information         │
│   all PII before      │   commands      │ • Returns instructions│
│   sending anything    │ ◀────────────── │   like "click button" │
└──────────────────────┘                  └──────────────────────┘
```

**Why this matters**: Current AI agents (like ChatGPT, Gemini, etc.) require you to share your screen/data with their servers. ISRO wants a system where the AI can help you with tasks on your screen **without ever seeing your actual personal data**.

### 1.4 The ISRO Context

This is from ISRO / Department of Space. Why would a space agency care about browser agents?

- ISRO handles **classified and sensitive data** (satellite imagery, launch parameters, personnel records)
- Government organizations need **data sovereignty** — data must not leave controlled environments
- India's **Digital Personal Data Protection (DPDP) Act 2023** mandates strict data handling
- A privacy-preserving browser agent could be used by ISRO employees to automate workflows on internal portals without leaking data to cloud AI services

This context matters for the pitch — frame ShieldBrowse as relevant to **government/defense** use cases.

---

## 2. Key Concepts Explained

### 2.1 What is a Vision Transformer (ViT)?

A **Vision Transformer** is a type of AI model that "looks at" images and understands what's in them. Originally, AI used CNNs (Convolutional Neural Networks) for images, but in 2020, Google showed that Transformers (the same architecture behind ChatGPT) work even better for images.

**How it works (simplified)**:
1. Take an image (e.g., a screenshot of a web page)
2. Cut it into small patches (like tiles, usually 16×16 pixels)
3. Feed each patch into a Transformer model (similar to how words are fed into a text AI)
4. The model outputs: what objects are in the image, where they are (bounding boxes), or a classification of the overall image

**For our project**: We'll use a tiny ViT model (YOLOv8-nano, ~45MB) that runs inside the browser to detect UI elements (buttons, text fields, images) in screenshots. This is the "reads the user's screen" part the PS requires.

### 2.2 What is ONNX Runtime Web?

**ONNX** (Open Neural Network Exchange) is a universal format for AI models. Think of it like PDF for documents — any AI framework (PyTorch, TensorFlow) can export a model to ONNX format, and ONNX Runtime can run it anywhere.

**ONNX Runtime Web** runs ONNX models **inside the browser** using:
- **WebGPU**: Uses the computer's GPU (graphics card) for fast inference — 5-10x faster
- **WASM (WebAssembly)**: Uses the CPU as a fallback if WebGPU isn't available — slower but works everywhere

**For our project**: All our client-side AI models (ViT, NER) will be converted to ONNX format and run via ONNX Runtime Web inside the Chrome extension.

### 2.3 What is Transformers.js?

**Transformers.js** is a JavaScript library (by Hugging Face) that lets you run AI models directly in the browser. It's essentially the browser version of the popular Python `transformers` library.

**Key features**:
- Loads ONNX models and runs them using WebGPU or WASM
- Supports hundreds of pre-trained models (text classification, NER, image classification, object detection, etc.)
- Handles model downloading, caching, tokenization, and inference — you just call a function

**Example usage** (this is literally how simple it is):
```javascript
import { pipeline } from '@xenova/transformers';

// Load a Named Entity Recognition model
const ner = await pipeline('ner', 'Xenova/bert-base-NER', { device: 'webgpu' });

// Run inference on text
const results = await ner('My name is Rahul Sharma and I live in Delhi');
// → [{ entity: 'PER', word: 'Rahul Sharma', score: 0.98 }, { entity: 'LOC', word: 'Delhi', score: 0.95 }]
```

### 2.4 What is Named Entity Recognition (NER)?

**NER** is an NLP (Natural Language Processing) task where an AI model reads text and identifies "named entities" — real-world things like:

| Entity Type | Examples |
|---|---|
| PERSON (PER) | "Rahul Sharma", "Priya Patel" |
| LOCATION (LOC) | "Mumbai", "MG Road, Bengaluru" |
| ORGANIZATION (ORG) | "ISRO", "State Bank of India" |
| DATE | "15th August 2026" |
| MONEY | "₹50,000" |
| MISC | Everything else that's a named entity |

**For our project**: We use NER to catch PII that regex can't — like person names, addresses, and organization names. Regex can catch structured patterns (Aadhaar: 12 digits), but "Rahul Sharma" requires understanding language.

### 2.5 What is WebGPU?

**WebGPU** is a new browser API (available in Chrome 113+, 2023) that gives JavaScript direct access to the computer's GPU (graphics card). Before WebGPU, browsers could only use the GPU for rendering graphics (WebGL). WebGPU lets you run **general computations** on the GPU — including AI model inference.

**Why it matters for us**: Running AI models on the GPU is 5-10x faster than CPU. Our ViT and NER models will use WebGPU when available, with WASM (CPU) as a fallback.

### 2.6 What is a VLM (Vision-Language Model)?

A **VLM** is an AI model that can understand both images and text simultaneously. Examples: GPT-4o, Gemini, Qwen-VL, LLaVA.

**For our project**: The server-side model is Qwen2.5-VL-3B — a Vision-Language Model that can:
- Look at a sanitized screenshot (with PII blurred out) and understand the page layout
- Read the structured JSON description of the page
- Reason about what action to take next ("click the submit button", "type [[EMAIL_1]] into the email field")

### 2.7 What is Ollama?

**Ollama** is a tool that lets you run open-source LLMs/VLMs locally on your computer. Think of it as "Docker for AI models" — you just run `ollama run qwen2.5-vl:3b` and you have a local AI API endpoint.

**For our project**: We'll run Qwen2.5-VL-3B via Ollama on the server (AWS EC2 with GPU). This satisfies the PS requirement of "offline deployable open-source model."

### 2.8 What is a Chrome Extension (Manifest V3)?

A Chrome Extension is a small program that runs inside Google Chrome to add functionality. **Manifest V3 (MV3)** is the current extension format (required since 2024).

**MV3 has three main parts**:

| Part | File(s) | What It Does | Runs When |
|---|---|---|---|
| **Content Script** | `content.js` | Injected INTO the web page. Can read/modify the page's DOM. Can see everything on the page. | Whenever a matching page loads |
| **Service Worker** | `background.js` | Runs in the background. Handles events, network requests, extension logic. **Has NO access to web pages directly.** | On events (messages, alarms, etc.) |
| **Popup / Side Panel** | `popup.html`, `sidepanel.html` | The UI that appears when you click the extension icon or open the side panel. | When user interacts with extension |
| **Manifest** | `manifest.json` | Configuration file: permissions, scripts, icons, etc. | — |

**Critical MV3 gotcha**: The service worker **can be killed by Chrome after ~30 seconds of inactivity**. Any data stored only in the service worker's memory (JavaScript variables) will be lost. This is why we use `chrome.storage.session` for the token map — it persists across service worker restarts.

### 2.9 What is PII (Personally Identifiable Information)?

**PII** is any data that can identify a specific person. In the Indian context:

| PII Type | Format/Pattern | Detection Method |
|---|---|---|
| **Aadhaar Number** | 12 digits (XXXX XXXX XXXX), passes Verhoeff checksum | Regex + Verhoeff checksum validation |
| **PAN Card** | ABCDE1234F (5 letters, 4 digits, 1 letter) | Regex pattern |
| **Phone Number** | +91XXXXXXXXXX or 0XXXXXXXXXX (10 digits) | Regex |
| **Email** | user@domain.com | Regex |
| **Credit Card** | 16 digits, passes Luhn checksum | Regex + Luhn validation |
| **IFSC Code** | ABCD0XXXXXX (4 letters, 0, 6 alphanumeric) | Regex |
| **Passport** | A1234567 (letter + 7 digits) | Regex |
| **Person Name** | "Rahul Sharma" | NER model |
| **Address** | "12/3 MG Road, Bengaluru 560001" | NER model |
| **Face** | Photo with a human face | MediaPipe Face Detector |
| **Medical Data** | "Diagnosed with diabetes", "Prescribed metformin" | Keyword list + field context |

---

## 3. Existing Solutions & Landscape

### 3.1 Browser Agent Landscape (What Exists Today)

| Project | What It Does | Privacy? | Runs Locally? |
|---|---|---|---|
| **[browser-use](https://github.com/browser-use/browser-use)** | Python library that controls a browser via an LLM. Takes screenshots, uses GPT-4o/Claude to decide actions. | ❌ No — sends full screenshots to cloud APIs | ❌ No — requires cloud LLM |
| **[WebVoyager](https://arxiv.org/abs/2401.13919)** (2024) | Research agent: navigates websites using GPT-4V. Screenshot-based, end-to-end. | ❌ No — sends screenshots to GPT-4V | ❌ No |
| **[SeeAct](https://arxiv.org/abs/2401.01614)** (2024) | Generalist web agent using GPT-4V. Uses screenshots + HTML to decide actions. | ❌ No — shares full page context with cloud | ❌ No |
| **[ShowUI](https://arxiv.org/abs/2411.17465)** (2024) | Lightweight (2B params) vision-language model for UI grounding. Can identify which UI element to click given an instruction. | ❌ No redaction | ✅ Potentially (2B model, needs GPU) |
| **[UI-TARS](https://arxiv.org/abs/2501.12326)** (2025) | Native GUI agent model. Perception → reasoning → grounding → action loop. | ❌ No redaction | ✅ Potentially (various sizes) |
| **[OS-ATLAS](https://arxiv.org/abs/2410.23218)** (2024) | Foundation GUI grounding model trained on diverse OS interfaces. | ❌ No redaction | ✅ Potentially |
| **[Anthropic Computer Use](https://www.anthropic.com/news/3-5-sonnet-computer-use)** (2024) | Claude can control a desktop computer via screenshots. | ❌ Full screenshots sent to Anthropic | ❌ Cloud-only |

### 3.2 PII Detection Tools

| Tool | What It Does | Runs in Browser? |
|---|---|---|
| **[Microsoft Presidio](https://github.com/microsoft/presidio)** | Open-source PII detection & anonymization framework. Regex + NLP. Python-based. | ❌ Python only — but we can port the regex patterns to JS |
| **[spaCy NER](https://spacy.io/)** | NLP library with built-in NER. Python. | ❌ Python only |
| **[Google DLP API](https://cloud.google.com/dlp)** | Cloud-based PII detection. Very accurate. | ❌ Cloud API — defeats our privacy purpose |
| **[Tesseract.js](https://tesseract.projectnaptha.com/)** | OCR engine running in browser via WASM | ✅ Yes |
| **[MediaPipe Face Detection](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector)** | On-device face detection, runs in browser | ✅ Yes |

### 3.3 Gap Analysis — Why ShieldBrowse is Different

**No existing browser agent combines these three things:**
1. ✅ Runs perception/PII detection **locally in the browser** (not on a server)
2. ✅ Has a **reversible token scheme** (so the agent can still reference PII values without knowing them)
3. ✅ Provides **benchmarked, measurable privacy guarantees** (precision/recall numbers, not just "trust us")

```
                    Privacy-Preserving?
                    │
                    │  ShieldBrowse ★
                    │  (local PII detection,
                    │   reversible tokens,
                    │   benchmarked)
                    │
                    │
         Presidio  │
         (server-  │                     browser-use, SeeAct,
          side)    │                     WebVoyager, Anthropic
                   │                     (no privacy at all)
                   │
                   └──────────────────────────────────────
                        Lightweight/           Heavy/
                        On-device              Cloud-dependent
```

**Our unique contribution**: We are the first system to combine a **multi-layer client-side PII detector** with a **reversible token scheme** that keeps the agent functional while provably never exposing real PII to the network.

---

## 4. Academic References & Papers

### 4.1 Papers to Cite in Slides/Report

| Paper | Year | Relevance | Key Takeaway |
|---|---|---|---|
| **[An Image is Worth 16x16 Words (ViT)](https://arxiv.org/abs/2010.11929)** | 2020 | Foundational ViT paper | Vision Transformers work by splitting images into patches — this is the architecture our client-side model is based on |
| **[ShowUI: One Vision-Language-Action Model for GUI Visual Agent](https://arxiv.org/abs/2411.17465)** | 2024 | Action schema design | Their action JSON schema is well-designed — we reference it for our action format |
| **[UI-TARS: Pioneering Automated GUI Interaction with Native Agents](https://arxiv.org/abs/2501.12326)** | 2025 | Agent loop design | Perception → reasoning → grounding → action loop — same pattern we use |
| **[SeeAct: GPT-4V(ision) is a Generalist Web Agent](https://arxiv.org/abs/2401.01614)** | 2024 | Web agent architecture | Screenshot + HTML dual-input approach — validates our hybrid DOM+vision design |
| **[WebVoyager: Building an End-to-End Web Agent with LMMs](https://arxiv.org/abs/2401.13919)** | 2024 | Benchmark methodology | Their evaluation framework influenced our benchmark design |
| **[OS-ATLAS: Foundation Action Model for GUI Agents](https://arxiv.org/abs/2410.23218)** | 2024 | GUI grounding | Cross-platform UI element detection — validates using object detection for UI grounding |
| **[ScreenAI: Visual Language Model for UI and Infographics](https://arxiv.org/abs/2402.04615)** | 2024 | Screen understanding | Google's screen understanding model — validates our screen state classification approach |
| **[Qwen2-VL](https://arxiv.org/abs/2409.12191)** | 2024 | Server-side VLM | The model family we use on the server — efficient, open-source, vision-capable |

### 4.2 Key Insight from the Literature

Every existing browser agent (SeeAct, WebVoyager, browser-use) sends **full, unredacted screenshots** to a cloud AI model. **None of them address privacy.** This is our opening:

> *"We stand on the shoulders of SeeAct, WebVoyager, and ShowUI for agent architecture, but we solve a problem none of them address: what happens when the screen contains sensitive data the user doesn't want to share with a cloud AI?"*

---

## 5. Rubric Analysis & Winning Strategy

### 5.1 Rubric Breakdown

| Criterion | Weight | What Judges Will Look For |
|---|---|---|
| **Accuracy of visual context from screen** | 25% | Can the system correctly "read" what's on the screen? Does it identify UI elements, text, images accurately? |
| **Recall and precision for detection of sensitive/PII data** | 20% | Of all PII on the screen, how much did it find (recall)? Of everything it flagged as PII, how much was actually PII (precision)? |
| **Precision of redaction** | 20% | Was the redaction applied correctly? Did it redact only what needed to be redacted without breaking the page context? |
| **Client-side resource utilization** | 20% | How much memory/CPU/GPU does the client-side component use? Smaller models = better score. |
| **Overall end-to-end latency** | 15% | How fast is the complete pipeline: capture → detect → redact → send → receive → execute? |

### 5.2 The Critical Insight

**65% of the score is about the privacy pipeline (PII detection + redaction), not the agent's cleverness.**

Most competing teams will build an impressive "AI clicks buttons for you" demo and treat redaction as a single blur filter. They'll spend 80% of their time on the agent and 20% on privacy.

**We flip this: spend 60% on the privacy pipeline, 40% on the agent.** The agent just needs to work. The privacy pipeline needs to be **benchmarked, multi-layered, and defensible**.

### 5.3 How We Win Each Criterion

| Criterion | Our Strategy | Why We Beat Others |
|---|---|---|
| **Accuracy (25%)** | Hybrid DOM+Vision: DOM gives ~100% accuracy for text/form fields (no OCR error). ViT only for image regions. Report both separately. | Others use pure screenshot → OCR → errors compound. Our DOM path is near-perfect. |
| **PII Recall/Precision (20%)** | Multi-layer detector: regex (structured PII) + NER (names/addresses) + DOM heuristics (safety net) + MediaPipe (faces). Report per-entity-type metrics. | Others use a single regex or a generic filter. Our multi-layer approach catches more and we have numbers to prove it. |
| **Redaction Precision (20%)** | Reversible token scheme: precise text replacement (not blurry overlays). Hard-negative tests to prove we don't over-redact. | Others over-redact (destroy context) or under-redact (leak PII). We have a benchmark showing neither. |
| **Resource Use (20%)** | Total client-side models: ~75-80MB. No LLM runs client-side. Only tiny specialized models (YOLOv8-nano 45MB, MobileNet 3MB, NER 29MB, Tesseract, MediaPipe). | Others might try to run a VLM in the browser (200MB+). We keep it lightweight by design. |
| **Latency (15%)** | DOM extraction is instant (~5ms). Regex is instant. NER is fast (~50-200ms). Only image regions need heavy vision processing. Stacked bar chart showing time per stage. | Others process entire screenshots through a ViT every cycle. We skip vision for most content. |

### 5.4 The Benchmark Advantage

**Most teams will have ZERO quantitative metrics.** They'll say "watch, it works" during the demo.

We will have:
- A **per-entity-type precision/recall/F1 table** (Aadhaar: 100%, PAN: 98%, Names: 82%, etc.)
- A **confusion matrix** showing false positives and false negatives
- A **resource utilization chart** (model sizes, peak memory, GPU vs WASM inference time)
- An **end-to-end latency stacked bar chart** (capture: 5ms, PII detect: 100ms, server: 500ms, etc.)

This is the difference between "trust us" and "here's the data." Judges strongly prefer the latter.

---

## 6. Technology Landscape

### 6.1 Browser ML Runtime Options (2026)

| Runtime | How It Works | Speed | Browser Support | Our Usage |
|---|---|---|---|---|
| **ONNX Runtime Web** | Runs ONNX models via WebGPU/WASM | Fastest | Chrome 113+, Firefox, Edge | Primary runtime (via Transformers.js) |
| **TensorFlow.js** | Runs TF models via WebGL/WASM | Medium | All browsers | Not used (ONNX Runtime is faster in 2026) |
| **WebGPU** | Direct GPU compute API | Fastest possible | Chrome 113+, Firefox (behind flag) | Used by ONNX Runtime Web when available |
| **WASM (WebAssembly)** | Compiled code running at near-native speed on CPU | Slower than GPU | All browsers | Fallback when WebGPU unavailable |
| **MediaPipe Tasks** | Google's pre-built vision tasks (face detection, etc.) | Fast (optimized) | Chrome, Firefox | Used for face detection specifically |

### 6.2 Server-Side Model Options

| Model | Parameters | VRAM Needed | Speed | Capabilities |
|---|---|---|---|---|
| **Qwen2.5-VL-3B** ✅ Our choice | 3B | ~4-6 GB | Fast | Vision + Language, good at structured reasoning |
| Qwen2.5-VL-7B | 7B | ~8-10 GB | Medium | Better reasoning, needs more GPU |
| Moondream2 | 1.8B | ~2-3 GB | Very fast | Vision + Language, less capable |
| Llama-3.1-8B-Instruct | 8B | ~8 GB | Medium | Text only (no vision), very capable reasoning |
| Phi-3-mini | 3.8B | ~4 GB | Fast | Text only, good reasoning for size |

### 6.3 Client-Side Model Sizes (Our Stack)

| Model | Purpose | Format | Size | Inference Time |
|---|---|---|---|---|
| YOLOv8-nano | UI element detection | ONNX | ~45 MB | ~50-100ms (WebGPU), ~200-500ms (WASM) |
| MobileNet-v3-small | Screen state classification | ONNX (q8) | ~3 MB | ~20-50ms |
| distilbert-NER (fine-tuned) | Named entity recognition | ONNX (q8) | ~29 MB | ~50-200ms |
| Tesseract.js core | OCR engine | WASM | ~2 MB + lang data | ~500ms-2s per image region |
| MediaPipe Face Detector | Face bounding boxes | WASM/WebGPU | ~5 MB | ~30-100ms |
| **TOTAL** | | | **~75-80 MB** | |

---

## 7. Key Risks & Open Questions

### 7.1 Technical Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **WebGPU not available on judge's machine** | Client-side models run on CPU (slower) | Transformers.js auto-falls-back to WASM. Test both paths. |
| **NER model misses a PII entity** | Real PII leaks to server | DOM attribute heuristic layer as safety net (type=password, autocomplete=email → always redact) |
| **Over-redaction breaks agent usability** | Agent can't complete tasks because too much is tokenized | Hard-negative test cases in benchmark. Context-aware redaction (don't redact button labels, static text). |
| **MV3 service worker lifecycle** | Token map lost if SW restarts | Use chrome.storage.session (persists across SW restarts) |
| **Ollama too slow on CPU** | Server response takes 30-60s | AWS EC2 with GPU as primary. Laptop Ollama as offline proof only. |
| **Cross-origin iframes** | Can't access iframe content, PII in iframes goes undetected | Acknowledge as limitation. DOM walker skips cross-origin iframes (browser security prevents access anyway). |

### 7.2 Strategic Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Other teams also build hybrid DOM+vision** | Less differentiation | Our reversible token scheme + benchmark dataset are still unique |
| **Judges expect pure vision (ViT as primary)** | Marked down for not matching PS letter | Frame ViT as a "verification + augmentation layer" that runs on every page. Show it running. |
| **Demo breaks live** | Loss of demo score | Demo mode flag with cached responses + backup video recording |
| **Venue WiFi issues** | Can't reach AWS server | Local Ollama on laptop as fallback + demo mode |

### 7.3 Questions to Resolve During Implementation

1. **NER model selection**: Which exact Hugging Face checkpoint to fine-tune? Need to test 2-3 candidates.
2. **Synthetic data quality**: Will LLM-generated Indian PII data produce a good-enough NER model?
3. **YOLOv8-nano training data**: Do we need to fine-tune YOLO on UI elements, or does a pre-trained web UI detection model exist?
4. **Prompt engineering depth**: How much few-shot prompting does Qwen2.5-VL-3B need to reliably output valid action JSON?
5. **Hindi NER performance**: Does distilbert-multilingual handle Hindi names in English transliteration well enough?