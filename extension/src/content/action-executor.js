// action-executor.js — runs in content script

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findElement(target) {
  if (typeof target !== "string") return null;
  
  try {
    const el = document.querySelector(target);
    if (el) return el;
  } catch (e) {
    // target was not a valid CSS selector
  }

  // Fallback: Fuzzy text match for local VLMs that output labels instead of selectors
  const textTarget = target.toLowerCase().trim().replace(/^[#.]/, '');
  
  // 1. Try to find inputs by placeholder, name, id
  const inputs = Array.from(document.querySelectorAll("input, textarea"));
  for (const input of inputs) {
    if (input.placeholder?.toLowerCase().includes(textTarget)) return input;
    if (input.name?.toLowerCase().includes(textTarget)) return input;
    if (input.id?.toLowerCase().includes(textTarget)) return input;
  }

  // 2. Try to find buttons by text content
  const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"));
  for (const btn of buttons) {
    if (btn.textContent?.toLowerCase().trim().includes(textTarget)) return btn;
  }
  
  // 3. Deep fallback for hallucinated CSS selectors (e.g. input[data-sb-id="#loginform-username"])
  // Extract all meaningful words from the target string
  const cleanTarget = target.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const targetWords = cleanTarget.split(' ').filter(w => w.length > 3 && !['input', 'button', 'data', 'class', 'href', 'span', 'div'].includes(w));
  
  if (targetWords.length > 0) {
    for (const input of inputs) {
      if (targetWords.every(w => input.id?.toLowerCase().includes(w) || input.name?.toLowerCase().includes(w) || input.placeholder?.toLowerCase().includes(w))) {
        return input;
      }
    }
    for (const btn of buttons) {
      if (targetWords.every(w => btn.textContent?.toLowerCase().includes(w) || btn.id?.toLowerCase().includes(w))) {
        return btn;
      }
    }
  }

  return null;
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

      // value is already rehydrated by the background script
      const realValue = value;

      // Focus the element
      element.focus();

      // Clear existing value
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));

      // Use execCommand to simulate actual typing. This reliably triggers React/Angular
      // masking libraries and 'beforeinput' / 'input' event listeners that break when
      // the 'value' property is set directly.
      if (!document.execCommand("insertText", false, realValue)) {
        // Fallback for browsers that block execCommand
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;

        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(element, realValue);
        } else {
          element.value = realValue;
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }

      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

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
          `[ShieldBrowse] Vision-grounded physical coordinate click at (${target.x}, ${target.y})`,
        );

        // Translate from VLM's f-scaled physical pixels back to the browser's logical CSS pixels
        const f = action.f || 1;
        const dpr = window.devicePixelRatio || 1;
        const logicalX = target.x / (f * dpr);
        const logicalY = target.y / (f * dpr);

        console.log(
          `[ShieldBrowse] Translated to logical viewport CSS coordinates: (${logicalX}, ${logicalY})`,
        );

        const el =
          document.elementFromPoint(logicalX, logicalY) || document.body;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(300);
        el.click();
        return { success: true, action: actionType, target };
      }

      const element = findElement(target);
      if (!element) throw new Error(`Element not found: ${target}`);

      element.scrollIntoView({ behavior: "smooth", block: "center" });
      await sleep(300); // Wait for scroll

      element.click();

      // Fallback for submit buttons: some frameworks or browser validation states
      // suppress synthetic .click() on submit buttons. requestSubmit() forces it
      // while still firing the proper 'submit' events that React/Angular listen to.
      if (element.tagName === "BUTTON" && element.type === "submit") {
        const form = element.closest("form");
        if (form) {
          try {
            form.requestSubmit(element);
            console.log(
              "[ShieldBrowse] Dispatched form.requestSubmit() as fallback",
            );
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

      // Find the option matching the value text
      const realValue = value;
      const options = Array.from(element.options);
      const matchingOption = options.find(
        (opt) =>
          opt.text.toLowerCase().includes(realValue.toLowerCase()) ||
          opt.value.toLowerCase().includes(realValue.toLowerCase()),
      );

      if (matchingOption) {
        element.value = matchingOption.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }

      return { success: true, action: actionType, target };
    }

    case "navigate": {
      // Rehydrate in case the URL contains a token (rare, but possible)
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
