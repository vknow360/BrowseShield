import {
  isValidAadharNumber,
  isValidPan,
  isValidPhoneNumber,
  isValidEmail,
  isValidCreditCard,
  isValidIFSC,
  isValidPincode,
} from "./regex.js";
import { detectSemanticPII, initNERPipeline } from "./ner-pipeline.js";
import { detectMedicalTerms } from "./medical-gazetteer.js";

// Call this early in the content script lifecycle
export async function initDetectors() {
  await initNERPipeline();
}

const LABEL_PATTERNS = {
  PERSON: [
    "name",
    "full name",
    "patient name",
    "beneficiary",
    "nominee",
    "contact person",
    "नाम",
    "पूरा नाम",
    "रोगी का नाम",
    "लाभार्थी",
  ],
  DATE_OF_BIRTH: [
    "dob",
    "date of birth",
    "birth date",
    "birthday",
    "जन्म तिथि",
    "जन्म तारीख",
  ],
  ADDRESS: [
    "address",
    "street",
    "locality",
    "house no",
    "flat no",
    "पता",
    "गली",
    "मकान नंबर",
  ],
  CITY: ["city", "district", "town", "शहर", "जिला", "नगर"],
  STATE: ["state", "province", "राज्य", "प्रांत"],
  PASSWORD: ["password", "pwd", "passcode", "पासवर्ड"],
  AADHAAR: ["aadhaar", "adhar", "uidai", "आधार"],
  IMAGE: [
    "photo",
    "avatar",
    "profile",
    "headshot",
    "id card",
    "document",
    "scan",
    "image",
    "फोटो",
    "चित्र",
    "दस्तावेज़",
  ],
};

/**
 * Inspects a single DOM node's value and metadata to detect PII.
 * @param {Object} node Extracted node from dom-walker
 * @returns {Promise<Object|null>} Detection result or null if not PII
 */
export async function detectFieldPII(node) {
  const value = String(node.value || "").trim();
  const label = String(node.label || "").toLowerCase();
  const type = String(node.type || "").toLowerCase();
  const autocomplete = String(node.autocomplete || "").toLowerCase();
  const id = String(node.id || "").toLowerCase();



  // If node has no value, skip value-based matching (unless it's a password type)
  if (!value && type !== "password") return null;

  // -------------------------------------------------------------
  // LAYER 1: Mathematical Regex & Checksum Detection (High Precision)
  // -------------------------------------------------------------
  const extractAndValidate = (text, regex, validator) => {
    // Clean common label prefixes that might merge with values in OCR
    const cleanText = text.replace(/^(pan|aadhaar|adhar|uid|phone|email|dob|pin|pincode|card|ifsc)[\s:-]+/i, "").trim();
    const matches = cleanText.match(regex);
    if (!matches) return false;
    return matches.some((m) => validator(m));
  };

  if (extractAndValidate(value, /\b(?:\d[\s-]*){12}\b/g, isValidAadharNumber)) {
    return {
      isPII: true,
      entityType: "AADHAAR",
      confidence: 1.0,
      source: "checksum-verhoeff",
    };
  }
  if (extractAndValidate(value, /\b[A-Za-z]{5}[\s-]*[0-9]{4}[\s-]*[A-Za-z]{1}\b/g, isValidPan)) {
    return {
      isPII: true,
      entityType: "PAN",
      confidence: 0.98,
      source: "regex-pan",
    };
  }
  if (extractAndValidate(value, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, isValidEmail)) {
    return {
      isPII: true,
      entityType: "EMAIL",
      confidence: 0.95,
      source: "regex-email",
    };
  }
  if (extractAndValidate(value, /(?:\+91[\s-]?)?[6-9](?:[\s-]*\d){9}\b/g, isValidPhoneNumber)) {
    return {
      isPII: true,
      entityType: "PHONE",
      confidence: 0.95,
      source: "regex-phone",
    };
  }
  if (extractAndValidate(value, /\b(?:\d[\s-]*){13,19}\b/g, isValidCreditCard)) {
    return {
      isPII: true,
      entityType: "CREDIT_CARD",
      confidence: 1.0,
      source: "checksum-luhn",
    };
  }
  if (extractAndValidate(value, /\b[A-Za-z]{4}[\s-]*0[\s-]*[A-Za-z0-9]{6}\b/g, isValidIFSC)) {
    return {
      isPII: true,
      entityType: "IFSC",
      confidence: 0.95,
      source: "regex-ifsc",
    };
  }
  if (
    extractAndValidate(value, /\b[1-9]\d{5}\b/g, isValidPincode) &&
    (label.includes("pin") || autocomplete.includes("postal"))
  ) {
    return {
      isPII: true,
      entityType: "PINCODE",
      confidence: 0.9,
      source: "regex-pincode",
    };
  }

  // -------------------------------------------------------------
  // LAYER 2: Local semantic detection & Gazetteer (Free-text)
  // -------------------------------------------------------------
  if (node.tagName !== "BUTTON") {
    // Hard negative guard for short phrases with numbers/years (e.g. "Founded in 1923")
    const isHardNegative = /^(founded|established)\s+in\s+\d{4}$/i.test(value);
    
    if (!isHardNegative) {
      let allEntities = [];
      
      const medicalEntities = detectMedicalTerms(value);
      if (medicalEntities.length > 0) allEntities.push(...medicalEntities);

      const semanticEntities = await detectSemanticPII(value);
      if (semanticEntities && semanticEntities.length > 0) {
        allEntities.push(...semanticEntities);
      }

      if (allEntities.length > 0) {
        // Sort by confidence to get the strongest detection
        allEntities.sort((a, b) => b.confidence - a.confidence);
        const primaryEntity = allEntities[0];
        
        return {
          isPII: true,
          entityType: primaryEntity.entityType,
          confidence: primaryEntity.confidence,
          source: primaryEntity.source,
        };
      }
    }
  }

  // -------------------------------------------------------------
  // LAYER 3: DOM Attribute & Label Heuristics (Safety Net)
  // -------------------------------------------------------------
  if (type === "password") {
    return {
      isPII: true,
      entityType: "PASSWORD",
      confidence: 1.0,
      source: "dom-type",
    };
  }
  // Name check (label matching or autocomplete)
  if (
    LABEL_PATTERNS.PERSON.some((kw) => label.includes(kw)) ||
    autocomplete === "name" ||
    (node.dataset?.syntheticOcr === "true" && LABEL_PATTERNS.PERSON.some((kw) => value.toLowerCase().includes(kw)))
  ) {
    return {
      isPII: true,
      entityType: "PERSON",
      confidence: 0.85,
      source: "dom-heuristic",
    };
  }
  // Aadhaar check (fallback for fake data)
  if (
    LABEL_PATTERNS.AADHAAR.some((kw) => label.includes(kw)) ||
    (node.dataset?.syntheticOcr === "true" && LABEL_PATTERNS.AADHAAR.some((kw) => value.toLowerCase().includes(kw)))
  ) {
    return {
      isPII: true,
      entityType: "AADHAAR",
      confidence: 0.85,
      source: "dom-heuristic",
    };
  }
  // DOB check
  if (
    LABEL_PATTERNS.DATE_OF_BIRTH.some((kw) => label.includes(kw)) ||
    type === "date" ||
    autocomplete === "bday" ||
    (node.dataset?.syntheticOcr === "true" && LABEL_PATTERNS.DATE_OF_BIRTH.some((kw) => value.toLowerCase().includes(kw)))
  ) {
    return {
      isPII: true,
      entityType: "DATE_OF_BIRTH",
      confidence: 0.85,
      source: "dom-heuristic",
    };
  }
  // Address check
  if (
    LABEL_PATTERNS.ADDRESS.some((kw) => label.includes(kw)) ||
    autocomplete.includes("address") ||
    (node.dataset?.syntheticOcr === "true" && LABEL_PATTERNS.ADDRESS.some((kw) => value.toLowerCase().includes(kw)))
  ) {
    return {
      isPII: true,
      entityType: "ADDRESS",
      confidence: 0.8,
      source: "dom-heuristic",
    };
  }
  if (LABEL_PATTERNS.CITY.some((kw) => label.includes(kw))) {
    return {
      isPII: true,
      entityType: "CITY",
      confidence: 0.75,
      source: "dom-heuristic",
    };
  }
  if (LABEL_PATTERNS.STATE.some((kw) => label.includes(kw))) {
    return {
      isPII: true,
      entityType: "STATE",
      confidence: 0.75,
      source: "dom-heuristic",
    };
  }

  // Not recognized as PII
  return null;
}

/**
 * Scans an array of extracted nodes and tags each with its PII classification.
 */
export async function scanPageForPII(nodes) {
  return Promise.all(
    nodes.map(async (node) => {
      const piiResult = await detectFieldPII(node);
      return {
        ...node,
        pii: piiResult, // will be null or { isPII: true, entityType: '...', ... }
      };
    }),
  );
}
