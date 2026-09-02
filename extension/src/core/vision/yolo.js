import * as ort from "onnxruntime-web";

const TARGET_SIZE = 640;
const CHANNEL_SIZE = TARGET_SIZE * TARGET_SIZE;

export const UI_CLASSES = [
  "DOB", "address", "age input", "age", "button", "checkbox", "city", "company", "country dropdown", 
  "country input", "date", "day dropdown", "doc-upload", "dropdown", "email-input", "emp id", "first-name", 
  "gender dropdown", "gender", "input", "job role", "last-name", "message", "month dropdown", "name", "otp", 
  "password", "phone-num", "redio button", "region", "reminder checkbox", "state dropdown", "state input-", 
  "state", "terms checkbox", "username", "web url-", "year dropdown", "zip code"
];

// Reused across calls to avoid re-allocating the letterbox canvas/buffer every frame.
let yoloCanvas = null;
let yoloCtx = null;

/**
 * Preprocess an ImageBitmap or ImageData for YOLOv8.
 * Letterboxes to 640x640, converts to an NCHW float32 tensor [1, 3, 640, 640] normalized to 0-1.
 * @param {ImageBitmap|ImageData} image
 * @returns {Promise<{tensor: ort.Tensor, scale: number, offsetX: number, offsetY: number}>}
 */
export async function preprocessYOLO(image) {
  if (!yoloCanvas) {
    yoloCanvas = new OffscreenCanvas(TARGET_SIZE, TARGET_SIZE);
    yoloCtx = yoloCanvas.getContext("2d", { willReadFrequently: true });
  }
  const ctx = yoloCtx;

  // Letterbox: gray pad + centered, aspect-preserving resize.
  ctx.fillStyle = "#727272"; // 114, 114, 114
  ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);

  const scale = Math.min(TARGET_SIZE / image.width, TARGET_SIZE / image.height);
  const newWidth = image.width * scale;
  const newHeight = image.height * scale;
  const offsetX = (TARGET_SIZE - newWidth) / 2;
  const offsetY = (TARGET_SIZE - newHeight) / 2;
  ctx.drawImage(image, offsetX, offsetY, newWidth, newHeight);

  const pixels = ctx.getImageData(0, 0, TARGET_SIZE, TARGET_SIZE).data; // RGBA

  // NCHW transpose in a single tight pass over the RGBA buffer.
  const tensorData = new Float32Array(3 * CHANNEL_SIZE);
  const gOffset = CHANNEL_SIZE;
  const bOffset = 2 * CHANNEL_SIZE;
  for (let i = 0, p = 0; i < CHANNEL_SIZE; i++, p += 4) {
    tensorData[i] = pixels[p] / 255;
    tensorData[i + gOffset] = pixels[p + 1] / 255;
    tensorData[i + bOffset] = pixels[p + 2] / 255;
  }

  const tensor = new ort.Tensor("float32", tensorData, [
    1,
    3,
    TARGET_SIZE,
    TARGET_SIZE,
  ]);
  return { tensor, scale, offsetX, offsetY };
}

/**
 * Postprocess YOLOv8 output tensor [1, num_classes+4, 8400]
 * Filters by confidence, applies NMS, and scales boxes back to original image dimensions.
 */
export function postprocessYOLO(
  outputTensor,
  scale,
  offsetX,
  offsetY,
  origWidth,
  origHeight,
  confThreshold = 0.25,
  iouThreshold = 0.45,
) {
  const data = outputTensor.data; // Float32Array
  const dims = outputTensor.dims; // [1, N, 8400]

  if (dims.length !== 3 || dims[0] !== 1) {
    console.warn("Unexpected YOLO tensor dims:", dims);
    return [];
  }

  const numRows = dims[1]; // 4 + num_classes
  const numCols = dims[2]; // 8400
  const numClasses = numRows - 4;

  let boxes = [];

  // Output is typically [1, 84, 8400] where columns are predictions
  for (let c = 0; c < numCols; c++) {
    let maxConf = 0;
    let maxClass = -1;

    // Find highest class probability
    for (let i = 0; i < numClasses; i++) {
      const conf = data[1 * (4 + i) * numCols + c];
      if (conf > maxConf) {
        maxConf = conf;
        maxClass = i;
      }
    }

    if (maxConf > confThreshold) {
      // Get bounding box coords (cx, cy, w, h)
      const cx = data[0 * numCols + c];
      const cy = data[1 * numCols + c];
      const w = data[2 * numCols + c];
      const h = data[3 * numCols + c];

      // Convert to xmin, ymin, xmax, ymax in 640x640 coords
      const xmin = cx - w / 2;
      const ymin = cy - h / 2;
      const xmax = cx + w / 2;
      const ymax = cy + h / 2;

      // Project back to original image coords
      const origXmin = (xmin - offsetX) / scale;
      const origYmin = (ymin - offsetY) / scale;
      const origXmax = (xmax - offsetX) / scale;
      const origYmax = (ymax - offsetY) / scale;

      // Clamp to image dimensions
      const clampedXmin = Math.max(0, origXmin);
      const clampedYmin = Math.max(0, origYmin);
      const clampedXmax = Math.min(origWidth, origXmax);
      const clampedYmax = Math.min(origHeight, origYmax);

      const width = clampedXmax - clampedXmin;
      const height = clampedYmax - clampedYmin;

      if (width > 0 && height > 0) {
        boxes.push({
          x: clampedXmin,
          y: clampedYmin,
          w: width,
          h: height,
          conf: maxConf,
          classId: maxClass,
          className: UI_CLASSES[maxClass] || `class_${maxClass}`,
        });
      }
    }
  }

  // Non-Maximum Suppression (NMS)
  return applyNMS(boxes, iouThreshold);
}

function applyNMS(boxes, iouThreshold) {
  // Sort by confidence descending
  boxes.sort((a, b) => b.conf - a.conf);

  const results = [];
  while (boxes.length > 0) {
    const current = boxes.shift();
    results.push(current);

    boxes = boxes.filter((box) => {
      if (box.classId !== current.classId) return true;
      const iou = calculateIoU(current, box);
      return iou < iouThreshold;
    });
  }
  return results;
}

function calculateIoU(box1, box2) {
  const xA = Math.max(box1.x, box2.x);
  const yA = Math.max(box1.y, box2.y);
  const xB = Math.min(box1.x + box1.w, box2.x + box2.w);
  const yB = Math.min(box1.y + box1.h, box2.y + box2.h);

  const interArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const box1Area = box1.w * box1.h;
  const box2Area = box2.w * box2.h;

  return interArea / (box1Area + box2Area - interArea);
}
