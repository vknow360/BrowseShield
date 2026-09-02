// src/core/local-agent.js

/**
 * A lightweight rule-based + keyword-matching local decision engine.
 * Decides whether the client can handle the task locally without contacting the server.
 * 
 * @param {string} taskInstruction - The user's input task
 * @param {Array} sanitizedNodes - The current DOM nodes
 * @returns {Object} { canHandle: boolean, action: Object|null }
 */
export function tryLocalAction(taskInstruction, sanitizedNodes = []) {
  const task = String(taskInstruction || "").toLowerCase().trim();
  const words = new Set(task.split(/\s+/));
  
  // 1. Scroll — any sentence containing "scroll" + direction word
  if (words.has("scroll") || words.has("down") || words.has("up")) {
    if (task.includes("down") || task.includes("bottom")) {
      return { canHandle: true, action: { action: "scroll", target: "window", value: "down", reasoning: "Local decision: scrolling down" } };
    }
    if (task.includes("up") || task.includes("top")) {
      return { canHandle: true, action: { action: "scroll", target: "window", value: "up", reasoning: "Local decision: scrolling up" } };
    }
  }
  
  // 2. Cookie/consent — broad keyword match
  if (/cookie|consent|banner|popup/i.test(task) && /dismiss|accept|agree|close|click/i.test(task)) {
    const btn = sanitizedNodes.find(n => 
      n.tagName === 'BUTTON' && /accept|dismiss|got it|agree|close|ok|allow/i.test(n.label || n.value || '')
    );
    if (btn) return { canHandle: true, action: { action: "click", target: btn.selector, reasoning: "Local decision: dismiss consent banner" } };
  }

  // 3. Close/dismiss modal — fuzzy
  if (/close|dismiss|exit|cancel/i.test(task) && /popup|modal|dialog|overlay|banner/i.test(task)) {
    const closeBtn = sanitizedNodes.find(n => 
      n.tagName === 'BUTTON' && /^(x|close|cancel|dismiss|✕|×)$/i.test((n.label || n.value || '').trim())
    );
    if (closeBtn) return { canHandle: true, action: { action: "click", target: closeBtn.selector, reasoning: "Local decision: closing popup/modal" } };
  }
  
  return { canHandle: false, action: null };
}
