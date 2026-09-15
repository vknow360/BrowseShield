import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getDirSize(dirPath) {
    let total = 0;
    for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            total += getDirSize(fullPath);
        } else {
            total += fs.statSync(fullPath).size;
        }
    }
    return total;
}

function formatMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
}

function main() {
    console.log("[Metric 4] Client-side Resource Utilization Report");
    console.log("===================================================\n");

    const extDir = path.resolve(__dirname, '../../extension');
    const modelsDir = path.resolve(extDir, 'public/models');

    // 1. Model file sizes
    const models = [
        { name: "YOLO UI Detector (INT8)", path: path.join(modelsDir, 'yolov8n_quantized.onnx') },
        { name: "BlazeFace (TFLite)", path: path.join(modelsDir, 'blaze_face_short_range.tflite') },
        { name: "NER Token Classifier (INT8 ONNX)", path: path.join(modelsDir, 'ner-int8/onnx/model_quantized.onnx') },
        { name: "NER Tokenizer Vocab", path: path.join(modelsDir, 'ner-int8/tokenizer.json') },
    ];

    let totalModelSize = 0;
    console.log("ML Model Sizes:");
    for (const m of models) {
        if (fs.existsSync(m.path)) {
            const size = fs.statSync(m.path).size;
            totalModelSize += size;
            console.log(`  ${m.name}: ${formatMB(size)} MB`);
        } else {
            console.log(`  ${m.name}: NOT FOUND (${m.path})`);
        }
    }
    console.log(`  Total ML Models: ${formatMB(totalModelSize)} MB\n`);

    // 2. Extension dist size (if built)
    const distDir = path.resolve(extDir, 'dist');
    let distSize = 0;
    if (fs.existsSync(distDir)) {
        distSize = getDirSize(distDir);
        console.log(`Extension dist/ size: ${formatMB(distSize)} MB`);
    }

    // 3. Read CDP heap data from run_e2e.js output if available
    const e2eReport = path.resolve(__dirname, '../../reports/latest/e2e_latency.json');
    let runtimeData = null;
    if (fs.existsSync(e2eReport)) {
        const e2e = JSON.parse(fs.readFileSync(e2eReport, 'utf-8'));
        runtimeData = {
            pageHeapMB: e2e.pageHeapMB,
            swHeapMB: e2e.swHeapMB,
        };
        console.log(`\nRuntime Memory (from E2E report):`);
        console.log(`  Page JS Heap: p50=${runtimeData.pageHeapMB?.p50}MB, p95=${runtimeData.pageHeapMB?.p95}MB, max=${runtimeData.pageHeapMB?.max}MB`);
        console.log(`  SW JS Heap:   p50=${runtimeData.swHeapMB?.p50}MB, p95=${runtimeData.swHeapMB?.p95}MB, max=${runtimeData.swHeapMB?.max}MB`);
    } else {
        console.log("\n(No E2E report found — run run_e2e.js first for runtime memory data)");
    }

    // 4. Write JSON report
    const report = {
        metric: "client_resource_utilization",
        weight: 0.20,
        models: models.map(m => ({
            name: m.name,
            sizeMB: fs.existsSync(m.path) ? parseFloat(formatMB(fs.statSync(m.path).size)) : null,
        })),
        total_model_size_mb: parseFloat(formatMB(totalModelSize)),
        extension_dist_size_mb: parseFloat(formatMB(distSize)),
        runtime: runtimeData,
        notes: [
            "All ML inference runs on client via WebGPU/WASM — no GPU required",
            "ONNX Runtime Web used for YOLO and NER models",
            "MediaPipe Vision used for BlazeFace (TFLite)",
            "Models are INT8 quantized to minimize memory footprint"
        ]
    };

    const outDir = path.resolve(__dirname, '../../reports/latest');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'metric4_resource.json'), JSON.stringify(report, null, 2));
    console.log(`\nReport written to reports/latest/metric4_resource.json`);
}

main();
