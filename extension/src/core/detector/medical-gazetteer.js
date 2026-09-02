// src/core/detector/medical-gazetteer.js

const MEDICAL_TERMS = [
  "type 2 diabetes",
  "diabetes",
  "hypertension",
  "cancer",
  "leukemia",
  "asthma",
  "arthritis",
  "covid-19",
  "hiv",
  "tuberculosis",
  "alzheimer",
  "dementia",
  "schizophrenia",
  "bipolar disorder",
  "depression",
  "anxiety disorder",
  "parkinson",
  "epilepsy",
  "migraine",
  "stroke",
  "heart attack",
  "myocardial infarction",
  "kidney failure",
  "chronic kidney disease",
  "hepatitis",
  "cirrhosis",
  "multiple sclerosis",
  "lupus",
  "crohn's disease",
  "ulcerative colitis"
];

/**
 * Scans text for known medical conditions using a gazetteer.
 * @param {string} text 
 * @returns {Array<{entityType: string, value: string, confidence: number, source: string}>}
 */
export function detectMedicalTerms(text) {
  if (!text) return [];
  const lowerText = text.toLowerCase();
  const entities = [];

  for (const term of MEDICAL_TERMS) {
    if (lowerText.includes(term)) {
      // Basic word boundary check to avoid partial matches
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        entities.push({
          entityType: "MEDICAL",
          value: match[0],
          confidence: 0.9,
          source: "medical-gazetteer"
        });
      }
    }
  }

  return entities;
}
