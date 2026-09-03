// src/core/detector/ner-pipeline.js
import { pipeline, env } from "@xenova/transformers";

// Enforce 100% offline, local execution. No remote fetches allowed.
env.allowRemoteModels = false;
env.useBrowserCache = false;

// Force single-threaded execution to prevent Service Worker crashes 
// (MV3 Service Workers have poor/buggy support for spawning internal WebWorkers)
env.backends.onnx.wasm.numThreads = 1;

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

    // Load the model from public/models/ner-int8/
    nerPipeline = await pipeline("token-classification", "ner-int8", {
      quantized: true,
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
 * Pure function to aggregate B/I token classification results into entity spans.
 */
export function aggregateNERTokens(results, input) {
  const entities = [];
  let currentSpan = null;

  const pushSpan = () => {
    if (currentSpan) {
      currentSpan.confidence = currentSpan.scoreSum / currentSpan.tokenCount;
      if (currentSpan.confidence >= 0.7) {
        let entityType = null;
        if (currentSpan.type === "PER") entityType = "PERSON";
        else if (currentSpan.type === "LOC") entityType = "ADDRESS";
        else if (currentSpan.type === "ORG") entityType = "ORGANIZATION";

        if (entityType) {
          if (currentSpan.start !== undefined && currentSpan.end !== undefined && currentSpan.start >= 0 && currentSpan.end > currentSpan.start) {
            currentSpan.value = input.substring(currentSpan.start, currentSpan.end);
          }
          if (currentSpan.value.length > 2) {
            entities.push({
              entityType,
              value: currentSpan.value,
              confidence: currentSpan.confidence,
              start: currentSpan.start,
              end: currentSpan.end,
              source: "semantic-ner-onnx"
            });
          }
        }
      }
      currentSpan = null;
    }
  };

  for (const res of results) {
    const typeMatch = res.entity.match(/^[BI]-(.+)$/);
    if (!typeMatch) {
      pushSpan();
      continue;
    }
    
    const isB = res.entity.startsWith("B-");
    const type = typeMatch[1];

    if (isB || (currentSpan && currentSpan.type !== type)) {
      pushSpan();
    }

    if (!currentSpan) {
      currentSpan = {
        type: type,
        value: res.word.replace(/^##/, ""),
        scoreSum: res.score,
        tokenCount: 1,
        start: res.start,
        end: res.end
      };
    } else {
      if (res.word.startsWith("##")) {
        currentSpan.value += res.word.slice(2);
      } else {
        currentSpan.value += " " + res.word;
      }
      currentSpan.scoreSum += res.score;
      currentSpan.tokenCount += 1;
      if (res.end !== undefined) currentSpan.end = res.end;
    }
  }
  pushSpan();

  return entities;
}

/**
 * Detects free-text PII (person names, locations, orgs) using the DistilBERT ONNX model.
 * @param {string} text
 * @returns {Promise<Array<{entityType: string, value: string, confidence: number}>>}
 */
export async function detectSemanticPII(text) {
  const input = String(text || "").trim();
  if (!input || input.length > 2000 || !nerPipeline) return [];

  try {
    const results = await nerPipeline(input);
    return aggregateNERTokens(results, input);
  } catch (err) {
    console.warn("[Detector] NER Inference failed on text block:", err);
  }

  return [];
}
