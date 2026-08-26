import { normalizePath } from "obsidian";

import { normalizeScopePath } from "./view/scope";
import { normalizeTagPath } from "./view/tag-tree";

function sortLexically(values: Set<string>): string[] {
  const sorted: string[] = [];
  for (const value of values) {
    const index = sorted.findIndex((existing) => existing > value);
    if (index < 0) sorted.push(value);
    else sorted.splice(index, 0, value);
  }
  return sorted;
}

export function normalizeExpandedFolderPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const path = normalizeScopePath(normalizePath(entry));
    if (path.length > 0) paths.add(path);
  }
  return sortLexically(paths);
}

export function normalizeExpandedTagPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const path = normalizeTagPath(entry);
    if (path.length > 0) paths.add(path);
  }
  return sortLexically(paths);
}
