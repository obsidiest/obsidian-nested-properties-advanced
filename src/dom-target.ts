export function getDomElement(target: unknown): Element | null {
  const node = getDomNode(target);
  return node?.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement ?? null;
}

/**
 * Obsidian moves existing editor DOM between windows. Adoption changes ownerDocument,
 * But not the node's prototype: neither the main nor the destination constructor can
 * Identify every element in a mixed-origin subtree. Inspect DOM identity instead.
 */
export function getDomNode(target: unknown): Node | null {
  return typeof target === 'object' && target !== null && 'nodeType' in target && typeof target.nodeType === 'number' ? target as Node : null;
}

export function getHtmlElement(target: unknown): HTMLElement | null {
  const element = getDomElement(target);
  return element?.namespaceURI === 'http://www.w3.org/1999/xhtml' ? element as HTMLElement : null;
}
