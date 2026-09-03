# ShieldBrowse — Product Requirement Document (PRD)
### For the Presentation & PPT Team
#### SIH 2026 | ISRO — On-Device Visual Perception for Lightweight Browser Agents

---

> **⚠️ IMPORTANT:** This PRD is aligned with the updated PLAN.md architecture. Key changes from previous versions:
> - **Do NOT use fabricated benchmark numbers** (no "98% Aadhaar accuracy" — use real measured results only)
> - **Do NOT claim** "We are the only system..." — say "Our architecture combines..."
> - The core narrative is now **"enforceable privacy boundary"**, not just "privacy-preserving browser agent"
> - Two new enforcement layers: **Privacy Gate** (blocks unsanitized data) and **Action Safety Gate** (validates VLM actions)

---

## 📖 Table of Contents
0. [How We Talk About Results (Claims Policy)](#0-how-we-talk-about-results-claims-policy--read-first)
1. [What's the Problem?](#1-whats-the-problem)
2. [What's Our Solution?](#2-whats-our-solution)
   - [2.1 Goals and Non-Goals](#21-goals-and-non-goals)
   - [2.2 Primary Use Cases](#22-primary-use-cases)
3. [How Does It Work? (Simple Explanation)](#3-how-does-it-work-simple-explanation)
4. [The "Wow Factor" — What Makes Us Special](#4-the-wow-factor--what-makes-us-special)
5. [Key Demo Moments to Highlight](#5-key-demo-moments-to-highlight)
6. [How Judges Will Score Us](#6-how-judges-will-score-us)
7. [Presentation Script & Slide Structure](#7-presentation-script--slide-structure)
8. [The Story / Narrative Arc](#8-the-story--narrative-arc)
9. [Competitive Landscape — How We're Different](#9-competitive-landscape--how-were-different)
10. [Judge Q&A — Questions They'll Ask](#10-judge-qa--questions-theyll-ask)
11. [Glossary — Technical Terms Simplified](#11-glossary--technical-terms-simplified)
12. [Visual Assets & Diagrams Needed](#12-visual-assets--diagrams-needed)

---

## 0. How We Talk About Results (Claims Policy — Read First)

Judges reward honesty and punish unverifiable claims. Every statement in the PPT and demo must fall into one of four buckets, and we should say which one we mean:

| Word | Meaning | Example |
|---|---|---|
| **Measured** | Backed by an actual test run with numbers we can reproduce | "Measured PII recall on PIIBench-mini: 79%" |
| **Implemented** | Working in the current build (you can see it in the demo) | "Privacy Gate is implemented and blocks the leak live" |
| **Designed** | Specified and architected, but not yet validated end-to-end | "Opaque tokenization is designed for medical/financial fields" |
| **Planned** | Future work, not built yet | "Firefox port is planned" |

**Hard rules:**
- **No fabricated numbers.** If a benchmark hasn't run, say "Benchmark under execution" — never invent accuracy, latency, or memory figures.
- Model sizes (~40 MB) and latencies are **engineering targets** until we measure the built extension. Label them as such.
- **Never claim**: "100% secure", "zero leakage guaranteed", "perfect PII detection", or "DPDP compliant / guaranteed compliance". These are indefensible.
- The privacy objective is to prevent *known* raw sensitive values from being sent to the server, demonstrated on our tests — not a mathematical guarantee against every unknown case.

### Honest Limitations (say these before a judge finds them)

Owning limitations is a credibility win, not a weakness:
- PII detection is not perfect; **false negatives exist and we report them** per category.
- Token *labels* (e.g., `[[MEDICAL_1]]`) can leak the category — that's exactly why opaque `[[VALUE_N]]` mode exists.
- Cross-origin iframes may be inaccessible due to browser security.
- OCR can fail on poor-quality images.
- WASM can be slower than WebGPU where GPU is unavailable.
- The architecture still uses **server-side reasoning** — the claim is that raw sensitive context stays local, not that everything runs offline.
- Browser/platform side channels are outside the MVP security boundary.

---

## 1. What's the Problem?

### The Big Picture

**AI assistants** (like ChatGPT, Gemini, Claude) are getting really good at helping people with tasks on their computers. Imagine an AI that could:
- Fill out long government forms for you
- Navigate complex websites step-by-step
- Help elderly people use digital services

**The problem?** To do this, these AI assistants need to **see your screen**. And to see your screen, they need you to **share a screenshot with their servers**.

### Why That's Dangerous

Your screen often shows **extremely sensitive personal information**:
- Your **Aadhaar number** (like a social security number)
- Your **bank account details**
- Your **medical records** ("Patient diagnosed with diabetes")
- Your **face** (in photos on the page)
- **Passwords** you're typing

When you share a screenshot with a cloud AI service, all of this data goes to **someone else's server** — possibly in another country. You have no control over who sees it, how long it's stored, or whether it gets leaked.

**This is especially critical for:**
- **Government employees** (ISRO scientists, defense personnel) handling classified data
- **Healthcare workers** accessing patient records
- **Banking staff** viewing customer financial data
- **Any Indian citizen** whose data is protected under the **DPDP Act 2023** (India's data protection law)

### The Core Tension

> 🤖 AI needs to see your screen to help you
>    vs.
> 🔒 Sharing your screen means sharing your personal data
>
> How do we give AI the ability to help WITHOUT giving it access to our private data?

**That's exactly what ISRO asked us to solve.**

---

## 2. What's Our Solution?

### ShieldBrowse — In One Sentence

> **ShieldBrowse is a browser extension that enforces a privacy boundary between your browser and the AI server — the AI can reason over your browser context without receiving your sensitive values.**

### The Key Insight

Instead of sending your **real** personal data to the AI server, we:
1. **Detect** every piece of personal information on the screen (names, Aadhaar numbers, faces, medical data...)
2. **Replace** each piece with a **code name** (like replacing "Rahul Sharma" with "[[PERSON_1]]")
3. **Send only the code names** to the AI server
4. The AI server works with the code names ("type [[PERSON_1]] into the name field")
5. **Our browser extension** replaces the code name back with the real value ("Rahul Sharma") and types it in — **locally**, without ever sending it over the internet

### A Simple Analogy

Think of it like a **spy movie**:

> You're a spy. You need a translator (the AI server) to help you fill out a form in another language. But the form contains **top secret information** (your real name, location, mission details).
>
> So you do this:
> 1. You **redact** all the secret parts with code names: "Agent Alpha" instead of your real name, "Location Bravo" instead of your real address
> 2. You **give the redacted form** to the translator
> 3. The translator says: "Write 'Agent Alpha' in the first box, 'Location Bravo' in the third box"
> 4. You then **swap back** the code names for real values and fill out the form yourself
>
> The translator never knew your real name or location. But they still helped you fill out the form correctly.
>
> **That's exactly what ShieldBrowse does.** The "translator" is our AI server. The "code names" are our tokens ([[PERSON_1]], [[EMAIL_1]]). And the "swap back" happens automatically in your browser.

### 2.1 Goals and Non-Goals

**✅ Goals (What we MUST do):**
- **Understand visual context locally**: Read the DOM and visual layout without server help.
- **Detect and redact PII locally**: Ensure no raw sensitive values are passed to the network layer.
- **Generate enforceable boundaries**: Physically block requests containing raw PII via the Privacy Gate.
- **Execute secure browser actions**: Translate server reasoning into safe, robust DOM updates.

**❌ Non-Goals (What we are NOT trying to do):**
- **Not a full OS-level agent**: We operate within the browser sandbox, not controlling desktop applications.
- **Not aiming for 100% zero-shot web automation**: We do not claim perfect navigation on every website on the internet. The focus is proving the *privacy boundary*, not general artificial intelligence.
- **Not running a 3B+ LLM locally**: We are not trying to cram heavy reasoning models into the browser (which ruins latency). We separate lightweight local perception from remote heavy reasoning.

### 2.2 Primary Use Cases

Our mock-site and real-world testing focus on these specific scenarios:

#### Use Case A: Healthcare Form Assistance
The agent helps users navigate complex medical portals (like insurance claims). 
- **It sees**: The form structure, medical labels, layout, and instructions.
- **It redacts**: Patient IDs, specific medical conditions, and contact info. 
- **The Result**: The server reasons about a generic "medical form" without knowing the patient's identity.

#### Use Case B: Banking Dashboard
The agent manages financial layouts.
- **It sees**: The dashboard layout, navigation buttons, and generic UI structure.
- **It redacts**: Account balances, account numbers, and credit card details (using Opaque tokens like `[[VALUE_1]]` so even the *type* of data isn't leaked).
- **The Result**: The AI can guide the user to the "transfer funds" page without knowing how much money they have.

#### Use Case C: Adversarial Validation
A test mode specifically built to prove our gates work.
- **The Setup**: We deliberately force the agent to try to inject malicious code or leak PII.
- **The Result**: The Privacy Gate physically blocks egress, and the Action Safety Gate rejects the malicious instructions, proving our fail-closed architecture.

---

## 3. How Does It Work? (Simple Explanation)

### Step-by-Step Flow

> 🖥️ STEP 1: You open a web page (e.g., a hospital insurance claim form)
>      ↓
> 🔍 STEP 2: ShieldBrowse READS the page
>      • Looks at every text field, button, and image
>      • Understands what's on the screen
>      ↓
> 🚨 STEP 3: ShieldBrowse DETECTS personal data
>      • Finds names, Aadhaar numbers, phone numbers, emails
>      • Spots faces in uploaded photos
>      • Identifies medical terms ("diabetes", "prescription")
>      ↓
> 🔒 STEP 4: ShieldBrowse REPLACES personal data with code names
>      • "Rahul Sharma" → [[PERSON_1]]
>      • "2345 6789 0123" → [[AADHAAR_1]]
>      • "rahul@example.com" → [[EMAIL_1]]
>      • The code-name-to-real-value mapping stays ONLY in your browser
>      ↓
> 📡 STEP 5: ShieldBrowse sends the CODED version to our AI server
>      • BOTH the webpage AND your text instructions are sanitized!
>      • Server sees: "Name field contains [[PERSON_1]]" and instruction "Use [[AADHAAR_1]]"
>      • Server NEVER sees: "Rahul Sharma" or your raw Aadhaar number
>      ↓
> 🧠 STEP 6: AI server THINKS about what to do
>      • "The user wants to fill this form. I should type [[PERSON_1]] into the name field."
>      ↓
> 📥 STEP 7: Server sends back an instruction
>      • { type [[PERSON_1]] into the name field }
>      ↓
> ✍️ STEP 8: ShieldBrowse SWAPS the code name back and TYPES the real value
>      • [[PERSON_1]] → "Rahul Sharma"
>      • Types "Rahul Sharma" into the name field — locally, in your browser
>      ↓
> 🔄 STEP 9: REPEAT for the next field, until the form is complete
>      ↓
> ✅ STEP 10: DONE! Form is filled. Your data never left your computer.

### What Runs Where

| Component | Where It Runs | What It Does |
|---|---|---|
| **ShieldBrowse Extension** | In YOUR browser, on YOUR computer | Reads the page, detects personal data, replaces with code names, fills in real values |
| **Small AI Models** | In YOUR browser (yes, AI can run locally!) | Detect faces, recognize names, understand images |
| **AI Server** | On our server (AWS cloud or local machine) | Thinks about what action to take next (click, type, scroll) |

**Key point for the pitch**: The small AI models running in the browser have a **measured footprint of ~80 MB total** (including WASM binaries). The heavy AI (the "thinking" part) runs on the server, but it NEVER sees your real data.

---

## 4. The "Wow Factor" — What Makes Us Special

### Our 6 Differentiators (Use These in the Pitch)

#### 1️⃣ Reversible Token Scheme with Opaque Mode
**Problem with naive privacy approaches**: If you just blur out all personal data, the AI becomes useless — it can't tell you to "type your email" if it doesn't even know there's an email to type.

**Our solution**: Instead of blurring, we **replace** data with meaningful code names. The AI knows "there's an email to type" (it sees [[EMAIL_1]]), but it doesn't know the actual email. Our browser extension knows the real value and types it in locally.

**Opaque mode**: For extra-sensitive categories (medical, financial), even the type is hidden — the server sees `[[VALUE_17]]` instead of `[[MEDICAL_1]]`, so it can't even tell the data was medical.

#### 2️⃣ Multi-Layer PII Detection (Defense-in-Depth)
We don't rely on a single method to find personal data. We use **4 layers**:

| Layer | What It Catches | How |
|---|---|---|
| **Pattern Matching / Checksum** | Aadhaar, PAN, phone, email, credit cards | Mathematical validation and Regex |
| **Page Structure Rules** | Password fields, names, addresses | DOM heuristics and autocomplete rules |
| **AI Name Recognition** | Person names, organizations | Local Semantic NER (ONNX) |
| **Face Detection** | Human faces in uploaded photos | Google's MediaPipe BlazeFace |

If one layer misses something, another layer catches it. This is called **defense-in-depth** — the same strategy used in cybersecurity.

#### 3️⃣ Enforceable Privacy Boundary (Two Safety Gates)
Most teams will say "we sanitize data before sending it." That's aspirational. We **enforce** it with two gates:

**Prompt Pre-flight Tokenizer** ✍️ — Users often accidentally type sensitive data into the AI prompt (e.g., "Fill out my Aadhaar 1234..."). Our background script intercepts the prompt, runs a regex tokenization pass, and replaces raw PII with tokens BEFORE it hits the network.

**Privacy Gate** 🔒 — Sits between the tokenizer and the network. Before ANY data leaves the browser, it scans the outbound payload for raw PII. If it finds even one unsanitized value → the request is **physically blocked**. Fail-closed.

**Action Safety Gate** ⛔ — Sits between the server's response and browser execution. Every action the AI returns is validated against a whitelist (click, type, scroll, select, navigate, wait, done), its target must resolve to a real DOM element, its value field is scanned for code-injection patterns (eval, javascript:, <script>, on*=, document.write, fetch()), and per-action constraints are enforced (e.g. scroll direction ∈ {up,down}, wait ≤ 30s, type requires a value). The AI cannot directly control the browser.

#### 4️⃣ Framework-Resilient Execution (React/Angular Proof)
Standard browser automation often breaks on modern web apps because React and Angular suppress "synthetic" (bot-generated) clicks and bulk text injection. We built robust native fallbacks:
- **Typing**: Simulates clipboard pasting via `insertText` to fire native browser events.
- **Clicking**: Uses native `form.requestSubmit()` to bypass framework click suppression on submit buttons.

**Why this matters for judges**: This is the difference between "we try to protect data" and "we enforce that unprotected data cannot leave."

#### 5️⃣ Benchmarked Performance (Real Measured Numbers)
Most teams will say "look, it works!" and show a demo.

We built **PIIBench-mini**: 500+ annotated test cases across healthcare, banking, and government scenarios, including hard negatives (data that looks like PII but isn't). We measure:
- Precision, Recall, F1 **per PII category**
- Confusion matrix (what was misclassified as what)
- Latency per pipeline stage
- False negative report (what was missed)

> **⚠️ CRITICAL**: Only show **real measured results** in the PPT. If benchmark hasn't been run yet, write "Benchmark under execution" — NOT fabricated numbers.

#### 6️⃣ Extremely Lightweight
Our browser-side AI models have a **measured footprint of ~80 MB packaged bundle** (including WASM). That is far smaller than approaches that run a full model in the browser (often 200-500 MB), which make the browser slow and laggy.

We achieve this by being smart about **what runs where**: tiny, specialized models in the browser (just for detecting personal data), and the big AI brain on the server (but it NEVER sees your real data).

#### 7️⃣ DPDP-Aligned Audit Report (Engineering Evidence)
India's **Digital Personal Data Protection Act 2023** requires organizations to handle personal data carefully. Our system can generate an **audit report** showing:
- What personal data was detected
- What was done to protect it
- That no known raw PII leaked to the server in the tested runs (verified by the Privacy Gate)

This maps our controls to DPDP principles like data minimization. **Frame it as engineering evidence, not a legal compliance certificate** — do not claim "DPDP compliant" or "guaranteed compliance". This is relevant for ISRO and government organizations.

#### 8️⃣ Token Rehydration (The Return Trip)
A technical deep-dive into how the browser safely injects real values back into the DOM without the server ever knowing them.
1. **Local State**: The `PIITokenizer` maintains a stateful `tokenMap` in the browser extension's local storage mapping generated tokens (e.g., `[[PERSON_1]]` or `[[VALUE_7]]`) to the real, raw values. This map *never* leaves the client.
2. **Action Interception**: When the server/VLM decides to interact with a field, it sends back a sanitized JSON payload: `{"action": "type", "value": "[[PERSON_1]]"}`.
3. **Regex Rehydration**: Before executing the action, the browser's action handler runs `tokenizer.rehydrateString()`, which intercepts the token using a regex (`/\[\[[A-Z_]+_\d+\]\]/g`) and swaps it back to the `realValue`.
4. **Execution**: The action executor then types the `realValue` into the actual DOM node. If modern frameworks (React/Angular) try to suppress the injection, native fallback events ensure the data binds correctly.

#### 9️⃣ Failure Handling & Edge Cases
Our architecture degrades gracefully when things go wrong:
- **Server Unavailable**: The agent halts and the UI shows an error; there is no unsafe fallback.
- **VLM Hallucinates Malicious Code**: The **Action Safety Gate** strictly type-checks and validates the JSON against a whitelist, rejecting `eval` or script injection.
- **PII Leak via Detector Miss**: The **Privacy Gate** acts as the ultimate fail-closed mechanism, physically blocking network requests if raw PII slips through.
- **Target UI Changes**: The action executor implements DOM stabilization (waiting for elements to settle) and fallback mechanisms (like `requestSubmit`) to handle dynamic React/Angular pages safely.

---

## 5. Key Demo Moments to Highlight

### Moment 1: "The Network Tab Proof" (Most Important!)
During the live demo, open Chrome DevTools → Network Tab. Click on the request being sent to the server. **Show the judges the actual data being sent.** They will see:
> Original:  rahul.sharma@example.com / 2345 6789 0123
>      ↓ LOCAL SANITIZATION
> Sent:      [[EMAIL_1]] / [[AADHAAR_1]]
No real data. Just code names.

**Narrate**: *"Let me show you what actually crosses the network. As you can see, the server receives [[PERSON_1]], not 'Rahul Sharma'. The real value never left this browser."*

### Moment 2: "The Privacy Gate Block"
Deliberately trigger a Privacy Gate violation — show what happens when raw PII would leak:
- The request is **blocked**
- The console shows `🔒 PRIVACY GATE BLOCKED`
- The side panel shows the violation

**Narrate**: *"Now let me show you what happens if our tokenizer had a bug. The Privacy Gate caught that raw PII was still in the payload — and blocked the entire request. The data never left the browser."*

### Moment 3: "The Side Panel"
Show the extension's side panel with:
- List of all detected personal data (with partially masked values)
- The "What Server Sees" preview (all code names)
- Performance metrics (detection time, total pipeline time)

**Narrate**: *"Our side panel shows everything our system detected — including which detection layer caught each item. And here's what the server actually receives — only tokens."*

### Moment 4: "The Form Gets Filled Correctly"
After the AI sends back instructions with code names, show the form being filled with **real values** — even though the server never saw those values.

**Narrate**: *"The server said 'type [[PERSON_1]] into the name field.' Our extension replaces the token with the real name and types it in — locally. The AI helped fill the form without ever knowing the person's name."*

### Moment 5: "The Benchmark Numbers"
Show the precision/recall table. Point out specific numbers.

**Narrate**: *"We didn't just build it — we measured it. Here are our actual precision and recall numbers per PII category. We know exactly where our system is strong and where it has room to improve. We're honest about our limitations."*

> **⚠️ Only narrate real measured numbers here. If the benchmark hasn't been run yet, skip this moment and say "Benchmark under execution."**

---

## 6. How Judges Will Score Us

### The Rubric (100 points)

| Criterion | Weight | What It Means | Why Our Architecture Targets This |
|---|---|---|---|
| **Accuracy of visual context from screen** | 25% | Can the system correctly understand what's on the screen? | DOM/accessibility extraction reads text and forms directly (no OCR error); the vision pass handles image/canvas regions. Report measured accuracy — do not claim "near-perfect". |
| **Recall and precision for PII detection** | 20% | Does it find ALL the personal data? Does it avoid false alarms? | Multi-layer (4-layer) detector for defense-in-depth; PIIBench-mini produces the per-category numbers. Show measured P/R/F1, or "Benchmark under execution". |
| **Precision of redaction** | 20% | Does it redact correctly without breaking the page context? | Reversible tokens preserve context; hard-negative cases test precision. Report measured redaction precision/over-redaction. |
| **Client-side resource utilization** | 20% | How lightweight is it? Does it slow down the browser? | No LLM in the browser; only small specialized models (~80 MB total footprint). |
| **End-to-end latency** | 15% | How fast is the complete pipeline? | DOM-first design avoids OCR on most content; vision runs only where needed. Report measured per-stage and total latency — do not pre-fill numbers. |

### Key Insight for the Pitch
**65% of the score is about the PRIVACY part (PII detection + redaction), not about how smart the AI agent is.** Many teams will focus on building an impressive AI agent and treat privacy as an afterthought. We do the opposite — our **enforceable privacy boundary** IS the product.

---

## 7. Presentation Script & Slide Structure

### Official SIH 6-Slide Template

We use the strict 6-slide SIH template, but we've redesigned the flow to perfectly match our architectural strengths (Privacy Gates, Tokenization, and Latency).

#### Slide 1: TITLE PAGE
> **SMART INDIA HACKATHON 2026**
> Problem Statement ID: 26171
> Theme: Smart Automation
> Team ID: [YOUR TEAM ID]
>
> **ShieldBrowse — Privacy-Preserving On-Device Visual Browser Agent**
>
> Core proposition: *Perceive locally → protect sensitive context locally → reason remotely on sanitized context → execute safely locally*
>
> Team Members: [Names exactly as registered]

#### Slide 2: PROBLEM & USE CASES
> **The Core Conflict: AI needs visual context vs. Users need privacy.**
>
> **The Problem**: AI agents upload full screenshots to the cloud, leaking Aadhaar, PAN, passwords, and medical data.
>
> **Our Primary Use Cases (How we fix it)**:
> 1. **Healthcare Form Assistance**: AI guides a user through medical claims without ever seeing patient IDs or diagnosis codes.
> 2. **Banking Dashboards**: AI interacts with financial UI elements while account balances and card numbers remain strictly on-device.

#### Slide 3: PROPOSED ARCHITECTURE & LOCAL PERCEPTION
> **Token Rehydration: A Closed-Loop Privacy System**
>
> **Local Perception (The ~80MB footprint)**:
> - **YOLOv8-nano ONNX (~45 MB)**: UI/visual element detection.
> - **Local Semantic NER INT8 (~29 MB)**: Person/Org extraction.
> - **MediaPipe BlazeFace (~230 KB)**: Local Face Detection.
> - **Semantic DOM-Heuristics (0 MB)**: Instant structural PII detection.
>
> **The Token Loop**:
> 1. Detect PII and map to tokens (`[[PERSON_1]]`) purely in local memory.
> 2. Server (Llama-4-Scout / Qwen2.5-VL) receives and reasons over tokens.
> 3. Browser *rehydrates* the token (swaps `[[PERSON_1]]` back to "Rahul") before typing. **Server never sees "Rahul"**.

#### Slide 4: TECHNICAL ENFORCEMENT & SAFETY
> **Fail-Closed Architecture: The Two Security Gates**
>
> It's not enough to say "we sanitize data." We physically enforce it:
>
> - 🔒 **Privacy Gate (Data Egress)**: Scans every outbound JSON payload. If raw PII is found, the network request is physically blocked.
> - ⛔ **Action Safety Gate (Action Ingress)**: Scans every incoming server command. Rejects any `eval`, `<script>`, or injection patterns, allowing only whitelisted safe UI actions (`click`, `type`, `scroll`).

#### Slide 5: FEASIBILITY & EVALUATION METRICS
> **Built for Speed and Measured Accuracy**
>
> **Resource Efficiency**: By dropping heavy OCR (which takes 3-10s) and using a DOM-first approach combined with quantized local models, we meet the strict **20% Client Resource** evaluation metric.
>
> **PIIBench-mini Validation**: Tested against 500+ annotated edge cases (including hard negatives) to rigorously measure Precision, Recall, and F1 per PII category, directly satisfying the **20% PII Detection** and **20% Redaction Precision** scoring criteria.

#### Slide 6: IMPACT & DPDP ALIGNMENT
> **Engineering Evidence of Data Minimization**
>
> **DPDP Audit Report**: ShieldBrowse automatically generates a local Markdown audit report per session. It proves to judges (and regulators) exactly how many tokens were generated and that **0 raw values** leaked, providing concrete engineering evidence for DPDP Act 2023 alignment.
>
> **Research References**:
> - Frameworks: ONNX Runtime Web, WebGPU
> - PS 26171 ISRO On-device Visual Perception

---

## 8. The Story / Narrative Arc

### The Pitch in 30 Seconds (Elevator Pitch)
> *"Browser AI agents are powerful but privacy-hostile — they send your full screen to cloud servers. ShieldBrowse enforces an architectural boundary: lightweight local models perceive the page, a 4-layer pipeline detects and tokenizes PII, a Privacy Gate physically blocks any unsanitized data from leaving the browser, and the server reasons only over sanitized tokens."*

### The Emotional Hook (For Opening the Presentation)
> *"Imagine an ISRO scientist filling out a classified internal form. They want AI help — it's a 40-field form. But the data on that form could compromise national security. Today, they have two choices: fill it manually, or trust a cloud AI with classified data. ShieldBrowse gives them a third choice: AI help, with an enforceable privacy boundary."*

### The Single Strongest Sentence (should appear on the PPT)
> **"The AI can reason over the user's browser context without receiving the user's sensitive values."**

---

## 9. Competitive Landscape — How We're Different

### Comparison Table (Put This on a Slide)

| Feature | **ShieldBrowse** (Us) | ChatGPT / Claude Computer Use | browser-use / WebVoyager | Microsoft Presidio |
|---|---|---|---|---|
| Helps with browser tasks | ✅ Yes | ✅ Yes | ✅ Yes | ❌ No (only detects PII) |
| Detects PII | ✅ 4-layer detector | ❌ No | ❌ No | ✅ Yes |
| Runs PII detection locally | ✅ In browser (~80 MB) | ❌ N/A | ❌ N/A | ❌ Server-only (Python) |
| Enforceable privacy boundary | ✅ Privacy Gate (fail-closed) | ❌ Full screenshots to cloud | ❌ Full screenshots to cloud | ✅ But no agent |
| Reversible (agent still works) | ✅ Token rehydration | ❌ N/A | ❌ N/A | ❌ Irreversible |
| Action safety validation | ✅ Anti-injection Prompts | ❌ N/A | ❌ N/A | ❌ N/A |
| Opaque tokenization | ✅ [[VALUE_N]] mode | ❌ N/A | ❌ N/A | ❌ N/A |
| Optimized for Latency | ✅ DOM-First (No OCR) | ❌ Heavy Vision LLMs | ❌ Heavy Vision LLMs | ✅ Has benchmarks |
| Offline-deployable | ✅ Open-source models | ❌ Cloud-only | ❌ Cloud LLM needed | ✅ But no agent |
| Indian PII support | ✅ Aadhaar, PAN | ❌ Generic | ❌ Generic | Partial |

### Our Position
> **"Our architecture combines local privacy enforcement with functional browser-agent execution, heavily optimized for edge latency."**

---

## 10. Judge Q&A — Questions They'll Ask

### Q1: "How do you know your redaction actually works?"
> **Answer**: *"We measure detection across 4 layers: strict regex constraints, semantic DOM heuristics, localized face detection, and vision-bounding boxes. If any of those flag an element, it is redacted. But more importantly, our architecture is fail-closed: the Privacy Gate physically blocks any request that still contains raw PII. So even if the detector misses something in a novel scenario, the gate catches the leak."*

### Q2: "What if your system misses a PII entity?"
> **Answer**: *"That's why we have defense-in-depth. If a user inputs a sensitive ID, the DOM rules catch it based on autocomplete/labels. If it's a raw number, Regex catches it. No single layer is relied upon alone."*

### Q3: "Why not just run the whole AI model in the browser?"
> **Answer**: *"Running a full LLM (like a 3-billion-parameter model) in the browser would need 4+ GB of memory and take 30+ seconds per response, failing the latency metric. Instead, we run only specialized models locally (YOLO, NER, & BlazeFace, ~80MB total footprint including runtime) for detection, and use the server for the heavy reasoning. This keeps the browser fast while the server never sees real data."*

### Q4: "Doesn't the field label 'Diagnosis: [[MEDICAL_1]]' leak that it's medical data?"
> **Answer**: *"We addressed this. For sensitive categories like medical and financial data, we support opaque tokenization — the server sees [[VALUE_17]] instead of [[MEDICAL_1]]. This way the server can't even tell the data was medical. The opaque mode is configurable per entity type through our Privacy Policy."*

### Q5: "Is the token map itself a security risk?"
> **Answer**: *"The token map exists only in the browser's session storage (chrome.storage.session). It's automatically cleared when the browser closes. It's never persisted to disk, never synced to cloud, and never sent over any network. This is a stronger guarantee than any server-side system, because the data never leaves the device at all."*

### Q6: "Why hybrid DOM+vision instead of pure vision?"
> **Answer**: *"Three reasons: (1) Speed — DOM extraction is instant, no AI inference needed. (2) Accuracy — DOM gives us exact text with zero OCR error. (3) Resource efficiency — we only run vision models on image regions, not the entire page. Our lightweight computer vision models still run on every page as a verification layer, satisfying the problem statement's requirement."*

### Q7: "Have you tested on real websites, not just your mock site?"
> **Answer**: *"Our mock site is designed to exercise every PII category and edge case. Our regex and DOM-rule detectors work on ANY website because they're based on universal HTML patterns (input types, autocomplete attributes, label text). We tested the regex layer against [X] real websites during development."*

### Q8: "What open-source model are you using on the server?"
> **Answer**: *"Our architecture is VLM-agnostic. For cloud deployment, we use Llama-4-Scout via the Groq OpenAI API for blazing fast reasoning. For 100% offline deployability (like airgapped environments), we fallback to Qwen2.5-VL-3B deployed locally via Ollama. The server dynamically switches based on API availability."*

### Q9: "How does this relate to India's DPDP Act?"
> **Answer**: *"The DPDP Act 2023 mandates data minimization — collect only what's necessary — and purpose limitation — use data only for its stated purpose. ShieldBrowse's architecture supports both: we send only the minimum data needed (tokenized structure, not raw PII), and we generate an audit trail as engineering evidence. To be precise, that's evidence supporting DPDP principles — not a legal compliance certification, which is out of scope for an MVP."*

### Q10: "How do you handle AI hallucinations or infinite action loops?"
> **Answer**: *"We handle this locally through our Action Safety Gate and Action History memory. If the VLM hallucinates an invalid action, the Action Safety Gate rejects it immediately. To prevent infinite loops (where the VLM keeps trying the same failed action), the extension tracks recent failures and injects them into the prompt. If it fails 3 times, the agent safely halts and asks the user for help."*

### Q11: "Can this run completely without the internet?"
> **Answer**: *"Yes. While our primary fast path uses a cloud API (Groq) for VLM reasoning over sanitized tokens, our architecture supports a 100% offline fallback using Qwen2.5-VL via Ollama. It runs entirely on the local machine. Crucially, regardless of whether you are online or offline, the PII detection and tokenization pipeline ALWAYS runs locally in the browser."*

### Q12: "Why did you choose Vanilla JS instead of React for the extension?"
> **Answer**: *"A browser agent must inject its content script into every page on the internet. If we used React, we would inject a heavy runtime into every tab, which slows down the browser and risks version conflicts with websites that already use React. Vanilla JS and Vite keep our content script incredibly fast, lightweight, and isolated."*

### Q13: "How do you ensure this won't crash low-end computers?"
> **Answer**: *"We aggressively optimize for client resources. We don't run the vision model on the entire screen continuously. We use DOM heuristics first (which take ~5ms and 0 extra RAM) and only invoke the YOLO and Face detection models on specific image regions. Combined with ONNX Runtime's WebGPU/WASM acceleration, our total footprint remains around ~80MB, well within the capacity of modern low-end hardware."*

### Q14: "How does your approach differ from existing research like WebVoyager or OS-ATLAS?"
> **Answer**: *"WebVoyager and OS-ATLAS are state-of-the-art for web agents, but they completely ignore privacy—they send full, unredacted screenshots to cloud LLMs. Our architectural contribution is injecting a local, enforceable privacy layer (the 4-layer detector and Token Rehydration loop) *before* the VLM reasoning phase. We combined web agent research with data minimization research."*

### Q15: "Beyond privacy, what is the business impact of tokenization over just blurring?"
> **Answer**: *"Blurring destroys the context the VLM needs. If you blur an Aadhaar field, the VLM doesn't know what it is. By tokenizing it to `[[AADHAAR_1]]`, the AI knows the semantic structure and can still help the user complete a banking form. This means heavily regulated industries like healthcare and finance can finally deploy AI agents without violating compliance."*

### Q16: "Why is this better than just using Microsoft Presidio to redact data?"
> **Answer**: *"Presidio is a fantastic PII detector, but it is not an agent framework. If you use Presidio to just black out data, an LLM can't help you fill out a form because it doesn't know what data goes where. Our innovation is the 'Token Rehydration Loop'—we replace PII with opaque tokens, let the VLM reason about them, and then our extension rehydrates them back into real values locally. Presidio is one-way; ShieldBrowse is a closed loop."*

### Q17: "How would you scale this to handle new forms of PII?"
> **Answer**: *"Our 4-layer pipeline is completely modular. If a hospital needs to detect a proprietary patient ID format, we don't have to retrain an entire LLM. We just add a new Regex constraint to Layer 1, or fine-tune our tiny 29MB local NER model for Layer 3. The architecture isolates detection logic from reasoning logic, making it trivially scalable."*

### Q18: "How are you running YOLOv8 in the browser without Python?"
> **Answer**: *"We export the PyTorch model to the ONNX format and run it using ONNX Runtime Web. This leverages WebAssembly (WASM) and WebGPU for hardware acceleration directly within Chrome. It allows us to achieve inference times under 100ms entirely client-side, with zero Python backend dependencies."*

### Q19: "Why do you need a local Semantic NER model if you already have Regex?"
> **Answer**: *"Regex and checksums are perfect for structured data like Aadhaar numbers, PAN cards, or emails. But they fail completely on unstructured text like person names ('Rahul Sharma') or organization names ('City Hospital'). Our quantized INT8 DistilBERT NER model specifically catches these semantic entities that lack strict mathematical patterns."*

### Q20: "Why use MediaPipe BlazeFace instead of just letting YOLO detect faces?"
> **Answer**: *"Resource efficiency. BlazeFace is hyper-optimized specifically for face detection and is incredibly tiny (~230KB). It runs significantly faster and more accurately for human faces than a general-purpose YOLO object detector. This allows us to rapidly detect and blur profile pictures or ID photos before any visual data is processed further."*

### Q21: "How does the VLM 'see' the screen if you only send sanitized tokens?"
> **Answer**: *"We don't just send a raw, blurred screenshot. We send the VLM a stripped-down, structural representation of the DOM (an accessibility tree) combined with bounding box coordinates from YOLO. The VLM receives a text-based 'wireframe' where all sensitive values are already replaced with tokens like `[[PERSON_1]]`. It reasons over this structure to determine the next action."*

---

## 11. Glossary — Technical Terms Simplified

| Term | Simple Explanation | Used In Our Project For |
|---|---|---|
| **PII** | Personal data that identifies a person (name, Aadhaar, email, face) | The thing we detect and protect |
| **Token** | A code name that replaces real data ([[PERSON_1]] instead of "Rahul") | How we hide real data from the server |
| **Tokenization** | The process of replacing real data with code names | Our core privacy technique |
| **Rehydration** | Swapping the code name back for the real value ([[PERSON_1]] → "Rahul") | How the browser fills in real data locally |
| **DOM** | The page's internal structure (like a blueprint of the webpage) | How we read what's on the page without taking screenshots |
| **Computer Vision (CV) Models** | AI models that understand images (like a robot eye). Note: YOLOv8-nano is a CNN, not a Vision Transformer — do NOT call it a ViT. | Verifies what's on screen, catches things the DOM misses |
| **NER (Named Entity Recognition)** | AI that reads text and finds names, places, organizations | Catches names and addresses that simple patterns can't |
| **WebGPU** | Browser technology that uses your graphics card for fast AI | Makes our AI models run 5-10x faster in the browser |
| **ONNX** | A universal format for AI models (like PDF but for AI) | How we package AI models to run in the browser |
| **VLM** | AI that understands both images AND text (Vision-Language Model) | The "brain" on the server that decides what action to take |
| **Ollama** | A tool to run AI models locally (like Docker but for AI) | How we run the server AI model locally |
| **MV3 (Manifest V3)** | The current format for Chrome extensions | How our extension is built |
| **WASM (WebAssembly)** | Technology that runs code at near-native speed in browsers | Fallback for running AI models if GPU isn't available |
| **Regex** | A pattern-matching technique (like search on steroids) | How we find Aadhaar numbers, PAN cards, emails |
| **Precision** | Of everything flagged as PII, what % was actually PII | Measures false alarms |
| **Recall** | Of all actual PII, what % did we successfully find | Measures missed detections |
| **F1 Score** | A balanced score combining precision and recall | Single number summarizing detection quality |
| **DPDP Act** | India's Digital Personal Data Protection Act 2023 | The law that makes our project legally relevant |
| **MediaPipe** | Google's toolkit for running face/hand/body detection in browsers | How we detect faces for blurring |
| **Tesseract** | An OCR engine (reads text from images) | How we extract text from scanned documents |
| **FastAPI** | A Python framework for building web servers | Our server technology |

---

## 12. Visual Assets & Diagrams Needed

### For the PPT (Ask the Dev Team for These)

| Asset | Description | Purpose |
|---|---|---|
| **Architecture Diagram** | Flow chart showing Browser → PII Detection → Tokenization → Server → Action. Use the diagram from PLAN.md. | Slide 4 |
| **Before/After Screenshot** | Side-by-side: real form data vs. tokenized version | Slide 3 |
| **4-Layer Detector Visual** | Stacked layers showing Regex/Checksum → DOM Rules → Semantic NER → Face Detection | Slide 5 |
| **Benchmark Table** | Per-entity precision/recall/F1 table | Slide 5 |
| **Latency Chart** | Stacked bar chart showing time per pipeline stage — populate with **measured** values only | Slide 5 |
| **Resource Chart** | Bar chart of model sizes (measured footprint ~80 MB) | Slide 5 |
| **Network Tab Screenshot** | Chrome DevTools showing tokenized payload in the network request | Demo moment |
| **Side Panel Screenshot** | The extension's side panel showing detected PII and metrics | Demo moment |
| **Comparison Table** | ShieldBrowse vs. competitors (from Section 9) | Slide showing differentiation |
| **DPDP Act Visual** | Show how our features map to DPDP Act principles | Slide 6 |
| **ShieldBrowse Logo** | Professional logo for the extension | Title slide, extension icon |

### Design Principles for the PPT
1. **Clean and professional** — this is for ISRO judges, not a startup pitch
2. **Data-driven** — show numbers, tables, charts, not just claims
3. **Visual proofs** — screenshots of actual outputs, not mockups
4. **Minimal text** — use the narration to explain, slides should be visual
5. **Consistent branding** — use "ShieldBrowse" name + shield icon throughout
