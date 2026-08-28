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

  // 3. Fallback to aria-label, name, or placeholder
  return (
    inputElement.getAttribute("aria-label") ||
    inputElement.placeholder ||
    inputElement.name ||
    ""
  );
}

function extractNodesRecursively(root, interactiveNodes) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);

  let node;
  while ((node = walker.nextNode())) {
    if (node.shadowRoot) {
      extractNodesRecursively(node.shadowRoot, interactiveNodes);
    }

    const tag = node.tagName;
    if (
      tag === "INPUT" ||
      tag === "SELECT" ||
      tag === "TEXTAREA" ||
      tag === "BUTTON" ||
      tag === "IMG"
    ) {
      const rect = node.getBoundingClientRect();

      // Skip elements that are visually hidden (e.g., inside display: none)
      if (rect.width === 0 && rect.height === 0) continue;

      const label =
        tag === "IMG" ? node.alt || node.id || "" : findLabelForInput(node);

      // Unique CSS selector for agent targeting
      let selector = "";
      if (node.id) {
        selector = `#${node.id}`;
      } else {
        if (!node.dataset.sbId) {
          node.dataset.sbId = Math.random().toString(36).substring(2, 10);
        }
        selector = `${tag.toLowerCase()}[data-sb-id="${node.dataset.sbId}"]`;
      }

      const dpr = window.devicePixelRatio || 1;
      interactiveNodes.push({
        id: node.id || null,
        name: node.name || null,
        tagName: tag,
        type: node.type || null,
        label: label,
        value:
          tag === "IMG"
            ? node.src === window.location.href
              ? ""
              : node.src
            : node.type === "radio" || node.type === "checkbox"
              ? ""
              : node.value || (tag === "BUTTON" ? node.textContent.trim() : ""),
        placeholder: node.placeholder || "",
        autocomplete: node.autocomplete || "",
        selector: selector,
        box: [
          Math.round(rect.x * dpr),
          Math.round(rect.y * dpr),
          Math.round(rect.width * dpr),
          Math.round(rect.height * dpr),
        ],
      });
    }
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
