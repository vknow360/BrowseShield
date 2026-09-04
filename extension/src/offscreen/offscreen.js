import { initVisionPipeline, perceiveScreen, detectFaces } from "../background/vision-pipeline.js";

const pendingRequests = new Map();
let requestId = 0;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== "offscreen") return false;

  const id = message.requestId;
  if (!id) return false;

  if (message.type === "PERCEIVE_SCREEN") {
    handlePerceiveScreen(id, message.payload)
      .then(result => sendResponse({ requestId: id, status: "success", result }))
      .catch(err => sendResponse({ requestId: id, status: "error", error: err.message }));
    return true;
  }

  if (message.type === "DETECT_FACES") {
    handleDetectFaces(id, message.payload)
      .then(result => sendResponse({ requestId: id, status: "success", result }))
      .catch(err => sendResponse({ requestId: id, status: "error", error: err.message }));
    return true;
  }

  if (message.type === "INIT_VISION") {
    initVisionPipeline()
      .then(() => sendResponse({ requestId: id, status: "success" }))
      .catch(err => sendResponse({ requestId: id, status: "error", error: err.message }));
    return true;
  }

  return false;
});

async function handlePerceiveScreen(requestId, payload) {
  await initVisionPipeline();
  const imageBitmap = await dataUriToImageBitmap(payload.dataUri);
  try {
    const result = await perceiveScreen(imageBitmap, payload.nodes || []);
    return result;
  } finally {
    imageBitmap.close();
  }
}

async function handleDetectFaces(requestId, payload) {
  await initVisionPipeline();
  const imageBitmap = await dataUriToImageBitmap(payload.dataUri);
  try {
    const faces = detectFaces(imageBitmap);
    return faces;
  } finally {
    imageBitmap.close();
  }
}

async function dataUriToImageBitmap(dataUri) {
  const response = await fetch(dataUri);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}
