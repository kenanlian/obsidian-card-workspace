import { getSearchDisplayTerms } from "../search-tokenization";

export type PreviewHtmlSanitizer = (previewHtml: string, doc: Document) => string;

const ALLOWED_PREVIEW_TAGS = new Set(["P", "CODE", "MARK"]);
const ALLOWED_PREVIEW_CLASSES = {
  P: new Set(["fce-preview-code", "fce-preview-heading"]),
  CODE: new Set<string>(),
  MARK: new Set(["fce-search-hit"]),
} as const;

export const sanitizePreviewHtml: PreviewHtmlSanitizer = (previewHtml, doc) => {
  if (previewHtml.length === 0) {
    return previewHtml;
  }

  const template = doc.createElement("template");
  template.innerHTML = previewHtml;
  const sanitizedFragment = doc.createDocumentFragment();
  for (const child of Array.from(template.content.childNodes)) {
    appendSanitizedPreviewNode(sanitizedFragment, child, doc);
  }
  return serializeFragment(sanitizedFragment, doc);
};

export function highlightSanitizedPreviewHtml(
  sanitizedHtml: string,
  normalizedQuery: string,
  doc: Document,
): string {
  if (sanitizedHtml.length === 0 || normalizedQuery.length === 0) {
    return sanitizedHtml;
  }

  try {
    const template = doc.createElement("template");
    template.innerHTML = sanitizedHtml;
    applyPreviewHighlights(template.content, normalizedQuery, doc);
    return serializeFragment(template.content, doc);
  } catch {
    return sanitizedHtml;
  }
}

function appendSanitizedPreviewNode(parent: Node, node: Node, doc: Document): void {
  if (node.nodeType === 3) {
    parent.appendChild(doc.createTextNode(node.nodeValue ?? ""));
    return;
  }
  if (node.nodeType !== 1) {
    return;
  }

  const element = node as Element;
  if (!ALLOWED_PREVIEW_TAGS.has(element.tagName)) {
    for (const child of Array.from(element.childNodes)) {
      appendSanitizedPreviewNode(parent, child, doc);
    }
    return;
  }

  const safeElement = doc.createElement(element.tagName.toLowerCase());
  const allowedClasses = ALLOWED_PREVIEW_CLASSES[element.tagName as keyof typeof ALLOWED_PREVIEW_CLASSES];
  const className = (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((candidate) => allowedClasses.has(candidate))
    .join(" ");
  if (className.length > 0) {
    safeElement.className = className;
  }

  for (const child of Array.from(element.childNodes)) {
    appendSanitizedPreviewNode(safeElement, child, doc);
  }
  parent.appendChild(safeElement);
}

function applyPreviewHighlights(root: ParentNode, query: string, doc: Document): void {
  const pattern = createTokenPattern(getSearchDisplayTerms(query));
  if (!pattern) {
    return;
  }

  const walker = doc.createTreeWalker(root, 4);
  const textNodes: Text[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    if (currentNode.nodeType === 3 && !(currentNode.parentElement?.closest("mark.fce-search-hit"))) {
      textNodes.push(currentNode as Text);
    }
    currentNode = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const fragment = createHighlightedFragment(textNode.nodeValue ?? "", pattern, doc);
    if (fragment) {
      textNode.replaceWith(fragment);
    }
  }
}

function createHighlightedFragment(value: string, pattern: RegExp, doc: Document): DocumentFragment | null {
  const fragment = doc.createDocumentFragment();
  let lastIndex = 0;
  let hasMatch = false;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    fragment.appendChild(doc.createTextNode(value.slice(lastIndex, index)));
    const mark = doc.createElement("mark");
    mark.className = "fce-search-hit";
    mark.textContent = match[0];
    fragment.appendChild(mark);
    lastIndex = index + match[0].length;
    hasMatch = true;
  }
  if (!hasMatch) {
    return null;
  }
  fragment.appendChild(doc.createTextNode(value.slice(lastIndex)));
  return fragment;
}

function createTokenPattern(tokens: string[]): RegExp | null {
  if (tokens.length === 0) {
    return null;
  }
  const escapedTokens = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const sortedTokens: string[] = [];
  for (const token of escapedTokens) {
    const insertionIndex = sortedTokens.findIndex((candidate) => candidate.length < token.length);
    sortedTokens.splice(insertionIndex < 0 ? sortedTokens.length : insertionIndex, 0, token);
  }
  const pattern = sortedTokens.join("|");
  return new RegExp(`(${pattern})`, "gi");
}

function serializeFragment(fragment: DocumentFragment, doc: Document): string {
  const container = doc.createElement("div");
  container.appendChild(fragment);
  return container.innerHTML;
}
