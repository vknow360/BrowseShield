import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import browser from "webextension-polyfill";
import * as ort from "onnxruntime-web";
import { preprocessYOLO, postprocessYOLO } from "../core/vision/yolo.js";

let faceDetector = null;
let yoloSession = null;
let isInitialized = false;

export async function initVisionPipeline() {
  if (isInitialized) return;
  console.log("[Vision] Initializing Vision Pipeline...");

  try {
    const vision = await FilesetResolver.forVisionTasks(
      browser.runtime.getURL("wasm"),
    );
    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: browser.runtime.getURL(
          "models/blaze_face_short_range.tflite",
        ),
        delegate: "GPU",
      },
      runningMode: "IMAGE",
    });

    ort.env.wasm.numThreads = 4;
    ort.env.wasm.wasmPaths = browser.runtime.getURL("wasm/");

    try {
      yoloSession = await ort.InferenceSession.create(
        browser.runtime.getURL("models/yolov8n.onnx"),
        { executionProviders: ["webgpu", "wasm"] },
      );
      console.log("[Vision] YOLOv8-nano loaded");
    } catch (e) {
      console.error(
        "[Vision] YOLOv8 model failed to load — UI element perception disabled. " +
          "Ensure public/models/yolov8n.onnx is present.",
        e,
      );
    }

    isInitialized = true;
    console.log("[Vision] Vision Pipeline ready (fully on-device).");
  } catch (error) {
    console.error("[Vision] Failed to initialize pipeline:", error);
  }
}

/**
 * Perceives the screen image and returns a screen-state classification plus UI/face boxes.
 * @param {ImageBitmap} imageBitmap - the captured (optionally downscaled) screenshot
 * @param {Array} [nodes] - sanitized DOM nodes from the page (for screen-state classification)
 * @returns {Promise<{screenType: string, uiBoxes: Array, faceBoxes: Array}>}
 */
export async function perceiveScreen(imageBitmap, nodes = []) {
  if (!isInitialized) await initVisionPipeline();

  let uiBoxes = [];
  let faceBoxes = [];

  try {
    if (yoloSession) {
      const { tensor, scale, offsetX, offsetY } =
        await preprocessYOLO(imageBitmap);
      const results = await yoloSession.run({ images: tensor });
      const outputTensor = results[yoloSession.outputNames[0]];
      uiBoxes = postprocessYOLO(
        outputTensor,
        scale,
        offsetX,
        offsetY,
        imageBitmap.width,
        imageBitmap.height,
      );
      tensor.dispose();
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
  } catch (err) {
    console.error("[Vision] Error in perceiveScreen:", err);
  }

  const screenType = classifyScreenType(nodes, faceBoxes, uiBoxes);
  return { screenType, uiBoxes, faceBoxes };
}

/**
 * Derives a meaningful screen-state label from the perceived UI composition:
 * DOM field types (password / input / button counts) combined with vision box counts.
 * @param {Array} nodes - sanitized DOM nodes
 * @param {Array} faceBoxes - detected face boxes
 * @param {Array} uiBoxes - detected UI/object boxes from YOLO
 * @returns {'login'|'form'|'dashboard'|'page'}
 */
export function classifyScreenType(nodes = [], faceBoxes = [], uiBoxes = []) {
  const isField = (n) =>
    n.tagName === "INPUT" || n.tagName === "SELECT" || n.tagName === "TEXTAREA";
  const fields = nodes.filter(isField);
  const hasPassword = nodes.some(
    (n) => String(n.type || "").toLowerCase() === "password",
  );
  const buttons = nodes.filter((n) => n.tagName === "BUTTON").length;

  if (hasPassword && fields.length <= 4) return "login";
  if (fields.length >= 3) return "form";
  if (uiBoxes.length >= 8 || buttons >= 4) return "dashboard";
  return "page";
}

export function detectFaces(imageBitmap) {
  if (!faceDetector) return [];
  const detections = faceDetector.detect(imageBitmap);
  if (!detections || !detections.detections) return [];
  return detections.detections.map((d) => ({
    boundingBox: {
      originX: d.boundingBox.originX,
      originY: d.boundingBox.originY,
      width: d.boundingBox.width,
      height: d.boundingBox.height,
    },
  }));
}
