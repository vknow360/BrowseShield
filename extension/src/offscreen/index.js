// src/offscreen/index.js
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import * as ort from "onnxruntime-web";
import { preprocessYOLO, postprocessYOLO } from "../core/vision/yolo.js";
import { pipeline, env } from "@xenova/transformers";
import Tesseract from "tesseract.js";

// --- Configuration ---

// Transformers.js config
env.allowRemoteModels = false;
env.useBrowserCache = false;
env.localModelPath = chrome.runtime.getURL("models");
env.backends.onnx.wasm.numThreads = 4; // We can use more threads in offscreen document!

// ONNX config for YOLO
ort.env.wasm.numThreads = typeof SharedArrayBuffer !== "undefined" ? 4 : 1;
ort.env.wasm.wasmPaths = chrome.runtime.getURL("wasm/");

// --- State ---
let faceDetector = null;
let yoloSession = null;
let nerPipeline = null;
let isVisionReady = false;

// --- Vision Initialization ---
async function initVision() {
  if (isVisionReady) return { success: true };
  console.log("[Offscreen] Initializing Vision Pipeline...");
  try {
    const vision = await FilesetResolver.forVisionTasks(chrome.runtime.getURL("wasm"));
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL("models/blaze_face_short_range.tflite"),
        delegate: "CPU",
      },
      runningMode: "IMAGE",
    });

    try {
      yoloSession = await ort.InferenceSession.create(
        chrome.runtime.getURL("models/yolov8n_quantized.onnx"),
        { executionProviders: ["wasm"] }
      );
      console.log("[Offscreen] YOLOv8-nano loaded");
    } catch (e) {
      console.error("[Offscreen] YOLO loading failed:", e);
    }
    
    isVisionReady = true;
    return { success: true };
  } catch (error) {
    console.error("[Offscreen] Vision Init Error:", error);
    return { success: false, error: String(error) };
  }
}

// --- Vision Processing ---
async function perceiveScreen(dataUrl, width, height) {
  if (!isVisionReady) await initVision();
  
  // Convert DataUrl to ImageBitmap
  const blob = await (await fetch(dataUrl)).blob();
  const imageBitmap = await createImageBitmap(blob);

  let uiBoxes = [];
  let faceBoxes = [];

  if (yoloSession) {
    const { tensor, scale, offsetX, offsetY } = await preprocessYOLO(imageBitmap);
    const results = await yoloSession.run({ images: tensor });
    const outputTensor = results[yoloSession.outputNames[0]];
    uiBoxes = postprocessYOLO(outputTensor, scale, offsetX, offsetY, width, height);
    tensor.dispose();
    if (outputTensor && typeof outputTensor.dispose === 'function') {
      outputTensor.dispose();
    }
  }

  if (faceDetector) {
    const detections = faceDetector.detect(imageBitmap);
    if (detections && detections.detections) {
      faceBoxes = detections.detections.map((d) => ({
        x: d.boundingBox.originX,
        y: d.boundingBox.originY,
        w: d.boundingBox.width,
        h: d.boundingBox.height,
        conf: d.categories[0].score,
      }));
    }
  }

  imageBitmap.close();
  return { uiBoxes, faceBoxes };
}

// --- NER Initialization ---
async function initNER() {
  if (nerPipeline) return { success: true };
  console.log("[Offscreen] Initializing NER pipeline...");
  try {
    nerPipeline = await pipeline("token-classification", "ner-int8", {
      quantized: true,
    });
    console.log("[Offscreen] NER pipeline loaded");
    return { success: true };
  } catch (err) {
    console.error("[Offscreen] NER Init Error:", err);
    return { success: false, error: String(err) };
  }
}

// --- NER Processing ---
async function runNER(input) {
  if (!nerPipeline) return [];
  const results = await nerPipeline(input);
  return results; // Return raw results, we'll aggregate in background
}

let ocrWorker = null;

// --- OCR Processing ---
async function runOCR(dataUrl) {
  try {
    if (!ocrWorker) {
      console.log("[Offscreen] Initializing persistent OCR worker...");
      ocrWorker = await Tesseract.createWorker("eng", 1, {
        workerPath: chrome.runtime.getURL("tesseract/worker.min.js"),
        corePath: chrome.runtime.getURL("tesseract/tesseract-core.wasm.js"),
        logger: m => {} // suppress logs
      });
      console.log("[Offscreen] OCR worker ready.");
    }
    const ret = await ocrWorker.recognize(dataUrl);
    const results = [];
    if (ret && ret.data && ret.data.words) {
      for (const w of ret.data.words) {
        if (w.confidence > 60 && w.text.length > 2) {
          results.push({
            text: w.text,
            confidence: w.confidence,
            box: w.bbox
          });
        }
      }
    }
    // Removed worker.terminate() to reuse the instance
    return results;
  } catch (e) {
    console.error("[Offscreen] OCR Error:", e);
    return [];
  }
}

// --- Message Listener ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== "offscreen") return false;

  if (msg.type === "INIT_VISION") {
    initVision().then(sendResponse);
    return true; // Keep message channel open
  }

  if (msg.type === "PERCEIVE_SCREEN") {
    perceiveScreen(msg.dataUrl, msg.width, msg.height).then(sendResponse);
    return true;
  }

  if (msg.type === "INIT_NER") {
    initNER().then(sendResponse);
    return true;
  }

  if (msg.type === "RUN_NER") {
    runNER(msg.input).then(sendResponse);
    return true;
  }
  
  if (msg.type === "RUN_OCR") {
    runOCR(msg.dataUrl).then(sendResponse);
    return true;
  }

  return false;
});