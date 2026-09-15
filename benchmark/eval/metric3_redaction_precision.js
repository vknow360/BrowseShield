import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const REPORT_DIR = path.resolve(__dirname, '../../reports/latest');
const MOCK_URL = 'http://localhost:3000/healthcare.html';

const KNOWN_PII = {
    '234123412346': 'AADHAAR',
    'ABCDE1234F': 'PAN',
    '+91 98765 43210': 'PHONE',
    'rahul.sharma@example.com': 'EMAIL',
    'Rahul Sharma': 'NAME',
    '221B Baker Street, Bengaluru, Karnataka': 'ADDRESS',
    '4111 1111 1111 1111': 'CREDIT_CARD',
};

async function launchBrowser() {
    if (!fs.existsSync(EXTENSION_PATH)) {
        throw new Error(`Extension not built: ${EXTENSION_PATH} does not exist.`);
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

async function main() {
    console.log("[Metric 3] Redaction Precision Benchmark");
    console.log("===================================================\n");

    const browser = await launchBrowser();
    const page = await browser.newPage();
    
    // Listen for agent-loop network requests
    await page.setRequestInterception(true);
    
    let capturedSanitizedDom = null;
    let capturedRedactedImage = null;
    
    page.on('request', request => {
        if (request.url().includes('/agent/plan')) {
            const body = JSON.parse(request.postData() || "{}");
            if (body.sanitizedDom) capturedSanitizedDom = body.sanitizedDom;
            if (body.redactedImage) capturedRedactedImage = body.redactedImage;
        }
        request.continue();
    });

    console.log(`Navigating to ${MOCK_URL}...`);
    await page.goto(MOCK_URL, { waitUntil: 'networkidle2' });

    // Fill known PII into the mock form
    await page.evaluate((pii) => {
        const inputs = document.querySelectorAll('input');
        if (inputs.length >= 7) {
            inputs[0].value = Object.keys(pii)[0]; // Aadhaar
            inputs[1].value = Object.keys(pii)[1]; // PAN
            inputs[2].value = Object.keys(pii)[2]; // Phone
            inputs[3].value = Object.keys(pii)[3]; // Email
            inputs[4].value = Object.keys(pii)[4]; // Name
            inputs[5].value = Object.keys(pii)[5]; // Address
            inputs[6].value = Object.keys(pii)[6]; // Credit Card
            
            // Dispatch input events
            inputs.forEach(input => input.dispatchEvent(new Event('input', { bubbles: true })));
        }
    }, KNOWN_PII);

    console.log("Waiting for scan...");
    await new Promise(r => setTimeout(r, 2000));

    // Trigger VLM request to capture the sanitized payload
    const targets = await browser.targets();
    const swTarget = targets.find(t => t.type() === 'service_worker');
    if (swTarget) {
        const swSession = await swTarget.createCDPSession();
        await swSession.send('Runtime.evaluate', {
            expression: `
                browser.tabs.query({ active: true, lastFocusedWindow: true }).then(tabs => {
                    let activeTab = tabs[0];
                    if (activeTab) {
                        agentLoop.start("Fill out this form please", activeTab.id, activeTab.windowId);
                    }
                });
            `
        });
    }

    // Wait to capture request
    let waited = 0;
    while (!capturedSanitizedDom && waited < 5000) {
        await new Promise(r => setTimeout(r, 100));
        waited += 100;
    }
    
    await browser.close();

    if (!capturedSanitizedDom) {
        console.error("Failed to capture sanitized DOM payload.");
        process.exit(1);
    }

    console.log("Analyzing DOM payload for PII leaks...");
    
    const serializedDom = JSON.stringify(capturedSanitizedDom);
    
    let totalFields = Object.keys(KNOWN_PII).length;
    let leakedFields = 0;
    const details = [];

    for (const [val, type] of Object.entries(KNOWN_PII)) {
        // Strip spaces just in case formatting changes slightly
        const strippedVal = val.replace(/\s/g, '');
        const serializedNoSpaces = serializedDom.replace(/\s/g, '');
        
        const isLeaked = serializedDom.includes(val) || serializedNoSpaces.includes(strippedVal);
        
        if (isLeaked) {
            console.log(`[LEAK] Raw ${type} value "${val}" found in sanitized DOM!`);
            leakedFields++;
        }
        
        details.push({
            pii_type: type,
            leaked: isLeaked
        });
    }

    const leakRate = leakedFields / totalFields;
    
    console.log(`\nResults:`);
    console.log(`  Total Fields Evaluated: ${totalFields}`);
    console.log(`  Leaked Fields: ${leakedFields}`);
    console.log(`  Leak Rate: ${(leakRate * 100).toFixed(2)}%`);

    const report = {
        metric: "redaction_precision",
        weight: 0.20,
        dom_redaction: {
            total_pii_fields: totalFields,
            leaked_fields: leakedFields,
            leak_rate: leakRate,
            details: details
        },
        visual_redaction: {
            total_regions: 0,
            ocr_readable_regions: 0,
            leak_rate: 0.0,
            note: "OCR evaluation disabled; relying on DOM sanitization integrity"
        }
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, 'metric3_redaction_precision.json'), JSON.stringify(report, null, 2));
    console.log(`\nReport written to reports/latest/metric3_redaction_precision.json`);
}

main();
