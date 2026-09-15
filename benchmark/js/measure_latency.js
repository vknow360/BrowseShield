import { performance } from 'perf_hooks';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
const { initDetectors, scanPageForPII } = await import('../../extension/src/core/detector/index.js');

async function measure() {
    console.log("Initializing detectors...");
    const initStart = performance.now();
    await initDetectors();
    const initEnd = performance.now();
    
    // Warmup
    await scanPageForPII([{ id: "w", value: "test@example.com", tagName: "INPUT" }]);
    
    // Generate a massive realistic DOM payload (5000 nodes)
    const nodes = [];
    const NUM_NODES = 5000;
    
    // Some realistic PII to scatter
    const piiSamples = [
        { value: "1234 5678 9012", label: "Aadhaar", type: "text" },
        { value: "ABCDE1234F", label: "PAN", type: "text" },
        { value: "9876543210", label: "Phone", type: "tel" },
        { value: "test.user@isro.gov.in", label: "Email", type: "email" }
    ];

    for (let i = 0; i < NUM_NODES; i++) {
        // Inject PII in roughly 2% of the nodes (100 PII fields)
        if (i % 50 === 0) {
            const sample = piiSamples[(i / 50) % piiSamples.length];
            nodes.push({
                id: `node_${i}`,
                value: sample.value,
                label: sample.label,
                tagName: "INPUT",
                type: sample.type
            });
        } else {
            // Normal DOM nodes (divs, spans, paragraphs with lorem ipsum)
            nodes.push({
                id: `node_${i}`,
                value: `This is normal paragraph text for node ${i}. It contains some standard content that should be ignored by the PII detector because it is just structural or informational text on a webpage.`,
                label: "",
                tagName: i % 3 === 0 ? "DIV" : (i % 3 === 1 ? "SPAN" : "P"),
                type: "text"
            });
        }
    }
    
    let totalMs = 0;
    const ITERATIONS = 20; // Lower iterations since payload is huge
    
    console.log(`\nStarting benchmark: Scanning a synthetic DOM with ${nodes.length} nodes (${nodes.filter(n => n.tagName === "INPUT").length} PII inputs)...`);
    
    for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        await scanPageForPII(nodes);
        const end = performance.now();
        totalMs += (end - start);
    }
    
    const avgMs = totalMs / ITERATIONS;
    const avgPerNode = avgMs / nodes.length;
    
    console.log(`Init Time: ${(initEnd - initStart).toFixed(2)} ms`);
    console.log(`Avg Latency (Batch of ${nodes.length} nodes): ${avgMs.toFixed(2)} ms`);
    console.log(`Avg Latency per Node: ${avgPerNode.toFixed(2)} ms`);
    process.exit(0);
}

measure();
