// src/core/detector/ner-pipeline.js
import { pipeline, env } from "@xenova/transformers";

// Enforce 100% offline, local execution. No remote fetches allowed.
env.allowRemoteModels = false;
env.useBrowserCache = false;

let nerPipeline = null;

/**
 * Initializes the Transformers.js pipeline using the bundled ONNX model.
 */
export async function initNERPipeline() {
  if (nerPipeline) return;
  console.log("[Detector] Initializing Xenova local NER pipeline...");
  try {
    // Point transformers to the public/models directory in the extension
    env.localModelPath = chrome.runtime.getURL("models");

    // Load the model from public/models/ner/ (using quantized: false because we kept the 15MB FP32 model for accuracy)
    nerPipeline = await pipeline("token-classification", "ner", {
      quantized: false,
    });
    console.log("[Detector] Xenova local NER pipeline loaded successfully.");
  } catch (err) {
    console.error(
      "[Detector] Failed to load local NER pipeline. Ensure the model is bundled in public/models/ner/",
      err,
    );
  }
}

/**
 * Detects free-text PII (person names, locations, orgs) using the DistilBERT ONNX model.
 * @param {string} text
 * @returns {Promise<Array<{entityType: string, value: string, confidence: number}>>}
 */
export async function detectSemanticPII(text) {
  const input = String(text || "").trim();
  if (!input || input.length > 2000 || !nerPipeline) return [];

  const entities = [];
  try {
    const results = await nerPipeline(input);

    // Parse the token classification results (e.g., 'B-PER', 'I-PER')
    for (const res of results) {
      // Filter out low confidence hits
      if (res.score < 0.7) continue;

      let entityType = null;
      if (res.entity.includes("PER")) entityType = "PERSON";
      else if (res.entity.includes("LOC"))
        entityType = "ADDRESS"; // Default locations to address
      else if (res.entity.includes("ORG")) entityType = "ORGANIZATION";

      if (entityType) {
        // Remove subword token markers (e.g. "##son" -> "son")
        const cleanWord = res.word.replace(/##/g, "");
        // We only care about words longer than 2 chars to avoid noise
        if (cleanWord.length > 2) {
          entities.push({
            entityType,
            value: cleanWord,
            confidence: res.score,
            source: "semantic-ner-onnx",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[Detector] NER Inference failed on text block:", err);
  }

  return entities;
}
