import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const REPORT_DIR = path.resolve(__dirname, '../../reports/latest');
const MOCK_URL = 'http://localhost:3000/healthcare.html';

async function launchBrowser() {
    if (!fs.existsSync(EXTENSION_PATH)) {
        throw new Error(`Extension not built: ${EXTENSION_PATH} does not exist. Run 'npm run build' in extension/.`);
    }
    return puppeteer.launch({
        headless: 'new',
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--window-size=1280,900',
            '--enable-unsafe-webgpu',
            '--no-sandbox',
        ],
    });
}

function percentile(arr, p) {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
    return s[idx];
}

async function main() {
    console.log("[Metric 5] E2E Latency Benchmark");
    console.log("===================================================\n");

    const browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Set endpoint to mock server
    await page.evaluateOnNewDocument(() => {
        window.localStorage.setItem('serverEndpoint', 'http://localhost:8000');
    });

    const timings = {};

    page.on('console', msg => {
        const text = msg.text();
        // console.log("[Browser]", text); // Uncomment for debugging
        const m = text.match(/\[AgentLoop:Timing\] (\w+) (START|DONE) (\d+)/);
        if (m) {
            timings[m[1]] = { event: m[2], timestamp: Number(m[3]) };
        }
    });

    console.log(`Navigating to ${MOCK_URL}...`);
    await page.goto(MOCK_URL, { waitUntil: 'networkidle2' });

    // Wait for the extension's content script to inject and do initial scan
    await new Promise(r => setTimeout(r, 2000));

    // We can't directly trigger the service worker's planNextStep easily from the page context.
    // Instead, we will simulate a task submission via standard message passing if we were in extension context.
    // However, the easiest way is to use CDP to run code in the service worker context.
    
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.type() === 'service_worker');
    if (!swTarget) {
        throw new Error("Service worker not found!");
    }

    const swSession = await swTarget.createCDPSession();
    await swSession.send('Runtime.enable');
    await swSession.send('Console.enable');

    swSession.on('Console.messageAdded', (e) => {
        const text = e.message.text;
        // console.log("[SW]", text); // Uncomment for debugging
        const m = text.match(/\[AgentLoop:Timing\] (\w+) (START|DONE) (\d+)/);
        if (m) {
            timings[m[1]] = { event: m[2], timestamp: Number(m[3]) };
        }
    });

    console.log("Triggering VLM Agent Loop...");
    
    // Inject code into the service worker to trigger the agent loop
    await swSession.send('Runtime.evaluate', {
        expression: `
            browser.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => {
                let activeTab = tabs[0];
                if (!activeTab) {
                    browser.tabs.query({ active: true, currentWindow: true }).then(fallbackTabs => {
                        if (fallbackTabs[0]) agentLoop.start("Fill out this form please", fallbackTabs[0].id, fallbackTabs[0].windowId);
                    });
                } else {
                    agentLoop.start("Fill out this form please", activeTab.id, activeTab.windowId);
                }
            });
        `,
        awaitPromise: true
    });

    console.log("Waiting for Agent Loop to finish...");
    
    // Wait until action_execution DONE is seen or timeout
    let waited = 0;
    while (!timings.action_execution && waited < 15000) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
    }

    await browser.close();

    if (!timings.action_execution) {
        console.error("Timeout: Agent loop did not complete.");
        process.exit(1);
    }

    console.log("\nTimings recorded:");
    console.log(timings);

    // Calculate stage durations
    const stages = {
        dom_sanitization_ms: timings.dom_sanitization.timestamp - timings.planNextStep.timestamp,
        prompt_tokenization_ms: timings.prompt_tokenization.timestamp - timings.dom_sanitization.timestamp,
        screen_capture_ms: timings.screen_capture.timestamp - timings.prompt_tokenization.timestamp,
        yolo_inference_ms: timings.yolo_inference.timestamp - timings.screen_capture.timestamp,
        redaction_ms: timings.redaction.timestamp - timings.yolo_inference.timestamp,
        privacy_gate_ms: timings.privacy_gate.timestamp - timings.redaction.timestamp,
        server_round_trip_ms: timings.server_response.timestamp - timings.privacy_gate.timestamp,
        action_execution_ms: timings.action_execution.timestamp - timings.server_response.timestamp,
    };

    const total_client_ms = stages.dom_sanitization_ms + stages.prompt_tokenization_ms + stages.screen_capture_ms + stages.yolo_inference_ms + stages.redaction_ms + stages.privacy_gate_ms + stages.action_execution_ms;
    const total_server_ms = stages.server_round_trip_ms;
    const total_e2e_ms = timings.action_execution.timestamp - timings.planNextStep.timestamp;

    console.log("\nStage Breakdown:");
    for (const [stage, ms] of Object.entries(stages)) {
        console.log(`  ${stage.padEnd(25)} : ${ms} ms`);
    }

    console.log(`\nTotal Client : ${total_client_ms} ms`);
    console.log(`Total Server : ${total_server_ms} ms`);
    console.log(`Total E2E    : ${total_e2e_ms} ms`);

    const report = {
        metric: "e2e_latency",
        weight: 0.15,
        pages: [
            {
                url: MOCK_URL,
                stages: stages,
                total_client_ms,
                total_server_ms,
                total_e2e_ms
            }
        ],
        summary: {
            client_p50_ms: total_client_ms,
            client_p95_ms: total_client_ms,
            server_p50_ms: total_server_ms,
            server_p95_ms: total_server_ms,
            e2e_p50_ms: total_e2e_ms,
            e2e_p95_ms: total_e2e_ms
        }
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'metric5_e2e_latency.json'), JSON.stringify(report, null, 2));
    console.log(`\nReport written to reports/latest/metric5_e2e_latency.json`);
}

main();
