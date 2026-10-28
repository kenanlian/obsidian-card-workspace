import { isAlias, isMap, isNode, isScalar, isSeq, parseDocument, visit, type Document } from "yaml";

export type DraftPropertyValue = string | number | boolean | null | string[];
export type DraftProperties = Record<string, DraftPropertyValue>;

/** The recognized source range also protects unsupported YAML in append mode. */
export function draftFrontmatterSource(text: string): string {
  if (!/^(?:\uFEFF)?---\r?\n/.test(text)) return "";
  return /^(?:\uFEFF)?---\r?\n[\s\S]*?^(?:---|\.\.\.)(?:\r?\n|$)/m.exec(text)?.[0] ?? text;
}

/** Unsupported YAML stays in the editor verbatim instead of being coerced by native widgets. */
export function readDraftFrontmatter(text: string) {
  const match = /^---\r?\n([\s\S]*?)^---(?:\r?\n|$)/m.exec(text);
  if (!match || match.index !== 0) return null;
  try {
    const document: Document = parseDocument(match[1]);
    if (document.errors.length || document.warnings.length || (document.contents && !isMap(document.contents))) return null;
    if (isMap(document.contents) && document.contents.items.some((pair) => !isScalar(pair.key) || typeof pair.key.value !== "string")) return null;
    let unsupported = false;
    visit(document, (_key, node) => {
      if (isAlias(node) || (isNode(node) && "anchor" in node && node.anchor)) unsupported = true;
    });
    if (unsupported) return null;
    const properties: unknown = document.toJS({ maxAliasCount: 0 });
    if (properties !== null && !isDraftProperties(properties)) return null;
    return { document, properties: properties ?? {}, end: match[0].length,
      newline: text.startsWith("---\r\n") ? "\r\n" : "\n" };
  } catch { return null; }
}

export function isDraftProperties(value: unknown): value is DraftProperties {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([key, item]) =>
    key.length > 0 && !Object.prototype.hasOwnProperty.call(Object.prototype, key) &&
    (item === null || typeof item === "string" || typeof item === "boolean" ||
      (typeof item === "number" && Number.isFinite(item)) || (Array.isArray(item) && item.every((entry: unknown) => typeof entry === "string"))));
}

function sameValue(a: DraftPropertyValue, b: DraftPropertyValue): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((entry, index) => entry === b[index]) : a === b;
}

/** Keep comments, key order and scalar/collection styles; never rewrite the body. */
export function updateDraftFrontmatter(text: string, properties: DraftProperties): string {
  const current = readDraftFrontmatter(text);
  if (!current || !isDraftProperties(properties)) throw new Error("Unsupported draft properties");
  const keys = Object.keys(properties);
  const oldKeys = Object.keys(current.properties);
  if (keys.length === oldKeys.length && keys.every((key, index) => key === oldKeys[index] && sameValue(properties[key], current.properties[key]))) return text;
  const document = current.document;
  if (isMap(document.contents)) {
    const original = document.contents.items.slice();
    const removed = original.filter((pair) => isScalar(pair.key) && !Object.prototype.hasOwnProperty.call(properties, String(pair.key.value)));
    document.contents.items = keys.map((key) => {
      let pair = original.find((entry) => isScalar(entry.key) && entry.key.value === key);
      // Renaming a field keeps its comments and value node.
      if (!pair) pair = removed.find((entry) => isScalar(entry.key) && sameValue(current.properties[String(entry.key.value)], properties[key]));
      if (pair && isScalar(pair.key)) {
        const index = removed.indexOf(pair);
        if (index >= 0) removed.splice(index, 1);
        const oldKey = String(pair.key.value);
        pair.key.value = key;
        if (!sameValue(current.properties[oldKey], properties[key])) {
          if (isScalar(pair.value) && !Array.isArray(properties[key])) pair.value.value = properties[key];
          else if (isSeq(pair.value) && Array.isArray(properties[key])) {
            const available = pair.value.items.slice();
            pair.value.items = properties[key].map((value) => {
              const index = available.findIndex((node) => isScalar(node) && node.value === value);
              return index >= 0 ? available.splice(index, 1)[0] : document.createNode(value);
            });
          } else {
            const next = document.createNode(properties[key]);
            if (isNode(pair.value)) {
              next.comment = pair.value.comment;
              next.commentBefore = pair.value.commentBefore;
            }
            pair.value = next;
          }
        }
        return pair;
      }
      return document.createPair(key, properties[key]);
    });
  } else {
    for (const key of keys) document.set(key, properties[key]);
  }
  const yaml = document.toString({ lineWidth: 0 }).replace(/\n/g, current.newline);
  return `---${current.newline}${yaml}---${current.newline}${text.slice(current.end)}`;
}
