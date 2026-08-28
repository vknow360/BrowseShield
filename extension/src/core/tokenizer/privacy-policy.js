export const DEFAULT_PRIVACY_POLICY = {
  // Category is revealed in the token; value is not. Server learns "there is an email".
  typedTokenCategories: [
    "PERSON",
    "EMAIL",
    "PHONE",
    "AADHAAR",
    "PAN",
    "CREDIT_CARD",
    "IFSC",
    "PINCODE",
    "PASSWORD",
    "ADDRESS",
    "CITY",
    "STATE",
    "DATE_OF_BIRTH",
  ],
  // Even the category leaks meaning → emit [[VALUE_N]].
  opaqueTokenCategories: ["MEDICAL", "FINANCIAL"],
  enforcement: "block", // 'block' = fail-closed (prod/demo). 'warn' = log only (dev).
  confidenceThreshold: 0.7,
};

// counters shape: { PERSON: 2, EMAIL: 1, VALUE: 5, ... }  (VALUE is the shared opaque counter)
export function generateToken(
  entityType,
  counters,
  policy = DEFAULT_PRIVACY_POLICY,
) {
  if (policy.opaqueTokenCategories.includes(entityType)) {
    counters.VALUE = (counters.VALUE || 0) + 1;
    return `[[VALUE_${counters.VALUE}]]`;
  }
  counters[entityType] = (counters[entityType] || 0) + 1;
  return `[[${entityType}_${counters[entityType]}]]`;
}
