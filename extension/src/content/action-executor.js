// action-executor.js — runs in content script
// Executes browser actions returned by the VLM agent

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find an element using multiple strategies, ordered by reliability:
 * 1. data-sb-id attribute (injected by DOM walker — most reliable)
 * 2. CSS selector (id-based or other valid selector)
 * 3. Fuzzy text matching (label, placeholder, name, aria-label)
 * 4. Deep keyword extraction fallback
 */
function findElement(target) {
  if (typeof target !== "string") return null;

  // Strategy 1: data-sb-id lookup (highest priority — these are stable, injected IDs)
  const sbIdMatch = target.match(/data-sb-id="([^"]+)"/);
  if (sbIdMatch) {
    const el = document.querySelector(`[data-sb-id="${sbIdMatch[1]}"]`);
    if (el) return el;
  }

  // Strategy 2: Direct CSS selector
  try {
    const el = document.querySelector(target);
    if (el) return el;
  } catch (e) {
    // target was not a valid CSS selector
  }

  // Strategy 3: Fuzzy text matching
  const textTarget = target.toLowerCase().trim().replace(/^[#.]/, '');

  // 3a. Try inputs by id, name, placeholder, aria-label
  const inputs = Array.from(document.querySelectorAll("input, textarea, select"));
  for (const input of inputs) {
    if (input.id?.toLowerCase() === textTarget) return input;
    if (input.name?.toLowerCase() === textTarget) return input;
  }
  for (const input of inputs) {
    if (input.placeholder?.toLowerCase().includes(textTarget)) return input;
    if (input.name?.toLowerCase().includes(textTarget)) return input;
    if (input.id?.toLowerCase().includes(textTarget)) return input;
    if (input.getAttribute("aria-label")?.toLowerCase().includes(textTarget)) return input;
  }

  // 3b. Try labels → find associated input
  const labels = Array.from(document.querySelectorAll("label"));
  for (const label of labels) {
    if (label.textContent?.toLowerCase().includes(textTarget)) {
      // Check for "for" attribute
      if (label.htmlFor) {
        const input = document.getElementById(label.htmlFor);
        if (input) return input;
      }
      // Check for nested input
      const nested = label.querySelector("input, textarea, select");
      if (nested) return nested;
    }
  }

  // 3c. Try buttons by text content
  const buttons = Array.from(document.querySelectorAll("button, a, [role='button'], input[type='submit'], input[type='button']"));
  for (const btn of buttons) {
    const btnText = (btn.textContent || btn.value || "").toLowerCase().trim();
    if (btnText.includes(textTarget)) return btn;
  }

  // Strategy 4: Deep keyword extraction
  const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const targetWords = cleanTarget.split(' ').filter(w =>
    w.length > 2 && !['input', 'button', 'data', 'class', 'href', 'span', 'div', 'type', 'text', 'the', 'for'].includes(w)
  );

  if (targetWords.length > 0) {
    // Score all interactive elements
    const candidates = [...inputs, ...buttons];
    let bestEl = null;
    let bestScore = 0;

    for (const el of candidates) {
      let score = 0;
      const haystack = [
        el.id, el.name, el.placeholder,
        el.getAttribute("aria-label"),
        el.textContent?.substring(0, 100),
        el.value?.substring(0, 100),
        el.className
      ].filter(Boolean).join(" ").toLowerCase();

      for (const word of targetWords) {
        if (haystack.includes(word)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestEl = el;
      }
    }

    if (bestEl && bestScore >= Math.max(1, Math.ceil(targetWords.length * 0.5))) {
      return bestEl;
    }
  }

  return null;
}

/**
 * Dispatch a realistic sequence of events to satisfy React/Angular/Vue.
 * Frameworks listen for specific events; missing ones cause silent failures.
 */
function dispatchRealisticInputEvents(element, value) {
  // Focus
  element.focus();
  element.dispatchEvent(new FocusEvent("focus", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

  // Clear existing value
  element.value = "";
  element.dispatchEvent(new Event("input", { bubbles: true }));

  // Try execCommand first (best for React controlled components)
  if (document.execCommand("insertText", false, value)) {
    // execCommand fires all the right events internally
  } else {
    // Fallback: use native setter (for frameworks that override .value)
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(element, value);
    } else {
      element.value = value;
    }

    // Fire events that frameworks listen for
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: value, inputType: "insertText" }));
  }

  // Change + blur (signal completion)
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
  element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

/**
 * Ensure element is visible and scrolled into view.
 * Returns true if the element is interactable.
 */
async function ensureVisible(element) {
  const rect = element.getBoundingClientRect();
  const isInViewport = rect.top >= 0 && rect.top < window.innerHeight;

  if (!isInViewport) {
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(400);
  }

  return true;
}


export async function executeAction(action) {
  const { action: actionType, target, value, reasoning } = action;

  console.log(
    `[ShieldBrowse] Executing: ${actionType} on ${target} (${reasoning})`,
  );

  switch (actionType) {
    case "type": {
      const element = findElement(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      await ensureVisible(element);

      // value is already rehydrated by the background script
      const realValue = value;

      // Handle multi-box single-digit OTP inputs (e.g. 6 separate input boxes)
      const digits = String(realValue).replace(/\D/g, "");
      if (digits.length >= 4 && (element.maxLength === 1 || element.id?.toLowerCase().includes("otp") || element.name?.toLowerCase().includes("otp"))) {
        const otpGroup = Array.from(document.querySelectorAll("input")).filter(inp => 
          inp.maxLength === 1 || (inp.id && inp.id.toLowerCase().includes("otp") && inp.id !== "otp-combined")
        );

        if (otpGroup.length >= digits.length) {
          console.log(`[ShieldBrowse] Distributing ${digits.length} OTP digits across individual OTP input boxes...`);
          for (let i = 0; i < digits.length; i++) {
            if (otpGroup[i]) {
              dispatchRealisticInputEvents(otpGroup[i], digits[i]);
            }
          }

          // Also set combined field if present on page
          const combined = document.querySelector("#otp-combined, input[id*='combined']");
          if (combined && combined !== element) {
            dispatchRealisticInputEvents(combined, digits);
          }

          return { success: true, action: actionType, target };
        }
      }

      // Handle date inputs specially
      if (element.type === "date") {
        // Date inputs need native setter, execCommand doesn't work
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(element, realValue);
        } else {
          element.value = realValue;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return { success: true, action: actionType, target };
      }

      dispatchRealisticInputEvents(element, realValue);
      return { success: true, action: actionType, target };
    }

    case "clear": {
      const element = findElement(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      await ensureVisible(element);

      element.focus();
      element.value = "";

      // Also try native setter for React
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      )?.set;
      if (nativeSetter) {
        nativeSetter.call(element, "");
      }

      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true, action: actionType, target };
    }

    case "check": {
      const element = findElement(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      await ensureVisible(element);

      // Toggle the checked state
      if (element.type === "checkbox" || element.type === "radio") {
        element.checked = !element.checked;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        // Also fire click for frameworks that listen on click
        element.click();
      } else {
        // It might be a toggle switch or custom element — just click it
        element.click();
      }

      return { success: true, action: actionType, target };
    }

    case "click": {
      if (
        typeof target === "object" &&
        target !== null &&
        "x" in target &&
        "y" in target
      ) {
        console.log(
          `[ShieldBrowse] Vision-grounded coordinate click at (${target.x}, ${target.y})`,
        );

        const f = action.f || 1;
        const dpr = window.devicePixelRatio || 1;
        const logicalX = target.x / (f * dpr);
        const logicalY = target.y / (f * dpr);

        const el = document.elementFromPoint(logicalX, logicalY) || document.body;
        await ensureVisible(el);
        el.click();
        return { success: true, action: actionType, target };
      }

      const element = findElement(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      await ensureVisible(element);

      // Click the element
      element.click();

      // Fallback for submit buttons
      if (
        (element.tagName === "BUTTON" && element.type === "submit") ||
        (element.tagName === "INPUT" && element.type === "submit")
      ) {
        const form = element.closest("form");
        if (form) {
          try {
            form.requestSubmit(element.tagName === "BUTTON" ? element : undefined);
            console.log("[ShieldBrowse] Dispatched form.requestSubmit() fallback");
          } catch (e) {
            console.warn("[ShieldBrowse] form.requestSubmit failed:", e);
          }
        }
      }

      return { success: true, action: actionType, target };
    }

    case "scroll": {
      const amount = value === "down" ? 500 : -500;
      window.scrollBy({ top: amount, behavior: "smooth" });
      return { success: true, action: actionType, direction: value };
    }

    case "select": {
      const element = findElement(target);
      if (!element) throw new Error(`Element not found: ${target}`);
      await ensureVisible(element);

      const realValue = value;
      const options = Array.from(element.options || []);

      // Try exact match first, then fuzzy
      let matchingOption = options.find(
        (opt) => opt.text.toLowerCase().trim() === realValue.toLowerCase().trim()
      );
      if (!matchingOption) {
        matchingOption = options.find(
          (opt) => opt.value.toLowerCase().trim() === realValue.toLowerCase().trim()
        );
      }
      if (!matchingOption) {
        matchingOption = options.find(
          (opt) =>
            opt.text.toLowerCase().includes(realValue.toLowerCase()) ||
            opt.value.toLowerCase().includes(realValue.toLowerCase()),
        );
      }

      if (matchingOption) {
        element.value = matchingOption.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        throw new Error(`No matching option for value "${realValue}" in ${target}`);
      }

      return { success: true, action: actionType, target };
    }

    case "navigate": {
      const realValue = value;
      window.location.href = realValue;
      return { success: true, action: actionType };
    }

    case "wait": {
      await sleep(parseInt(value) || 1000);
      return { success: true, action: actionType };
    }

    case "done": {
      return { success: true, action: "done", reasoning };
    }

    default:
      throw new Error(`Unknown action type: ${actionType}`);
  }
}
