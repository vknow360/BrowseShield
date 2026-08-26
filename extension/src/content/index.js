/// <reference types="chrome" />

// src/content/index.js
// Content Script Orchestrator: Injected into live web pages

import { extractPageStructure } from './dom-walker.js';
import { debounce } from '../utils/debounce.js';
import { scanPageForPII } from '../core/detector/index.js';

console.log('[ShieldBrowse] Content script active on:', window.location.href);

// Core scan function
function scanAndEmit() {
  const startTime = performance.now();

  const pageStructure = extractPageStructure(document.body);

  const taggedNodes = scanPageForPII(pageStructure.nodes);

  const piiList = taggedNodes
    .filter((node) => node.pii && node.pii.isPII)
    .map((node) => ({
      fieldId: node.id,
      label: node.label,
      value: node.value,
      entityType: node.pii.entityType,
      confidence: node.pii.confidence,
      source: node.pii.source,
      selector: node.selector
    }));

  const scanTimeMs = Math.round(performance.now() - startTime);

  console.log(`[ShieldBrowse] Detected ${piiList.length} PII items across ${taggedNodes.length} nodes in ${scanTimeMs}ms.`);

  chrome.runtime.sendMessage({
    type: 'ping',
    payload: {
      url: pageStructure.url,
      title: pageStructure.title,
      timestamp: Date.now(),
      metrics: {
        totalNodes: taggedNodes.length,
        piiCount: piiList.length,
        scanTimeMs: scanTimeMs
      },
      piiList: piiList,
      fields: taggedNodes
    }
  }).catch(() => { });
}

// 1. Initial scan on document load
scanAndEmit();

// 2. Debounced live listeners for user input or profile changes
const debouncedScan = debounce(scanAndEmit, 100);

document.addEventListener('input', debouncedScan);
document.addEventListener('change', debouncedScan);
