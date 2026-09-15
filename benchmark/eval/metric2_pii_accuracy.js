import { performance } from 'perf_hooks';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Polyfill browser APIs for Node.js
global.chrome = {
    runtime: {
        id: "benchmark",
        getURL: (p) => path.join(__dirname, '../../extension/public', p).replace(/\\/g, '/')
    }
};
global.browser = {
    runtime: {
        id: "benchmark",
        sendMessage: async () => ({ success: true }),
        getURL: (p) => path.join(__dirname, '../../extension/public', p).replace(/\\/g, '/')
    }
};

// Import the real detector
const { initDetectors, detectFieldPII } = await import('../../extension/src/core/detector/index.js');

async function main() {
    console.log("[Metric 2] PII Detection Precision/Recall Benchmark");
    console.log("===================================================\n");

    // Load ground truth
    const gtPath = path.resolve(__dirname, '../data/pii_ground_truth.json');
    const groundTruth = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
    console.log(`Loaded ${groundTruth.length} test cases.\n`);

    // Init detectors (loads NER model)
    await initDetectors();

    // Per-entity-type counters
    const stats = {}; // { entityType: { tp, fp, fn } }
    const globalStats = { tp: 0, fp: 0, fn: 0, tn: 0 };
    const errors = []; // Collect misclassifications for debugging

    for (const testCase of groundTruth) {
        const result = await detectFieldPII(testCase);

        const expectedPII = testCase.expected.isPII;
        const expectedType = testCase.expected.entityType || null;

        const predictedPII = result !== null && result.isPII === true;
        const predictedType = predictedPII ? result.entityType : null;

        if (expectedPII && predictedPII) {
            // Both agree it's PII
            if (expectedType === predictedType) {
                // True Positive (correct type)
                globalStats.tp++;
                if (!stats[expectedType]) stats[expectedType] = { tp: 0, fp: 0, fn: 0 };
                stats[expectedType].tp++;
            } else {
                // Detected as PII but wrong type → count as FP for predicted type, FN for expected type
                globalStats.fp++;
                globalStats.fn++;
                if (!stats[expectedType]) stats[expectedType] = { tp: 0, fp: 0, fn: 0 };
                stats[expectedType].fn++;
                if (!stats[predictedType]) stats[predictedType] = { tp: 0, fp: 0, fn: 0 };
                stats[predictedType].fp++;
                errors.push({ id: testCase.id, expected: expectedType, predicted: predictedType, value: testCase.value.substring(0, 30) });
            }
        } else if (expectedPII && !predictedPII) {
            // False Negative (missed PII)
            globalStats.fn++;
            if (!stats[expectedType]) stats[expectedType] = { tp: 0, fp: 0, fn: 0 };
            stats[expectedType].fn++;
            errors.push({ id: testCase.id, expected: expectedType, predicted: "NONE", value: testCase.value.substring(0, 30) });
        } else if (!expectedPII && predictedPII) {
            // False Positive (flagged non-PII)
            globalStats.fp++;
            if (!stats[predictedType]) stats[predictedType] = { tp: 0, fp: 0, fn: 0 };
            stats[predictedType].fp++;
            errors.push({ id: testCase.id, expected: "NOT_PII", predicted: predictedType, value: testCase.value.substring(0, 30) });
        } else {
            // True Negative (correctly ignored)
            globalStats.tn++;
        }
    }

    // Compute per-type P/R/F1
    console.log("Per-Entity-Type Results:");
    console.log("─".repeat(70));
    console.log(`${"Type".padEnd(18)} ${"Precision".padEnd(12)} ${"Recall".padEnd(12)} ${"F1".padEnd(12)} TP/FP/FN`);
    console.log("─".repeat(70));

    let macroP = 0, macroR = 0, macroF1 = 0, typeCount = 0;

    for (const [type, s] of Object.entries(stats).sort()) {
        const p = s.tp / (s.tp + s.fp) || 0;
        const r = s.tp / (s.tp + s.fn) || 0;
        const f1 = p + r > 0 ? 2 * p * r / (p + r) : 0;
        console.log(`${type.padEnd(18)} ${p.toFixed(3).padEnd(12)} ${r.toFixed(3).padEnd(12)} ${f1.toFixed(3).padEnd(12)} ${s.tp}/${s.fp}/${s.fn}`);
        macroP += p; macroR += r; macroF1 += f1; typeCount++;
    }

    macroP /= typeCount; macroR /= typeCount; macroF1 /= typeCount;

    console.log("─".repeat(70));
    console.log(`${"MACRO AVG".padEnd(18)} ${macroP.toFixed(3).padEnd(12)} ${macroR.toFixed(3).padEnd(12)} ${macroF1.toFixed(3).padEnd(12)}`);
    console.log(`\nGlobal: TP=${globalStats.tp} FP=${globalStats.fp} FN=${globalStats.fn} TN=${globalStats.tn}`);

    if (errors.length > 0) {
        console.log(`\nMisclassifications (${errors.length}):`);
        for (const e of errors.slice(0, 20)) {
            console.log(`  [${e.id}] expected=${e.expected}, predicted=${e.predicted}, value="${e.value}"`);
        }
    }

    // Write JSON output
    const report = {
        metric: "pii_detection_precision_recall",
        weight: 0.20,
        total_cases: groundTruth.length,
        global: { ...globalStats, precision: globalStats.tp / (globalStats.tp + globalStats.fp) || 0, recall: globalStats.tp / (globalStats.tp + globalStats.fn) || 0 },
        per_type: Object.fromEntries(Object.entries(stats).map(([type, s]) => {
            const p = s.tp / (s.tp + s.fp) || 0;
            const r = s.tp / (s.tp + s.fn) || 0;
            return [type, { ...s, precision: p, recall: r, f1: p + r > 0 ? 2 * p * r / (p + r) : 0 }];
        })),
        macro: { precision: macroP, recall: macroR, f1: macroF1 },
        errors: errors,
    };

    const outDir = path.resolve(__dirname, '../../reports/latest');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'metric2_pii_accuracy.json'), JSON.stringify(report, null, 2));
    console.log(`\nReport written to reports/latest/metric2_pii_accuracy.json`);

    process.exit(0);
}

main();
