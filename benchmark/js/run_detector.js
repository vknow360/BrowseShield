import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
global.chrome = {
    runtime: {
        getURL: (p) => path.join(__dirname, '../../extension/public', p).replace(/\\/g, '/')
    }
};

// Redirect all logs to stderr to keep stdout clean for JSON IPC
console.log = console.error;
console.info = console.error;
console.warn = console.error;

import { initDetectors, scanPageForPII } from '../../extension/src/core/detector/index.js';

async function main() {
    try {
        await initDetectors();
    } catch (e) {
        console.error("Failed to initialize detectors in Node sidecar:", e);
        process.exit(1);
    }

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
    });

    rl.on('line', async (line) => {
        if (!line.trim()) return;
        try {
            const payload = JSON.parse(line);
            const { id, text, nodes } = payload;

            let inputNodes = nodes;
            if (text !== undefined && !nodes) {
                // Wrap plain text in a dummy node for the detector
                inputNodes = [{ id: "text-node", value: text, tagName: "DIV" }];
            }

            const taggedNodes = await scanPageForPII(inputNodes);

            // Extract spans for plain text, or return full tagged nodes
            let predictions = [];
            if (text !== undefined && !nodes) {
                const node = taggedNodes[0];
                if (node.pii && node.pii.isPII) {
                    predictions.push({
                        entity_group: node.pii.entityType,
                        word: text,
                        start: 0,
                        end: text.length,
                        score: node.pii.confidence
                    });
                }
            } else {
                predictions = taggedNodes;
            }

            process.stdout.write(JSON.stringify({ id, predictions }) + "\n");
        } catch (e) {
            console.error("Error processing line:", e);
            process.stdout.write(JSON.stringify({ id: null, error: e.message }) + "\n");
        }
    });
}

main();
