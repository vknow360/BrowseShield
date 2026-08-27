const STRUCTURED_TYPES = new Set([
  'AADHAAR','PAN','PHONE','EMAIL','CREDIT_CARD','IFSC','PINCODE','PASSPORT','VEHICLE','BANK_ACCOUNT'
]);

export function validateOutboundPayload(serializedPayload, tokenMap) {
  const violations = [];
  if (!tokenMap || typeof tokenMap !== 'object') return { allowed: true, violations };

  for (const [token, data] of Object.entries(tokenMap)) {
    const v = data?.realValue;
    if (!v || typeof v !== 'string' || v.trim().length <= 2) continue;
    
    // Strict substring match for structured data; Case-insensitive match for names/addresses
    const hit = STRUCTURED_TYPES.has(data.entityType)
      ? serializedPayload.includes(v)
      : serializedPayload.toLowerCase().includes(v.toLowerCase());
      
    if (hit) violations.push({ token, realValue: v, entityType: data.entityType });
  }
  
  return { allowed: violations.length === 0, violations };
}

// enforcement: 'block' (default) or 'warn'
export function privacyGate(outboundPayload, tokenMap, enforcement = 'block') {
  const serialized = JSON.stringify(outboundPayload);
  const result = validateOutboundPayload(serialized, tokenMap);
  
  if (!result.allowed && enforcement === 'block') {
    console.error('[ShieldBrowse] 🔒 PRIVACY GATE BLOCKED — raw PII in outbound:',
      result.violations.map(v => `${v.entityType} "${v.realValue}" should be ${v.token}`));
  }
  
  return { ...result, serialized };
}
