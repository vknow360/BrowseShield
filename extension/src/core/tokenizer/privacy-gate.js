const STRUCTURED_TYPES = new Set([
  "AADHAAR",
  "PAN",
  "PHONE",
  "EMAIL",
  "CREDIT_CARD",
  "IFSC",
  "PINCODE",
  "PASSPORT",
  "VEHICLE",
  "BANK_ACCOUNT",
]);

export function validateOutboundPayload(payload, tokenMap) {
  const violations = [];
  if (!tokenMap || typeof tokenMap !== "object")
    return { allowed: true, violations };

  // Fields where raw PII is expected to be redacted.
  // We explicitly IGNORE structural fields like selector, id, name, tagName, url.
  const PII_FIELDS = ["value", "label", "placeholder", "alt", "textContent"];

  // Recursively extract all strings from the PII_FIELDS
  const stringsToCheck = [];
  function extractStrings(obj) {
    if (!obj) return;
    if (Array.isArray(obj)) {
      obj.forEach(extractStrings);
    } else if (typeof obj === "object") {
      if (obj.nodes) extractStrings(obj.nodes);
      else {
        for (const key of PII_FIELDS) {
          if (typeof obj[key] === "string" && obj[key].trim().length > 0) {
            stringsToCheck.push(obj[key]);
          }
        }
      }
    }
  }
  extractStrings(payload);
  const combinedText = stringsToCheck.join(" | ");

  for (const [token, data] of Object.entries(tokenMap)) {
    const v = data?.realValue;
    if (!v || typeof v !== "string" || v.trim().length < 4) continue;

    const hit = STRUCTURED_TYPES.has(data.entityType)
      ? combinedText.includes(v)
      : combinedText.toLowerCase().includes(v.toLowerCase());

    if (hit)
      violations.push({ token, realValue: v, entityType: data.entityType });
  }

  return { allowed: violations.length === 0, violations };
}

// enforcement: 'block' (default) or 'warn'
export function privacyGate(outboundPayload, tokenMap, enforcement = "block") {
  const serialized = JSON.stringify(outboundPayload);
  const result = validateOutboundPayload(outboundPayload, tokenMap);

  if (!result.allowed && enforcement === "block") {
    console.error(
      "[ShieldBrowse] 🔒 PRIVACY GATE BLOCKED — raw PII in outbound:",
      result.violations.map(
        (v) => `${v.entityType} "${v.realValue}" should be ${v.token}`,
      ),
    );
  }

  return { ...result, serialized };
}
