// src/content/dom-walker.js
// Extracts interactive elements, labels, values, and coordinates from webpage DOM

export function findLabelForInput(inputElement) {
  const root = inputElement.getRootNode();

  // 1. Check for <label for="inputId">
  if (inputElement.id) {
    const label = root.querySelector(`label[for="${inputElement.id}"]`);
    if (label) return label.textContent.trim();
  }

  // 2. Check for parent <label> wrapping the input
  const parentLabel = inputElement.closest("label");
  if (parentLabel) return parentLabel.textContent.trim();

  // 3. Check for adjacent label (sibling or parent's previous sibling)
  const parent = inputElement.parentElement;
  if (parent) {
    const prevSibling = inputElement.previousElementSibling;
    if (prevSibling && prevSibling.tagName === "LABEL") {
      return prevSibling.textContent.trim();
    }
    // Check parent's text content if it's a form-group wrapper
    const parentLabel = parent.querySelector("label");
    if (parentLabel && parentLabel !== inputElement) {
      return parentLabel.textContent.trim();
    }
  }

  // 4. Fallback to aria-label, name, or placeholder
  return (
    inputElement.getAttribute("aria-label") ||
    inputElement.placeholder ||
    inputElement.name ||
    ""
  );
}

// Interactive tag names to always include
const INTERACTIVE_TAGS = new Set([
  "INPUT", "SELECT", "TEXTAREA", "BUTTON", "IMG"
]);

// Additional tags to include for clickable elements
const CLICKABLE_TAGS = new Set(["A"]);

function isInteractive(node) {
  if (INTERACTIVE_TAGS.has(node.tagName)) return true;
  if (CLICKABLE_TAGS.has(node.tagName)) return true;
  if (node.getAttribute("role") === "button") return true;
  if (node.getAttribute("role") === "link") return true;
  if (node.getAttribute("role") === "checkbox") return true;
  if (node.getAttribute("role") === "radio") return true;
  if (node.getAttribute("role") === "tab") return true;
  if (node.getAttribute("role") === "switch") return true;
  if (node.getAttribute("role") === "option") return true;
  if (node.onclick || node.getAttribute("onclick")) return true;
  return false;
}

function extractNodesRecursively(root, interactiveNodes) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);

  let node;
  while ((node = walker.nextNode())) {
    if (node.shadowRoot) {
      extractNodesRecursively(node.shadowRoot, interactiveNodes);
    }

    if (!isInteractive(node)) continue;

    const tag = node.tagName;
    const rect = node.getBoundingClientRect();

    // Skip zero-box elements ONLY when they cannot carry PII
    const hiddenButHasValue =
      rect.width === 0 &&
      rect.height === 0 &&
      ((tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") &&
        (node.value || node.type === "hidden"));
    if (rect.width === 0 && rect.height === 0 && !hiddenButHasValue) continue;

    // Determine label
    let label;
    if (tag === "IMG") {
      label = node.alt || node.getAttribute("aria-label") || node.id || "";
    } else if (tag === "A") {
      label = node.textContent?.trim().substring(0, 100) || node.getAttribute("aria-label") || "";
    } else if (tag === "BUTTON" || node.getAttribute("role") === "button") {
      label = node.textContent?.trim().substring(0, 100) || node.getAttribute("aria-label") || "";
    } else {
      label = findLabelForInput(node);
    }

    // Unique CSS selector for agent targeting
    let selector = "";
    if (node.id) {
      selector = `#${CSS.escape(node.id)}`;
    } else {
      if (!node.dataset.sbId) {
        node.dataset.sbId = Math.random().toString(36).substring(2, 10);
      }
      selector = `${tag.toLowerCase()}[data-sb-id="${node.dataset.sbId}"]`;
    }

    // Determine value
    let value;
    if (tag === "IMG") {
      value = node.src === window.location.href ? "" : node.src;
    } else if (tag === "A") {
      value = node.href || "";
    } else if (node.type === "radio" || node.type === "checkbox") {
      value = node.checked ? "checked" : "";
    } else if (tag === "SELECT") {
      const selected = node.options?.[node.selectedIndex];
      value = selected ? selected.text : "";
    } else {
      value = node.value || (tag === "BUTTON" ? node.textContent.trim() : "");
    }

    const dpr = window.devicePixelRatio || 1;
    const nodeData = {
      id: node.id || null,
      name: node.name || null,
      tagName: tag,
      type: node.type || null,
      label: label,
      dataset: Object.assign({}, node.dataset),
      value: value,
      placeholder: node.placeholder || "",
      autocomplete: node.autocomplete || "",
      selector: selector,
      box: [
        Math.round(rect.x * dpr),
        Math.round(rect.y * dpr),
        Math.round(rect.width * dpr),
        Math.round(rect.height * dpr),
      ],
      // Accessibility & state attributes
      role: node.getAttribute("role") || null,
      ariaLabel: node.getAttribute("aria-label") || null,
      ariaRequired: node.getAttribute("aria-required") || null,
      disabled: node.disabled || node.getAttribute("aria-disabled") === "true" || false,
      readonly: node.readOnly || false,
      required: node.required || false,
      maxLength: node.maxLength > 0 && node.maxLength < 100000 ? node.maxLength : null,
    };

    // For select elements, include options
    if (tag === "SELECT" && node.options) {
      nodeData.options = Array.from(node.options)
        .filter(opt => opt.value) // Skip empty placeholder options
        .map(opt => opt.text.trim())
        .slice(0, 20); // Cap at 20 to avoid token explosion
    }

    interactiveNodes.push(nodeData);
  }
}

export function extractPageStructure(root = document.body) {
  const interactiveNodes = [];
  extractNodesRecursively(root, interactiveNodes);

  return {
    url: window.location.href,
    title: document.title,
    nodes: interactiveNodes,
  };
}
