import type { NavigationRow } from "../navigation-model";

/** C8: collapsing a key whose descendant owns focus returns focus to the key row. */
export function focusReturnOnPropertyCollapse(
  rows: readonly NavigationRow[],
  focusId: string | null,
  key: NavigationRow,
): string | null {
  if (focusId === null) return focusId;
  const focused = rows.find((candidate) => candidate.id === focusId);
  return focused !== undefined && focused.parentId === key.id ? key.id : focusId;
}

/**
 * Toggles a normalized identity in a persisted expanded-keys list, keeping the
 * stable sorted order used by `expandedFolderPaths`, `expandedTagPaths`, and
 * `expandedPropertyKeys`.
 */
export function toggleExpandedKey(
  keys: readonly string[] | undefined,
  identity: string,
  expanded: boolean,
): string[] {
  const current = new Set(keys ?? []);
  if (expanded) current.add(identity);
  else current.delete(identity);
  return [...current].sort();
}
