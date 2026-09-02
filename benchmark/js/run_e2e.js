// End-to-end latency + browser JS heap benchmark.
//
// Loads the *built* extension (extension/dist) in a real Chromium via Puppeteer,
// visits each mock-site page, and records per page:
//   - navMs           : navigation time (goto -> networkidle2)
//   - scanMs          : extension-reported scan time (last scan of the burst,
//                       parsed from "[ShieldBrowse] Detected ... in Xms")
//   - initialScanMs   : first scan after load (idle-load number)
//   - endToEndMs      : goto-start -> last-scan-complete
//   - pageHeapMB      : page V8 heap (Performance.getMetrics.JSHeapUsedSize)
//                       after final scan
//   - swHeapMB        : extension service-worker heap
//                       (Runtime.getHeapUsage on the SW target) after final scan
//   - piiFound        : count of items the extension redacted at final scan
//   - scans           : total number of scans observed during the visit
//
// Why we wait for a "burst" of scans: on pages that expose #quickFillBtn the
// harness clicks it AFTER load; the mock site fills fields and dispatches
// `input` events, which the extension debounces (100ms) and rescans. The
// meaningful latency+PII number is that post-fill rescan, not the empty
// initial scan. We settle when no new scan log arrives for SCAN_SETTLE_MS.
//
// Aggregates report p50/p95 across pages and writes JSON + Markdown to
// reports/latest/.
//
// Usage:
//   node benchmark/js/run_e2e.js                # default: all mock pages, base=http://localhost:3000
//   node benchmark/js/run_e2e.js http://localhost:3000/banking.html
//   BASE_URL=http://localhost:3000 node benchmark/js/run_e2e.js

import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = path.resolve(__dirname, '../../extension/dist');
const REPORT_DIR = path.resolve(__dirname, '../../reports/latest');

const DEFAULT_PAGES = [
    'index.html',
    'healthcare.html',
    'banking.html',
    'government.html',
    'adversarial.html',
    'obfuscated.html',
    'canvas-form.html',
];

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
// Total per-page budget. Must be generous enough for a cold Tesseract.js
// worker (canvas-form.html): first OCR downloads eng.traineddata + spins the
// WASM worker, typically 5-15s on a warm machine. After that first page the
// worker is cached and later pages settle in <2s.
const SCAN_TIMEOUT_MS = Number(process.env.SCAN_TIMEOUT_MS || 60000);
// After the last observed [ShieldBrowse] scan log, wait this long for another
// one. If none arrives, we consider the burst settled. Must exceed the
// content script's 100ms debounce with headroom for tokenizer work AND for
// the async canvas OCR path (SW OCR -> inject synthetic nodes -> rescan).
const SCAN_SETTLE_MS = Number(process.env.SCAN_SETTLE_MS || 8000);

function percentile(arr, p) {
    if (arr.length === 0) return null;
    const s = [...arr].sort((a, b) => a - b);
    const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
    return s[idx];
}

async function launchBrowser() {
    if (!fs.existsSync(EXTENSION_PATH)) {
        throw new Error(`Extension not built: ${EXTENSION_PATH} does not exist. Run 'npm run build' in extension/.`);
    }
    // MV3 extensions require a headed or 'new' headless context with the
    // --load-extension / --disable-extensions-except flag pair.
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

// Find (or wait for) the extension's MV3 service-worker target and return a
// CDP session bound to it. The SW is spawned by Chromium when the extension
// loads and again when the content script sends its first runtime message.
async function getServiceWorkerSession(browser) {
    const isExtSW = t =>
        t.type() === 'service_worker' && t.url().startsWith('chrome-extension://');
    let target = browser.targets().find(isExtSW);
    if (!target) {
        try {
            target = await browser.waitForTarget(isExtSW, { timeout: 5000 });
        } catch {
            return null;
        }
    }
    try {
        const session = await target.createCDPSession();
        await session.send('Runtime.enable');
        return { session, url: target.url() };
    } catch {
        return null;
    }
}

async function sampleSwHeapMB(swInfo) {
    if (!swInfo) return null;
    try {
        // Runtime.getHeapUsage returns { usedSize, totalSize } in bytes.
        const { usedSize } = await swInfo.session.send('Runtime.getHeapUsage');
        return Number((usedSize / 1048576).toFixed(2));
    } catch {
        return null;
    }
}

async function benchOne(browser, url, swInfo) {
    const page = await browser.newPage();
    const client = await page.target().createCDPSession();
    await client.send('Performance.enable');

    // All scan events observed on this page; the last one is the "final" scan
    // after any user-triggered rescan burst.
    const scans = []; // [{scanMs, piiFound, at}]
    let lastScanAt = 0;
    let settleTimer = null;
    let resolveSettled, rejectSettled;
    const settled = new Promise((resolve, reject) => {
        resolveSettled = resolve;
        rejectSettled = reject;
    });
    const hardTimeout = setTimeout(
        () => rejectSettled(new Error(`Scan timeout after ${SCAN_TIMEOUT_MS} ms (observed ${scans.length} scans)`)),
        SCAN_TIMEOUT_MS,
    );

    const armSettle = () => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
            clearTimeout(hardTimeout);
            resolveSettled();
        }, SCAN_SETTLE_MS);
    };

    page.on('console', msg => {
        const text = msg.text();
        const m = text.match(/\[ShieldBrowse\] Detected (\d+) PII items across \d+ nodes in (\d+)ms/);
        if (m) {
            scans.push({ piiFound: Number(m[1]), scanMs: Number(m[2]), at: Date.now() });
            lastScanAt = Date.now();
            armSettle();
        }
    });

    const t0 = Date.now();
    let navMs = null;
    let endToEndMs = null;
    try {
        const navStart = Date.now();
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });
        navMs = Date.now() - navStart;

        // Wait for the initial scan to actually happen before clicking, so its
        // debounced rescan on the fill isn't merged into the same run. If no
        // scan has been observed yet, wait briefly for one.
        if (scans.length === 0) {
            await new Promise(r => setTimeout(r, 300));
        }

        // Prefer the page's own #quickFillBtn (matches user-facing demo flow);
        // fall back to a heuristic auto-fill that populates common PII fields
        // so pages without a demo button still exercise the detector's full
        // post-fill rescan path instead of reporting idle-load numbers.
        const fillBtn = await page.$('#quickFillBtn');
        let filledCount = 0;
        if (fillBtn) {
            await fillBtn.click();
        } else {
            filledCount = await page.evaluate(() => {
                // Realistic synthetic PII with valid Aadhaar Verhoeff, PAN, IFSC,
                // Indian phone, credit card (Luhn). Used only as fill input; no
                // ground-truth scoring depends on these.
                const PII = {
                    aadhaar:        '234123412346',      // Verhoeff-valid
                    pan:            'ABCDE1234F',
                    'pan-number':   'ABCDE1234F',
                    ifsc:           'HDFC0001234',
                    'ifsc-code':    'HDFC0001234',
                    phone:          '+91 98765 43210',
                    mobile:         '+91 98765 43210',
                    email:          'rahul.sharma@example.com',
                    fullName:       'Rahul Sharma',
                    name:           'Rahul Sharma',
                    address:        '221B Baker Street, Bengaluru, Karnataka',
                    pincode:        '560001',
                    city:           'Bengaluru',
                    'credit-card':  '4111 1111 1111 1111',
                    amount:         '10000',
                    dob:            '1990-05-14',
                };
                const fill = (el, v) => {
                    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                        el.value = v;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                };
                let n = 0;
                // 1) Match by exact id.
                for (const [id, v] of Object.entries(PII)) {
                    const el = document.getElementById(id);
                    if (el && fill(el, v)) n++;
                }
                // 2) Fallback: fill remaining empty text-like inputs by type.
                const byType = {
                    email: PII.email,
                    tel: PII.phone,
                    number: PII.amount,
                    date: PII.dob,
                };
                document.querySelectorAll('input,textarea').forEach(el => {
                    if (el.value) return;
                    const v = byType[el.type] || PII.fullName;
                    if (fill(el, v)) n++;
                });
                document.dispatchEvent(new Event('change', { bubbles: true }));
                return n;
            });
        }
        // Always arm the settle timer at least once so pages that emit no
        // scan (should not happen, but defensive) don't hang forever.
        armSettle();

        await settled;
        endToEndMs = Date.now() - t0;

        // Sample page V8 heap (page-side, not the extension) and the extension
        // service-worker heap immediately after the final scan.
        const metrics = await client.send('Performance.getMetrics');
        const jsHeap = metrics.metrics.find(m => m.name === 'JSHeapUsedSize');
        const pageHeapMB = jsHeap ? Number((jsHeap.value / 1048576).toFixed(2)) : null;
        const swHeapMB = await sampleSwHeapMB(swInfo);

        const initial = scans[0] || null;
        const final = scans[scans.length - 1] || null;

        return {
            url,
            ok: true,
            navMs,
            initialScanMs: initial ? initial.scanMs : null,
            scanMs: final ? final.scanMs : null,
            endToEndMs,
            pageHeapMB,
            swHeapMB,
            piiFound: final ? final.piiFound : null,
            piiFoundInitial: initial ? initial.piiFound : null,
            scans: scans.length,
        };
    } catch (e) {
        return {
            url,
            ok: false,
            error: String(e.message || e),
            navMs,
            scanMs: scans.length ? scans[scans.length - 1].scanMs : null,
            endToEndMs: endToEndMs ?? Date.now() - t0,
            scans: scans.length,
        };
    } finally {
        if (settleTimer) clearTimeout(settleTimer);
        clearTimeout(hardTimeout);
        await page.close();
    }
}

async function main() {
    const explicit = process.argv[2];
    const urls = explicit
        ? [explicit]
        : DEFAULT_PAGES.map(p => `${BASE_URL}/${p}`);

    console.log(`Extension: ${EXTENSION_PATH}`);
    console.log(`Pages: ${urls.length}`);

    const browser = await launchBrowser();
    // Warm up the SW: opening a blank tab is often enough for Chromium to
    // register the extension SW target. If not, benchOne's first ping still
    // wakes it and getServiceWorkerSession will pick it up before sampling.
    const warmup = await browser.newPage();
    await warmup.goto('about:blank');
    await warmup.close();
    let swInfo = await getServiceWorkerSession(browser);
    console.log(`Service worker: ${swInfo ? swInfo.url : 'NOT FOUND (swHeapMB will be null)'}`);

    const samples = [];
    try {
        for (const url of urls) {
            process.stdout.write(`  -> ${url} ... `);
            // Re-acquire SW session lazily in case Chromium re-spawned it.
            if (!swInfo) swInfo = await getServiceWorkerSession(browser);
            const r = await benchOne(browser, url, swInfo);
            if (r.ok) {
                console.log(
                    `ok  nav=${r.navMs}ms  scan=${r.scanMs}ms  e2e=${r.endToEndMs}ms` +
                    `  pageHeap=${r.pageHeapMB}MB  swHeap=${r.swHeapMB}MB` +
                    `  pii=${r.piiFound} (initial=${r.piiFoundInitial}, scans=${r.scans})`,
                );
            } else {
                console.log(`FAIL ${r.error}`);
            }
            samples.push(r);
        }
    } finally {
        await browser.close();
    }

    const ok = samples.filter(s => s.ok);
    const swSamples = ok.map(s => s.swHeapMB).filter(v => v != null);
    const summary = {
        base_url: BASE_URL,
        extension_path: EXTENSION_PATH,
        total: samples.length,
        succeeded: ok.length,
        failed: samples.length - ok.length,
        latency: {
            navMs:         { p50: percentile(ok.map(s => s.navMs), 50),         p95: percentile(ok.map(s => s.navMs), 95) },
            scanMs:        { p50: percentile(ok.map(s => s.scanMs), 50),        p95: percentile(ok.map(s => s.scanMs), 95) },
            initialScanMs: { p50: percentile(ok.map(s => s.initialScanMs), 50), p95: percentile(ok.map(s => s.initialScanMs), 95) },
            endToEndMs:    { p50: percentile(ok.map(s => s.endToEndMs), 50),    p95: percentile(ok.map(s => s.endToEndMs), 95) },
        },
        pageHeapMB: {
            p50: percentile(ok.map(s => s.pageHeapMB), 50),
            p95: percentile(ok.map(s => s.pageHeapMB), 95),
            max: ok.reduce((a, s) => Math.max(a, s.pageHeapMB || 0), 0) || null,
        },
        swHeapMB: {
            p50: percentile(swSamples, 50),
            p95: percentile(swSamples, 95),
            max: swSamples.length ? Math.max(...swSamples) : null,
            samples: swSamples.length,
        },
        samples,
        generated_at: new Date().toISOString(),
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const jsonPath = path.join(REPORT_DIR, 'e2e_latency.json');
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));

    const md = [];
    md.push('# End-to-End Latency + Browser JS Heap');
    md.push('');
    md.push(`- Generated: ${summary.generated_at}`);
    md.push(`- Base URL: ${summary.base_url}`);
    md.push(`- Pages: ${summary.succeeded}/${summary.total} succeeded`);
    md.push('');
    md.push('## Aggregate (successful runs)');
    md.push('');
    md.push('| Metric | p50 | p95 |');
    md.push('|---|---:|---:|');
    md.push(`| Navigation (ms) | ${summary.latency.navMs.p50} | ${summary.latency.navMs.p95} |`);
    md.push(`| Initial (idle-load) scan (ms) | ${summary.latency.initialScanMs.p50} | ${summary.latency.initialScanMs.p95} |`);
    md.push(`| Final (post-fill) scan (ms) | ${summary.latency.scanMs.p50} | ${summary.latency.scanMs.p95} |`);
    md.push(`| End-to-end (ms) | ${summary.latency.endToEndMs.p50} | ${summary.latency.endToEndMs.p95} |`);
    md.push(`| Page V8 heap (MB) | ${summary.pageHeapMB.p50} | ${summary.pageHeapMB.p95} |`);
    md.push(`| Extension SW heap (MB) | ${summary.swHeapMB.p50} | ${summary.swHeapMB.p95} |`);
    md.push('');
    md.push('## Per-page');
    md.push('');
    md.push('| Page | ok | nav ms | initial scan | final scan | e2e ms | page heap MB | SW heap MB | PII (initial→final) | scans |');
    md.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const s of samples) {
        const p = s.url.replace(summary.base_url, '');
        if (s.ok) {
            md.push(
                `| ${p} | ✅ | ${s.navMs} | ${s.initialScanMs ?? '—'} | ${s.scanMs ?? '—'} | ${s.endToEndMs} | ` +
                `${s.pageHeapMB ?? '—'} | ${s.swHeapMB ?? '—'} | ${s.piiFoundInitial ?? '—'}→${s.piiFound ?? '—'} | ${s.scans} |`
            );
        } else {
            md.push(`| ${p} | ❌ | ${s.navMs ?? '—'} | — | — | ${s.endToEndMs} | — | — | — | ${s.scans} |`);
        }
    }
    md.push('');
    md.push('Notes:');
    md.push('- "Initial scan" = first `[ShieldBrowse] Detected …` log after page load (idle DOM).');
    md.push('- "Final scan" = last scan of the debounced burst after `#quickFillBtn` click; represents worst-case for pages that expose the synthetic fill.');
    md.push('- "Page V8 heap" = `Performance.getMetrics.JSHeapUsedSize` on the page target (content-script + page JS).');
    md.push('- "Extension SW heap" = `Runtime.getHeapUsage.usedSize` on the extension\'s MV3 service-worker target.');
    fs.writeFileSync(path.join(REPORT_DIR, 'e2e_latency.md'), md.join('\n'));

    console.log(`\nWrote ${jsonPath}`);
    console.log(`Wrote ${path.join(REPORT_DIR, 'e2e_latency.md')}`);
    console.log(
        `Summary: e2e p50=${summary.latency.endToEndMs.p50}ms p95=${summary.latency.endToEndMs.p95}ms  ` +
        `pageHeap p50=${summary.pageHeapMB.p50}MB  swHeap p50=${summary.swHeapMB.p50}MB (n=${summary.swHeapMB.samples})`,
    );
}

main().catch(e => {
    console.error('E2E harness failed:', e);
    process.exit(1);
});
