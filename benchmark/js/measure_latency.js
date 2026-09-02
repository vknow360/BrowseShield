import { performance } from 'perf_hooks';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
global.chrome = {
    runtime: {
        getURL: (p) => path.join(__dirname, '../../extension/public', p).replace(/\\/g, '/')
    }
};

import { initDetectors, scanPageForPII } from '../../extension/src/core/detector/index.js';

async function measure() {
    console.log("Initializing detectors...");
    const initStart = performance.now();
    await initDetectors();
    const initEnd = performance.now();
    
    // Warmup
    await scanPageForPII([{ id: "w", value: "test@example.com", tagName: "INPUT" }]);
    
    const nodes = [
        { id: "1", value: "My name is John Doe.", label: "Full Name", tagName: "INPUT", type: "text" },
        { id: "2", value: "1234 5678 9012", label: "Aadhaar", tagName: "INPUT", type: "text" },
        { id: "3", value: "ABCDE1234F", label: "PAN", tagName: "INPUT", type: "text" },
        { id: "4", value: "This is just a normal sentence with no PII in it.", label: "Notes", tagName: "TEXTAREA", type: "text" },
        { id: "5", value: "9876543210", label: "Phone", tagName: "INPUT", type: "tel" }
    ];
    
    let totalMs = 0;
    const ITERATIONS = 100;
    
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
}

measure();
