import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { scanPageForPII, initDetectors } from '../extension/src/core/detector/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATASET_DIR = path.join(__dirname, 'dataset');

const ENTITY_TYPES = [
  'PERSON', 'AADHAAR', 'PAN', 'PHONE', 'EMAIL', 'CREDIT_CARD', 'IFSC', 'PINCODE',
  'ADDRESS', 'CITY', 'STATE', 'MEDICAL', 'FINANCIAL', 'FACE', 'DATE_OF_BIRTH'
];

/** A prediction matches a ground-truth entity when they refer to the same field (box) OR same text. */
function sameEntity(a, b) {
  const boxKey = (x) => (Array.isArray(x.box) ? x.box.join(',') : null);
  const ak = boxKey(a), bk = boxKey(b);
  if (ak !== null && ak === bk) return true;
  return a.text != null && a.text === b.text;
}

/**
 * Computes precision / recall / F1 per entity type from predictions vs ground truth.
 * A prediction matches a ground-truth entity when both refer to the same field (box) or text,
 * and share the same entityType — robust to free-text NER fields whose value spans extra words.
 */
function computePiiMetrics(predictions, groundTruth) {
  const results = {};
  let microTP = 0, microFP = 0, microFN = 0;

  for (const type of ENTITY_TYPES) {
    const truePositives = predictions.filter(p =>
      p.entityType === type && groundTruth.some(gt => gt.entityType === type && sameEntity(gt, p))
    ).length;
    const falsePositives = predictions.filter(p =>
      p.entityType === type && !groundTruth.some(gt => gt.entityType === type && sameEntity(gt, p))
    ).length;
    const falseNegatives = groundTruth.filter(gt =>
      gt.entityType === type && !predictions.some(p => p.entityType === type && sameEntity(gt, p))
    ).length;

    if (truePositives === 0 && falsePositives === 0 && falseNegatives === 0) continue;

    microTP += truePositives; microFP += falsePositives; microFN += falseNegatives;
    const precision = truePositives / (truePositives + falsePositives) || 0;
    const recall = truePositives / (truePositives + falseNegatives) || 0;
    const f1 = 2 * (precision * recall) / (precision + recall) || 0;
    results[type] = {
      truePositives, falsePositives, falseNegatives,
      precision: round2(precision), recall: round2(recall), f1: round2(f1)
    };
  }

  const microPrecision = microTP / (microTP + microFP) || 0;
  const microRecall = microTP / (microTP + microFN) || 0;
  const microF1 = 2 * (microPrecision * microRecall) / (microPrecision + microRecall) || 0;
  return { perType: results, micro: { precision: round2(microPrecision), recall: round2(microRecall), f1: round2(microF1) } };
}

/**
 * Rasterizes a list of [x, y, w, h] rectangles into a Set of occupied grid-cell keys.
 * Cell-based coverage gives a correct area union even when rectangles overlap.
 */
function rasterize(rects, cell) {
  const cells = new Set();
  for (const [x, y, w, h] of rects) {
    if (!(w > 0 && h > 0)) continue;
    const x0 = Math.floor(x / cell), y0 = Math.floor(y / cell);
    const x1 = Math.ceil((x + w) / cell), y1 = Math.ceil((y + h) / cell);
    for (let gy = y0; gy < y1; gy++) {
      for (let gx = x0; gx < x1; gx++) cells.add(gx + ',' + gy);
    }
  }
  return cells;
}

function intersectionSize(a, b) {
  let n = 0;
  const [small, large] = a.size < b.size ? [a, b] : [b, a];
  for (const k of small) if (large.has(k)) n++;
  return n;
}

/**
 * Real redaction-precision harness. Rasterizes the regions the client would black out
 * (boxes of fields detected as PII) and the labeled sensitive regions, then measures
 * pixel-coverage precision (redacted pixels that were truly sensitive) and recall
 * (sensitive pixels actually covered) via cell-grid intersection over union.
 */
function computeRedaction(redactedRects, sensitiveRects, cell = 4) {
  const redacted = rasterize(redactedRects, cell);
  const sensitive = rasterize(sensitiveRects, cell);
  if (redacted.size === 0 && sensitive.size === 0) return null;
  const inter = intersectionSize(redacted, sensitive);
  const precision = redacted.size ? inter / redacted.size : 0;
  const recall = sensitive.size ? inter / sensitive.size : 0;
  const union = redacted.size + sensitive.size - inter;
  const iou = union ? inter / union : 0;
  return { precision: round2(precision), recall: round2(recall), iou: round2(iou) };
}

/** Recursively sums the byte size of every file under a directory. */
function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

const round2 = (n) => Math.round(n * 100) / 100;
const toMB = (bytes) => Math.round((bytes / 1024 / 1024) * 100) / 100;

async function runBenchmark() {
  await initDetectors();

  const files = fs.readdirSync(DATASET_DIR).filter(f => f.endsWith('.json'));
  console.log(`\n🛡️  ShieldBrowse Benchmark — ${files.length} labeled samples\n`);

  const allPredictions = [];
  const allGroundTruth = [];
  const redactionScores = [];
  const perceptionIous = [];
  const sampleLatencies = [];
  let nodeCount = 0;

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, file), 'utf-8'));
    const { groundTruth = [], nodes = [] } = data;

    const validGt = groundTruth.filter(gt => !gt.isHardNegative && gt.entityType);
    allGroundTruth.push(...validGt);

    // --- On-device detection latency (real wall-clock over the actual pipeline) ---
    const t0 = performance.now();
    const scannedNodes = await scanPageForPII(nodes);
    const sampleLatency = performance.now() - t0;
    sampleLatencies.push(sampleLatency);
    nodeCount += nodes.length;

    const predictions = [];
    scannedNodes.forEach((node) => {
      if (node.pii && node.pii.isPII) {
        predictions.push({ text: node.value, entityType: node.pii.entityType, box: node.box });
      }
    });
    allPredictions.push(...predictions);

    // --- Redaction precision (real, pixel-coverage) ---
    const redactedRects = predictions.filter(p => Array.isArray(p.box)).map(p => p.box);
    const sensitiveRects = validGt.filter(gt => Array.isArray(gt.box)).map(gt => gt.box);
    const redaction = computeRedaction(redactedRects, sensitiveRects);
    if (redaction) redactionScores.push(redaction);

    // --- Visual context accuracy: IoU of perceived sensitive-field regions vs labeled regions ---
    for (const p of predictions) {
      if (!Array.isArray(p.box)) continue;
      const match = validGt.find(gt => Array.isArray(gt.box) && sameEntity(gt, p));
      if (match) perceptionIous.push(boxIoU(p.box, match.box));
    }
  }

  const pii = computePiiMetrics(allPredictions, allGroundTruth);

  // Metric 1 — Accuracy of visual context (25%): mean IoU of perceived field regions vs ground truth.
  const visualAccuracy = perceptionIous.length
    ? round2(perceptionIous.reduce((a, b) => a + b, 0) / perceptionIous.length)
    : null;

  // Metric 3 — Redaction precision (20%): mean over samples.
  const redactionPrecision = redactionScores.length
    ? round2(redactionScores.reduce((a, r) => a + r.precision, 0) / redactionScores.length)
    : null;
  const redactionRecall = redactionScores.length
    ? round2(redactionScores.reduce((a, r) => a + r.recall, 0) / redactionScores.length)
    : null;

  // Metric 4 — Client resource utilization (20%): measured on-disk footprint.
  // The shipped artifact is `dist/` (which already bundles the model weights + inference wasm),
  // so report that as the total instead of double-counting the source asset folders.
  const modelsBytes = dirSize(path.join(__dirname, '../extension/public/models'));
  const wasmBytes = dirSize(path.join(__dirname, '../extension/public/wasm'));
  const distBytes = dirSize(path.join(__dirname, '../extension/dist'));
  const shippedBytes = distBytes > 0 ? distBytes : modelsBytes + wasmBytes;

  // Metric 5 — On-device detection+tokenization latency (component of end-to-end).
  const avgSampleLatency = sampleLatencies.length
    ? round2(sampleLatencies.reduce((a, b) => a + b, 0) / sampleLatencies.length)
    : null;
  const avgNodeLatency = nodeCount ? round2(sampleLatencies.reduce((a, b) => a + b, 0) / nodeCount) : null;

  // ---- Report ----
  console.log('📊 Metric 2 — PII Detection (Precision / Recall / F1) per entity type:');
  console.table(pii.perType);
  console.log(`   Micro-avg → precision ${pii.micro.precision}, recall ${pii.micro.recall}, F1 ${pii.micro.f1}\n`);

  console.log(`👁️  Metric 1 — Visual context accuracy (field-region IoU): ${fmtPct(visualAccuracy)} (${perceptionIous.length} regions)`);
  console.log(`⬛ Metric 3 — Redaction precision: ${fmtPct(redactionPrecision)} | coverage/recall: ${fmtPct(redactionRecall)}`);
  console.log(`💻 Metric 4 — Client footprint: shipped bundle ${toMB(shippedBytes)}MB `
    + `(model weights ${toMB(modelsBytes)}MB, inference wasm ${toMB(wasmBytes)}MB)`);
  console.log(`⏱️  Metric 5 — On-device detection latency: ${avgSampleLatency}ms/sample, ${avgNodeLatency}ms/field`);
  console.log('     (capture → redact → network → execute stages are timed at runtime; see background/index.js instrumentation)\n');

  const report = {
    generatedAt: new Date().toISOString(),
    samples: files.length,
    metrics: {
      visual_context_accuracy_iou: visualAccuracy,
      pii_detection: pii,
      redaction_precision: redactionPrecision,
      redaction_recall: redactionRecall,
      client_footprint_mb: {
        shipped_bundle: toMB(shippedBytes),
        model_weights: toMB(modelsBytes),
        inference_wasm: toMB(wasmBytes),
        built: distBytes > 0,
        note: distBytes === 0 ? 'dist/ not built — run `npm run build` in extension/ for the packaged footprint' : undefined
      },
      on_device_detection_latency_ms: { perSample: avgSampleLatency, perField: avgNodeLatency }
    }
  };
  const reportPath = path.join(__dirname, 'metrics_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`✅ Saved measured metrics to ${reportPath}`);
}

/** Axis-aligned IoU for two [x, y, w, h] boxes. */
function boxIoU(a, b) {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const xA = Math.max(ax, bx), yA = Math.max(ay, by);
  const xB = Math.min(ax + aw, bx + bw), yB = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, xB - xA) * Math.max(0, yB - yA);
  const union = aw * ah + bw * bh - inter;
  return union ? inter / union : 0;
}

const fmtPct = (v) => (v === null ? 'N/A (no labeled regions)' : `${(v * 100).toFixed(1)}%`);

runBenchmark().catch(console.error);
