/// <reference types="chrome" />

// src/content/index.js
// Content Script Orchestrator: Injected into live web pages

import { extractPageStructure } from './dom-walker.js';
import { debounce } from '../utils/debounce.js';

console.log('[ShieldBrowse] Content script active on:', window.location.href);

// Core scan function
function scanAndEmit() {
  const pageStructure = extractPageStructure(document.body);

  console.log('[ShieldBrowse] Scanned DOM:', pageStructure.nodes.length, 'interactive nodes.');

  chrome.runtime.sendMessage({
    type: 'ping',
    payload: {
      url: pageStructure.url,
      title: pageStructure.title,
      timestamp: Date.now(),
      fieldsCount: pageStructure.nodes.length,
      fields: pageStructure.nodes
    }
  }).catch((err) => {
    // Ignored if service worker or side panel is not actively listening
  });
}

// 1. Initial scan on document load
scanAndEmit();

// 2. Debounced live listeners for user input or profile changes
const debouncedScan = debounce(scanAndEmit, 100);

document.addEventListener('input', debouncedScan);
document.addEventListener('change', debouncedScan);
