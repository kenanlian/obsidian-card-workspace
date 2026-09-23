import type { TFile } from "obsidian";

import type { SortDirection, SortField } from "../settings";
import { compareCardOrderKeys, type CardOrderKey } from "./card-sort";

/**
 * Sort scope files with the same key as `compareCards`, then float pinned
 * paths in that sorted relative order. Pins absent from `files` are dropped.
 * Returns the same file objects, reordered, and does not allocate card records.
 */
export function orderScopeFiles(
  files: readonly TFile[],
  sort: { field: SortField; direction: SortDirection },
  pinnedPaths: readonly string[],
): TFile[] {
  if (files.length === 0) {
    return [];
  }

  const ordered = [...files];
  ordered.sort((left, right) =>
    compareCardOrderKeys(fileOrderKey(left), fileOrderKey(right), sort.field, sort.direction),
  );
  if (pinnedPaths.length === 0) {
    return ordered;
  }

  const pinnedSet = new Set(pinnedPaths);
  const pinned: TFile[] = [];
  const unpinned: TFile[] = [];
  for (const file of ordered) {
    if (pinnedSet.has(file.path)) {
      pinned.push(file);
    } else {
      unpinned.push(file);
    }
  }
  return [...pinned, ...unpinned];
}

function fileOrderKey(file: TFile): CardOrderKey {
  return {
    name: file.basename,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    path: file.path,
  };
}
