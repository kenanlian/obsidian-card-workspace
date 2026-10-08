import { isPathAtOrBelow, rewritePathReference } from "./path-references";

export type FolderSiblingOrders = Record<string, string[]>;
export type FolderSortMode = "asc" | "desc" | "manual";

/** Descending name sorts need a marker to distinguish them from authored manual orders. */
export function normalizeFolderDescendingNameSorts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((path): path is string => typeof path === "string")
    .map((path) => path.trim().split("/").filter(Boolean).join("/")))].sort();
}

export function resolveFolderSortMode(
  orders: FolderSiblingOrders, parent: string, descendingNameSorts: readonly string[] = [],
): FolderSortMode {
  if (!hasFolderSiblingOrder(orders, parent)) return "asc";
  return descendingNameSorts.includes(parent) ? "desc" : "manual";
}

export function folderParentPath(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

export function hasFolderSiblingOrder(orders: FolderSiblingOrders, parent: string): boolean {
  return Object.prototype.hasOwnProperty.call(orders, parent);
}

/** Structural normalization only; vault existence is checked by the reconciler. */
export function normalizeFolderSiblingOrders(value: unknown): FolderSiblingOrders {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, string[]]> = [];
  const canonical = (path: string): string => path.trim().split("/").filter(Boolean).join("/");
  for (const [key, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const parent = canonical(key);
    const paths = [...new Set(list.filter((path): path is string => typeof path === "string")
      .map(canonical).filter((path) => path !== "" && folderParentPath(path) === parent))];
    entries.push([parent, paths]);
  }
  return Object.fromEntries(entries);
}

export function folderSiblingOrdersEqual(left: FolderSiblingOrders, right: FolderSiblingOrders): boolean {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    hasFolderSiblingOrder(right, key) && left[key].length === right[key].length
    && left[key].every((path, index) => path === right[key][index]));
}

/** Name-ordered candidates are already available from the cached navigation tree. */
export function orderFolderSiblings<T extends { path: string }>(
  siblings: readonly T[], orders: FolderSiblingOrders, parent: string,
): T[] {
  if (!hasFolderSiblingOrder(orders, parent)) return [...siblings];
  const ranks = new Map(orders[parent].map((path, index) => [path, index]));
  return [...siblings].sort((left, right) => {
    if (left.path === "/" || left.path === "") return -1;
    if (right.path === "/" || right.path === "") return 1;
    return (ranks.get(left.path) ?? Infinity) - (ranks.get(right.path) ?? Infinity) || 0;
  });
}

export function reorderFolderSiblings(
  fullOrder: readonly string[], source: string, target: string, position: "before" | "after",
): string[] | null {
  if (!source || !target || source === target || folderParentPath(source) !== folderParentPath(target)
    || !fullOrder.includes(source) || !fullOrder.includes(target)) return null;
  const next = fullOrder.filter((path) => path !== source);
  next.splice(next.indexOf(target) + (position === "after" ? 1 : 0), 0, source);
  return next.every((path, index) => path === fullOrder[index]) ? null : next;
}

export function rewriteFolderSiblingOrders(
  orders: FolderSiblingOrders, oldPath: string, newPath: string,
): FolderSiblingOrders {
  const oldParent = folderParentPath(oldPath), newParent = folderParentPath(newPath);
  const next = Object.fromEntries(Object.entries(orders).map(([parent, paths]) => [
    rewritePathReference(parent, oldPath, newPath),
    paths.filter((path) => oldParent === newParent || path !== oldPath)
      .map((path) => rewritePathReference(path, oldPath, newPath)),
  ])) as FolderSiblingOrders;
  if (oldParent !== newParent && hasFolderSiblingOrder(next, newParent) && !next[newParent].includes(newPath)) {
    next[newParent] = [...next[newParent], newPath];
  }
  return next;
}

export function pruneFolderSiblingOrders(orders: FolderSiblingOrders, deleted: string): FolderSiblingOrders {
  return Object.fromEntries(Object.entries(orders)
    .filter(([parent]) => !isPathAtOrBelow(parent, deleted))
    .map(([parent, paths]) => [parent, paths.filter((path) => !isPathAtOrBelow(path, deleted))]));
}
