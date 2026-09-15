import browser from "webextension-polyfill";
import { setupOffscreenDocument } from "./offscreen-setup.js";
import { detectSemanticPII, initNERPipeline } from "../core/detector/ner-pipeline.js";

let isInitialized = false;

export async function initVisionPipeline() {
  if (isInitialized) return;
  console.log("[Vision] Initializing Vision Pipeline in Offscreen Document...");

  try {
    await setupOffscreenDocument('src/offscreen/index.html');
    
    const response = await browser.runtime.sendMessage({
      target: "offscreen",
      type: "INIT_VISION"
    });

    if (response && response.success) {
      isInitialized = true;
      console.log("[Vision] Vision Pipeline ready (offscreen).");
    } else {
      throw new Error(response ? response.error : "Unknown error");
    }
  } catch (error) {
    console.error("[Vision] Failed to initialize pipeline:", error);
  }
}

export async function perceiveScreen(imageBitmap, nodes = []) {
  if (!isInitialized) await initVisionPipeline();

  let uiBoxes = [];
  let faceBoxes = [];

  // Convert ImageBitmap to Data URL to send across message port
  const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(imageBitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

  try {
    const response = await browser.runtime.sendMessage({
      target: "offscreen",
      type: "PERCEIVE_SCREEN",
      dataUrl,
      width: imageBitmap.width,
      height: imageBitmap.height
    });

    if (response) {
      uiBoxes = response.uiBoxes || [];
      faceBoxes = response.faceBoxes || [];
    }
  } catch (e) {
    console.error("[Vision] Failed to perceive screen via offscreen:", e);
  }

  const { screenType, piiVisionBoxes } = classifyScreenType(nodes, faceBoxes, uiBoxes);
  return { screenType, uiBoxes, faceBoxes, piiVisionBoxes };
}

export function classifyScreenType(nodes = [], faceBoxes = [], uiBoxes = []) {
  const isField = (n) => n.tagName === "INPUT" || n.tagName === "SELECT" || n.tagName === "TEXTAREA";
  const fields = nodes.filter(isField);
  const hasPassword = nodes.some((n) => String(n.type || "").toLowerCase() === "password");
  
  const buttons = nodes.filter((n) => n.tagName === "BUTTON").length;

  const visionPasswords = uiBoxes.filter(b => b.className === 'password').length;
  const visionButtons = uiBoxes.filter(b => b.className === 'button').length;
  const visionInputs = uiBoxes.filter(b => 
    ['input', 'email-input', 'first-name', 'last-name', 'phone-num', 'username'].includes(b.className)
  ).length;

  const PII_CLASSES = new Set(['password', 'email-input', 'phone-num', 'DOB', 'address', 'name', 'first-name', 'last-name', 'otp', 'zip code']);
  const piiVisionBoxes = uiBoxes.filter(b => PII_CLASSES.has(b.className));

  let screenType = "page";
  if ((hasPassword || visionPasswords > 0) && (fields.length <= 4 && visionInputs <= 3)) screenType = "login";
  else if (fields.length >= 3 || visionInputs >= 3) screenType = "form";
  else if (uiBoxes.length >= 8 || buttons >= 4 || visionButtons >= 4) screenType = "dashboard";

  return { screenType, piiVisionBoxes };
}

export function detectFaces(imageBitmap) {
  // Deprecated for direct synchronous use, handled via offscreen now
  return [];
}

export async function detectVisualPII(imageBitmap, tokenMap = {}) {
  if (!isInitialized) await initVisionPipeline();
  // We no longer need to initialize NER here because it's handled in agent-loop and we just use tokenMap.

  const MAX_EDGE = 800;
  const longest = Math.max(imageBitmap.width, imageBitmap.height);
  const f = longest > MAX_EDGE ? MAX_EDGE / longest : 1;
  
  let ocrBitmap = imageBitmap;
  if (f < 1) {
    ocrBitmap = await createImageBitmap(imageBitmap, {
      resizeWidth: Math.round(imageBitmap.width * f),
      resizeHeight: Math.round(imageBitmap.height * f),
      resizeQuality: "high",
    });
  }

  const canvas = new OffscreenCanvas(ocrBitmap.width, ocrBitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(ocrBitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
  
  const reader = new FileReader();
  const dataUrl = await new Promise((resolve) => {
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

  if (f < 1) ocrBitmap.close();

  try {
    const ocrWords = await browser.runtime.sendMessage({
      target: "offscreen",
      type: "RUN_OCR",
      dataUrl
    });

    if (!ocrWords || ocrWords.length === 0) return [];

    // Extract all known PII values from the tokenMap
    const knownPiiValues = Object.values(tokenMap).map(v => String(v.realValue || v).toLowerCase());
    
    // Also run regex and NER directly on the OCR text to catch completely static PII (e.g. in navbars)
    const fullText = ocrWords.map(w => w.text).join(" ");
    
    // Find PII using semantic NER
    const semanticEntities = await detectSemanticPII(fullText);
    
    // Find PII using regex
    const promptRegexes = [
      { type: "AADHAAR", regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
      { type: "EMAIL", regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g },
      { type: "PHONE", regex: /\b(?:\+91|0)?[6-9]\d{9}\b/g },
      { type: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g },
      { type: "CREDIT_CARD", regex: /\b(?:\d[ -]*?){13,16}\b/g },
      { type: "PINCODE", regex: /\b[1-9]\d{5}\b/g },
      { type: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g }
    ];
    
    for (const { type, regex } of promptRegexes) {
      const matches = [...fullText.matchAll(regex)];
      for (const match of matches) {
        knownPiiValues.push(String(match[0]).trim().toLowerCase());
      }
    }
    
    for (const ent of semanticEntities) {
      knownPiiValues.push(String(ent.value).trim().toLowerCase());
    }

    // Break down known PII values into individual words to match against OCR words
    const knownPiiWords = new Set();
    for (const val of knownPiiValues) {
      const words = val.split(/\s+/);
      for (const w of words) {
        if (w.length > 2) {
          knownPiiWords.add(w);
        }
      }
    }

    const piiBoxes = [];
    
    // Match any OCR word against our known PII words
    for (const w of ocrWords) {
      if (!w || !w.box) continue;
      const text = w.text.toLowerCase();
      // If the word matches exactly, or is included in a known word (or vice versa), box it
      for (const known of knownPiiWords) {
        if ((text.includes(known) || known.includes(text)) && text.length > 2) {
           const box = {
             x: (w.box.x0 ?? w.box.x ?? 0) / f,
             y: (w.box.y0 ?? w.box.y ?? 0) / f,
             w: ((w.box.x1 ?? (w.box.x + w.box.w)) - (w.box.x0 ?? w.box.x ?? 0)) / f,
             h: ((w.box.y1 ?? (w.box.y + w.box.h)) - (w.box.y0 ?? w.box.y ?? 0)) / f
           };
           piiBoxes.push(box);
           console.log(`[Vision] Visual PII Matched: "${w.text}" via known PII "${known}" -> Box:`, box);
           break; // Boxed this word, move to next
        }
      }
    }
    
    console.log(`[Vision] Visual PII Total Boxes:`, piiBoxes.length);
    return piiBoxes;

  } catch (e) {
    console.error("[Vision] Visual PII detection failed:", e);
    return [];
  }
}
