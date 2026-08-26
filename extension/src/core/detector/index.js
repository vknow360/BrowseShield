import {
    isValidAadharNumber,
    isValidPan,
    isValidPhoneNumber,
    isValidEmail,
    isValidCreditCard,
    isValidIFSC,
    isValidPincode
} from './regex.js';

const LABEL_PATTERNS = {
    PERSON: ['name', 'full name', 'patient name', 'beneficiary', 'nominee', 'contact person'],
    DATE_OF_BIRTH: ['dob', 'date of birth', 'birth date', 'birthday'],
    ADDRESS: ['address', 'street', 'locality', 'house no', 'flat no'],
    CITY: ['city', 'district', 'town'],
    STATE: ['state', 'province'],
    PASSWORD: ['password', 'pwd', 'passcode']
};


/**
 * Inspects a single DOM node's value and metadata to detect PII.
 * @param {Object} node Extracted node from dom-walker
 * @returns {Object|null} Detection result or null if not PII
 */
export function detectFieldPII(node) {
    const value = String(node.value || '').trim();
    const label = String(node.label || '').toLowerCase();
    const type = String(node.type || '').toLowerCase();
    const autocomplete = String(node.autocomplete || '').toLowerCase();
    // If node has no value, skip value-based matching (unless it's a password type)
    if (!value && type !== 'password') return null;

    // -------------------------------------------------------------
    // LAYER 1: Mathematical Regex & Checksum Detection (High Precision)
    // -------------------------------------------------------------
    if (isValidAadharNumber(value)) {
        return { isPII: true, entityType: 'AADHAAR', confidence: 1.0, source: 'checksum-verhoeff' };
    }
    if (isValidPan(value)) {
        return { isPII: true, entityType: 'PAN', confidence: 0.98, source: 'regex-pan' };
    }
    if (isValidEmail(value) || type === 'email' || autocomplete === 'email') {
        if (isValidEmail(value)) {
            return { isPII: true, entityType: 'EMAIL', confidence: 0.95, source: 'regex-email' };
        }
    }
    if (isValidPhoneNumber(value) || type === 'tel' || autocomplete === 'tel') {
        if (isValidPhoneNumber(value)) {
            return { isPII: true, entityType: 'PHONE', confidence: 0.95, source: 'regex-phone' };
        }
    }
    if (isValidCreditCard(value)) {
        return { isPII: true, entityType: 'CREDIT_CARD', confidence: 1.0, source: 'checksum-luhn' };
    }
    if (isValidIFSC(value)) {
        return { isPII: true, entityType: 'IFSC', confidence: 0.95, source: 'regex-ifsc' };
    }
    if (isValidPincode(value) && (label.includes('pin') || autocomplete.includes('postal'))) {
        return { isPII: true, entityType: 'PINCODE', confidence: 0.90, source: 'regex-pincode' };
    }

    // -------------------------------------------------------------
    // LAYER 2: DOM Attribute & Label Heuristics (Safety Net)
    // -------------------------------------------------------------
    if (type === 'password') {
        return { isPII: true, entityType: 'PASSWORD', confidence: 1.0, source: 'dom-type' };
    }
    // Name check (label matching or autocomplete)
    if (LABEL_PATTERNS.PERSON.some((kw) => label.includes(kw)) || autocomplete === 'name') {
        return { isPII: true, entityType: 'PERSON', confidence: 0.85, source: 'dom-heuristic' };
    }
    // DOB check
    if (LABEL_PATTERNS.DATE_OF_BIRTH.some((kw) => label.includes(kw)) || type === 'date' || autocomplete === 'bday') {
        return { isPII: true, entityType: 'DATE_OF_BIRTH', confidence: 0.85, source: 'dom-heuristic' };
    }
    // Address check
    if (LABEL_PATTERNS.ADDRESS.some((kw) => label.includes(kw)) || autocomplete.includes('address')) {
        return { isPII: true, entityType: 'ADDRESS', confidence: 0.80, source: 'dom-heuristic' };
    }
    if (LABEL_PATTERNS.CITY.some((kw) => label.includes(kw))) {
        return { isPII: true, entityType: 'CITY', confidence: 0.75, source: 'dom-heuristic' };
    }
    if (LABEL_PATTERNS.STATE.some((kw) => label.includes(kw))) {
        return { isPII: true, entityType: 'STATE', confidence: 0.75, source: 'dom-heuristic' };
    }
    // Not recognized as PII
    return null;
}

/**
 * Scans an array of extracted nodes and tags each with its PII classification.
 */
export function scanPageForPII(nodes) {
    return nodes.map((node) => {
        const piiResult = detectFieldPII(node);
        return {
            ...node,
            pii: piiResult // will be null or { isPII: true, entityType: '...', ... }
        };
    });
}