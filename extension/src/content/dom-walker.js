// src/content/dom-walker.js
// Extracts interactive elements, labels, values, and coordinates from webpage DOM

export function findLabelForInput(inputElement) {
  // 1. Check for <label for="inputId">
  if (inputElement.id) {
    const label = document.querySelector(`label[for="${inputElement.id}"]`);
    if (label) return label.textContent.trim();
  }

  // 2. Check for parent <label> wrapping the input
  const parentLabel = inputElement.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();

  // 3. Fallback to aria-label, name, or placeholder
  return (
    inputElement.getAttribute('aria-label') ||
    inputElement.placeholder ||
    inputElement.name ||
    ''
  );
}

export function extractPageStructure(root = document.body) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT,
    null
  );

  const interactiveNodes = [];
  let node;

  while ((node = walker.nextNode())) {
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') {
      const rect = node.getBoundingClientRect();
      const label = findLabelForInput(node);

      // Unique CSS selector for agent targeting
      const selector = node.id
        ? `#${node.id}`
        : `${tag.toLowerCase()}[name="${node.name || ''}"]`;

      interactiveNodes.push({
        id: node.id || null,
        name: node.name || null,
        tagName: tag,
        type: node.type || null,
        label: label,
        value: node.value || (tag === 'BUTTON' ? node.textContent.trim() : ''),
        placeholder: node.placeholder || '',
        autocomplete: node.autocomplete || '',
        selector: selector,
        box: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    }
  }

  return {
    url: window.location.href,
    title: document.title,
    nodes: interactiveNodes
  };
}
