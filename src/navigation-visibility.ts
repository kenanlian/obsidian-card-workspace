import { normalizeExpandedFolderPaths, normalizeExpandedTagPaths } from "./navigation-expansion-settings";
import { isPathAtOrBelow } from "./path-references";
import { NAVIGATION_SECTION_ORDER } from "./view/navigation-model";
import { renameTagPathPrefix } from "./view/tag-tree";
import type { NavSectionId } from "./view/types";

function validPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string"
    && ![...entry].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    && !entry.replace(/\\/g, "/").split("/").some((part) => part.trim() === "." || part.trim() === ".."));
}

/** Root cannot be hidden individually. Keep descendants even under a hidden parent. */
export function normalizeHiddenFolderPaths(value: unknown): string[] {
  return normalizeExpandedFolderPaths(validPaths(value));
}

export function normalizeHiddenTagPaths(value: unknown): string[] {
  return normalizeExpandedTagPaths(validPaths(value));
}

export function normalizeHiddenNavSections(value: unknown): NavSectionId[] {
  return NAVIGATION_SECTION_ORDER.filter((section) => Array.isArray(value) && value.includes(section));
}

export function hiddenPathAncestor(path: string, hidden: readonly string[]): string | null {
  return hidden.find((parent) => parent !== path && parent.length > 0 && isPathAtOrBelow(path, parent)) ?? null;
}

/** Prune before query and expansion; all other node data, including counts, stays intact. */
export function pruneHiddenNavigationTree<T extends { children: T[] }>(
  nodes: readonly T[], hidden: readonly string[], identity: (node: T) => string,
): T[] {
  if (hidden.length === 0) return [...nodes];
  const hiddenPaths = new Set(hidden.filter((path) => path.length > 0));
  const isHidden = (path: string): boolean => {
    if (hiddenPaths.has(path)) return true;
    for (let boundary = path.indexOf("/"); boundary >= 0; boundary = path.indexOf("/", boundary + 1)) {
      if (hiddenPaths.has(path.slice(0, boundary))) return true;
    }
    return false;
  };
  const walk = (items: readonly T[]): T[] => items.filter((node) => !isHidden(identity(node)))
    .map((node) => ({ ...node, children: walk(Array.isArray(node.children) ? node.children : []) }));
  return walk(nodes);
}

/** Apply only draft additions/removals to the latest shared rules. */
export function mergeHiddenPathDraft(latest: readonly string[], initial: readonly string[], draft: ReadonlySet<string>): string[] {
  const removed = new Set(initial.filter((path) => !draft.has(path)));
  const added = [...draft].filter((path) => !initial.includes(path));
  return [...new Set([...latest.filter((path) => !removed.has(path)), ...added])];
}

export function rewriteHiddenTagsAfterRename(
  paths: readonly string[], from: string, to: string, keepOriginal: boolean,
): string[] {
  const mapped = paths.map((path) => renameTagPathPrefix(path, from, to) ?? path);
  return normalizeHiddenTagPaths(keepOriginal ? [...paths, ...mapped] : mapped);
}
