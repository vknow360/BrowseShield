// src/core/detector/ner-pipeline.js
// Lightweight, fully on-device semantic PII detector for free-text fields.
//
// Rationale: a real transformer NER (e.g. bert-base-NER int8 ≈ 104 MB) is far too heavy
// for a "lightweight browser agent" and would blow the client-resource budget while forcing
// an off-device model download. Instead we use a compact gazetteer + contextual/capitalization
// heuristics that run instantly, ship in a few KB, and never touch the network. This detects
// free-text person names, postal addresses, and medical conditions that the structured
// regex/checksum/DOM layers cannot catch.

// Common Indian + international given names and surnames (lowercased). Deliberately compact:
// the capitalization/context heuristics generalise beyond this list, the gazetteer only raises
// confidence and catches single-token names.
const NAME_GAZETTEER = new Set([
  'aarav', 'aditya', 'akash', 'amit', 'ananya', 'anil', 'anjali', 'arjun', 'arun', 'ashok',
  'deepak', 'divya', 'gaurav', 'geeta', 'harsh', 'isha', 'kavya', 'kiran', 'kumar', 'lakshmi',
  'manish', 'meera', 'mohan', 'neha', 'nikhil', 'pooja', 'prakash', 'pranav', 'priya', 'rahul',
  'raj', 'rajesh', 'rakesh', 'ramesh', 'ravi', 'rohan', 'rohit', 'sanjay', 'sarah', 'saurabh',
  'shreya', 'siddharth', 'sneha', 'sunil', 'suresh', 'swati', 'vijay', 'vikas', 'vikram', 'vishal',
  'agarwal', 'bansal', 'chauhan', 'das', 'desai', 'gupta', 'iyer', 'jain', 'jenkins', 'joshi',
  'kapoor', 'khan', 'kulkarni', 'malhotra', 'mehta', 'menon', 'nair', 'patel', 'rao', 'reddy',
  'sharma', 'singh', 'sinha', 'verma', 'yadav', 'john', 'doe', 'smith', 'james', 'michael',
  'david', 'mary', 'robert', 'william', 'jennifer', 'linda', 'jessica'
]);

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'dr', 'shri', 'smt', 'prof', 'miss', 'sir']);

// Postal-address markers (Indian + generic). Presence of any strongly implies an ADDRESS field.
const ADDRESS_KEYWORDS = [
  'street', 'road', 'lane', 'marg', 'nagar', 'colony', 'sector', 'block', 'apartment', 'apt',
  'flat', 'house no', 'plot no', 'building', 'floor', 'avenue', 'gali', 'chowk', 'vihar', 'enclave'
];

// Common medical conditions the structured layers cannot detect in free text.
const MEDICAL_KEYWORDS = [
  'diabetes', 'hypertension', 'asthma', 'cancer', 'tumor', 'tumour', 'cardiac', 'arthritis',
  'hiv', 'aids', 'hepatitis', 'thyroid', 'anemia', 'anaemia', 'depression', 'epilepsy',
  'migraine', 'pneumonia', 'tuberculosis', 'covid', 'stroke', 'kidney', 'dialysis'
];

// Words that are frequently capitalized but are not names — reduces false positives on
// sentence-initial or common capitalized tokens.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'please', 'happy', 'dear', 'hello', 'hi', 'thanks', 'thank', 'regards',
  'this', 'that', 'today', 'tomorrow', 'yesterday', 'type', 'version', 'ref', 'no', 'india',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'
]);

let isInitialized = false;

/**
 * No heavy model to load — kept for API compatibility with the detector pipeline.
 * @returns {Promise<void>}
 */
export async function initNERPipeline() {
  if (isInitialized) return;
  isInitialized = true;
  console.log('[Detector] Lightweight on-device semantic detector ready (no network).');
}

/**
 * Detects free-text PII (person names, addresses, medical conditions) in a text string
 * using a compact gazetteer + contextual heuristics. Fully local, no network, sub-millisecond.
 * @param {string} text
 * @returns {Promise<Array<{entityType: string, value: string, confidence: number}>>}
 */
export async function detectSemanticPII(text) {
  const input = String(text || '').trim();
  if (!input || input.length > 2000) return [];

  const entities = [];

  const person = detectPersonName(input);
  if (person) entities.push(person);

  const lower = input.toLowerCase();
  if (ADDRESS_KEYWORDS.some((kw) => lower.includes(kw))) {
    entities.push({ entityType: 'ADDRESS', value: input, confidence: 0.75 });
  }
  const medical = MEDICAL_KEYWORDS.find((kw) => lower.includes(kw));
  if (medical) {
    entities.push({ entityType: 'MEDICAL', value: input, confidence: 0.8 });
  }

  return entities;
}

/**
 * Finds a person name via honorific context, gazetteer membership, or a multi-word
 * Title-Case proper-noun span. Returns the highest-confidence match or null.
 * @param {string} text
 * @returns {{entityType: string, value: string, confidence: number}|null}
 */
function detectPersonName(text) {
  // Split on whitespace so intervening numbers/punctuation break proper-noun spans
  // (e.g. "Type 2 Diabetes" must NOT read as the two-word name "Type Diabetes").
  const tokens = text.split(/\s+/).map(cleanToken).filter(Boolean);
  let best = null;

  for (let i = 0; i < tokens.length; i++) {
    const lower = tokens[i].toLowerCase();

    // 1. Honorific followed by a capitalized word → strong person signal.
    if (HONORIFICS.has(lower) && i + 1 < tokens.length && isTitleCase(tokens[i + 1])) {
      const span = collectTitleSpan(tokens, i + 1);
      if (span.count >= 1 && !span.hasStop) {
        return { entityType: 'PERSON', value: span.value, confidence: 0.9 };
      }
    }

    if (!isTitleCase(tokens[i])) continue;

    // 2. Multi-word Title-Case span (e.g. "Priya Sharma", "John Doe").
    const span = collectTitleSpan(tokens, i);
    if (span.count >= 2 && !span.hasStop) {
      const anyName = span.words.some((w) => NAME_GAZETTEER.has(w.toLowerCase()));
      const confidence = anyName ? 0.85 : 0.7;
      if (!best || confidence > best.confidence) {
        best = { entityType: 'PERSON', value: span.value, confidence };
      }
      i += span.count - 1;
      continue;
    }

    // 3. Single gazetteer name token that is not a common stopword.
    if (NAME_GAZETTEER.has(lower) && !STOPWORDS.has(lower) && !best) {
      best = { entityType: 'PERSON', value: tokens[i], confidence: 0.65 };
    }
  }

  return best;
}

/** Collects a run of consecutive Title-Case tokens starting at index `start`. */
function collectTitleSpan(tokens, start) {
  const words = [];
  let hasStop = false;
  let i = start;
  while (i < tokens.length && isTitleCase(tokens[i])) {
    words.push(tokens[i]);
    if (STOPWORDS.has(tokens[i].toLowerCase())) hasStop = true;
    i++;
  }
  return { words, count: words.length, value: words.join(' '), hasStop };
}

/** Strips surrounding punctuation, keeping internal apostrophes/hyphens (e.g. "Doe!," → "Doe"). */
function cleanToken(token) {
  return token.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
}

/** True for a single Title-Case word like "Priya" (initial uppercase, rest lowercase). */
function isTitleCase(word) {
  return /^[A-Z][a-z'-]+$/.test(word);
}
