# End-to-End Latency + Browser JS Heap

- Generated: 2026-09-02T09:53:53.849Z
- Base URL: http://localhost:3000
- Pages: 7/7 succeeded

## Aggregate (successful runs)

| Metric | p50 | p95 |
|---|---:|---:|
| Navigation (ms) | 1240 | 2747 |
| Initial (idle-load) scan (ms) | 19 | 327 |
| Final (post-fill) scan (ms) | 13 | 137 |
| End-to-end (ms) | 9425 | 11083 |
| Page V8 heap (MB) | 6.11 | 7.68 |
| Extension SW heap (MB) | null | null |

## Per-page

| Page | ok | nav ms | initial scan | final scan | e2e ms | page heap MB | SW heap MB | PII (initial→final) | scans |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| /index.html | ✅ | 1438 | 93 | 2 | 9597 | 6.18 | — | 6→6 | 2 |
| /healthcare.html | ✅ | 2747 | 327 | 137 | 11083 | 7.68 | — | 20→20 | 2 |
| /banking.html | ✅ | 1229 | 19 | 10 | 9400 | 6 | — | 0→3 | 2 |
| /government.html | ✅ | 1243 | 14 | 15 | 9425 | 6.11 | — | 0→4 | 2 |
| /adversarial.html | ✅ | 1240 | 16 | 11 | 9395 | 6.06 | — | 1→1 | 3 |
| /obfuscated.html | ✅ | 1170 | 17 | 13 | 9330 | 6 | — | 1→1 | 2 |
| /canvas-form.html | ✅ | 1171 | 27 | 23 | 9857 | 6.94 | — | 0→4 | 4 |

Notes:
- "Initial scan" = first `[ShieldBrowse] Detected …` log after page load (idle DOM).
- "Final scan" = last scan of the debounced burst after `#quickFillBtn` click; represents worst-case for pages that expose the synthetic fill.
- "Page V8 heap" = `Performance.getMetrics.JSHeapUsedSize` on the page target (content-script + page JS).
- "Extension SW heap" = `Runtime.getHeapUsage.usedSize` on the extension's MV3 service-worker target.