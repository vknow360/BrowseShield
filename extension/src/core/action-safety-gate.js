// action-safety-gate.js — Whitelist-based action validation

const ALLOWED_ACTIONS = new Set([
  "click",
  "type",
  "scroll",
  "select",
  "navigate",
  "wait",
  "done",
  "clear",
  "check",
]);

// Patterns that indicate executable code injection
const DANGEROUS_PATTERNS = [
  /javascript:/i,
  /eval\s*\(/i,
  /<script/i,
  /on\w+\s*=/i, // onclick=, onerror=, etc.
  /document\.write/i,
  /window\.location/i, // Direct location manipulation (use 'navigate' action instead)
  /fetch\s*\(/i,
  /XMLHttpRequest/i,
  /import\s*\(/i,
];

/**
 * Validate an Action JSON from the VLM.
 *
 * @param {Object} action       The parsed action JSON
 * @param {Document} document   The current page document (for target validation)
 * @returns {{ valid: boolean, reason?: string }}
 */
export function validateAction(action, document) {
  // 1. Must be a valid object with 'action' field
  if (!action || typeof action !== "object" || !action.action) {
    return { valid: false, reason: "Missing or invalid action field" };
  }

  // 2. Action type must be in whitelist
  if (!ALLOWED_ACTIONS.has(action.action)) {
    return { valid: false, reason: `Unknown action type: "${action.action}"` };
  }

  // 3. 'done' and 'wait' don't need target validation
  if (action.action === "done") return { valid: true };
  if (action.action === "wait") {
    const ms = parseInt(action.value);
    if (isNaN(ms) || ms < 0 || ms > 30000) {
      return { valid: false, reason: `Invalid wait duration: ${action.value}` };
    }
    return { valid: true };
  }

  // 4. Target must be a valid CSS selector AND exist in the DOM
  // Note: we can skip the "exist in DOM" check if document is not provided (e.g. for unit tests)
  // or we can allow the executor to handle "Element not found" errors natively.
  // But for strict safety, we check if document is provided.
  if (!action.target || typeof action.target !== "string") {
    return { valid: false, reason: "Missing target selector" };
  }

  if (document) {
    try {
      const element = document.querySelector(action.target);
      if (!element) {
        return {
          valid: false,
          reason: `Target not found in DOM: "${action.target}"`,
        };
      }
    } catch (e) {
      return {
        valid: false,
        reason: `Invalid CSS selector: "${action.target}"`,
      };
    }
  }

  // 5. Check all string fields for dangerous patterns
  const allValues = [action.target, action.value, action.reasoning].filter(
    Boolean,
  );

  for (const val of allValues) {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(val)) {
        return {
          valid: false,
          reason: `Dangerous pattern detected in "${val}"`,
        };
      }
    }
  }

  // 6. For 'type' actions, value is required
  if (
    action.action === "type" &&
    (action.value === undefined || action.value === null)
  ) {
    return { valid: false, reason: "Type action requires a value" };
  }

  // 7. For 'scroll', target can be "window" or a valid selector, and value must be 'up' or 'down'
  if (action.action === "scroll") {
    if (!["up", "down"].includes(action.value)) {
      return {
        valid: false,
        reason: `Invalid scroll direction: "${action.value}"`,
      };
    }
  }

  return { valid: true };
}
