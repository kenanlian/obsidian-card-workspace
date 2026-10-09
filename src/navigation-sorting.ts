import { normalizePropertyKey } from "./property-filter-settings";
import { normalizeTagPath } from "./view/tag-tree";

export type NavigationSortMode = "asc" | "desc" | "manual";
export interface NavigationSortSpec { mode: NavigationSortMode; order: string[] }
export interface NavigationSorting {
  tags: Record<string, NavigationSortSpec>;
  propertyKeys: NavigationSortSpec;
  propertyValues: Record<string, NavigationSortSpec>;
}
export type NavigationSortTarget =
  | { kind: "tags"; parent: string }
  | { kind: "property-keys" }
  | { kind: "property-values"; key: string };

const DEFAULT_SORT: NavigationSortSpec = { mode: "asc", order: [] };
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function normalizeSpec(value: unknown, identity: (raw: string) => string | null): NavigationSortSpec {
  const source = record(value);
  const order = Array.isArray(source.order) ? source.order.flatMap((raw) => {
    const id = typeof raw === "string" ? identity(raw) : null;
    return id === null ? [] : [id];
  }) : [];
  return { mode: source.mode === "desc" || source.mode === "manual" ? source.mode : "asc", order: [...new Set(order)] };
}
export function tagSortParent(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}
function normalizeValueIdentity(raw: string): string | null {
  try {
    const tuple: unknown = JSON.parse(raw);
    if (!Array.isArray(tuple) || tuple.length !== 2) return null;
    const [kind, value] = tuple;
    if ((kind === "t" && typeof value === "string")
      || (kind === "n" && typeof value === "number" && Number.isFinite(value))
      || (kind === "b" && typeof value === "boolean")) return JSON.stringify(tuple);
  } catch { /* Malformed persisted identity. */ }
  return null;
}
export function normalizeNavigationSorting(value: unknown): NavigationSorting {
  const source = record(value);
  return {
    tags: Object.fromEntries(Object.entries(record(source.tags)).map(([rawParent, spec]) => {
      const parent = normalizeTagPath(rawParent);
      return [parent, normalizeSpec(spec, (raw) => {
        const path = normalizeTagPath(raw);
        return path && tagSortParent(path) === parent ? path : null;
      })];
    })),
    propertyKeys: normalizeSpec(source.propertyKeys, normalizePropertyKey),
    propertyValues: Object.fromEntries(Object.entries(record(source.propertyValues)).flatMap(([rawKey, spec]) => {
      const key = normalizePropertyKey(rawKey);
      return key === null ? [] : [[key, normalizeSpec(spec, normalizeValueIdentity)]];
    })),
  };
}
export function resolveNavigationSort(sorting: NavigationSorting, target: NavigationSortTarget): NavigationSortSpec {
  switch (target.kind) {
    case "tags": return Object.prototype.hasOwnProperty.call(sorting.tags, target.parent) ? sorting.tags[target.parent] : DEFAULT_SORT;
    case "property-keys": return sorting.propertyKeys;
    case "property-values": return Object.prototype.hasOwnProperty.call(sorting.propertyValues, target.key) ? sorting.propertyValues[target.key] : DEFAULT_SORT;
  }
}
export function updateNavigationSort(sorting: NavigationSorting, target: NavigationSortTarget, spec: NavigationSortSpec): NavigationSorting {
  switch (target.kind) {
    case "tags": return { ...sorting, tags: { ...sorting.tags, [target.parent]: spec } };
    case "property-keys": return { ...sorting, propertyKeys: spec };
    case "property-values": return { ...sorting, propertyValues: { ...sorting.propertyValues, [target.key]: spec } };
  }
}
export function orderNavigationItems<T>(items: readonly T[], spec: NavigationSortSpec, identity: (item: T) => string, label: (item: T) => string): T[] {
  const ranks = new Map(spec.order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    if (spec.mode === "manual") {
      const rank = (ranks.get(identity(a)) ?? Infinity) - (ranks.get(identity(b)) ?? Infinity);
      if (rank && !Number.isNaN(rank)) return rank;
    }
    const byName = label(a).localeCompare(label(b)) || identity(a).localeCompare(identity(b));
    return spec.mode === "desc" ? -byName : byName;
  });
}
/** Replace present slots, retaining absent/hidden identities and their relative positions. */
export function mergeNavigationOrder(saved: readonly string[], current: readonly string[]): string[] {
  const present = new Set(current);
  let index = 0;
  const result = saved.map((id) => present.has(id) ? current[index++] : id);
  return [...result, ...current.slice(index)];
}
export function reorderNavigationItems(order: readonly string[], source: string, target: string, position: "before" | "after"): string[] | null {
  if (source === target || !order.includes(source) || !order.includes(target)) return null;
  const next = order.filter((id) => id !== source);
  next.splice(next.indexOf(target) + (position === "after" ? 1 : 0), 0, source);
  return next.every((id, index) => id === order[index]) ? null : next;
}
export function navigationSortingEqual(a: NavigationSorting, b: NavigationSorting): boolean {
  const sameSpec = (left: NavigationSortSpec, right: NavigationSortSpec): boolean => left.mode === right.mode
    && left.order.length === right.order.length && left.order.every((id, index) => id === right.order[index]);
  const sameMap = (left: Record<string, NavigationSortSpec>, right: Record<string, NavigationSortSpec>): boolean =>
    Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) =>
      Object.prototype.hasOwnProperty.call(right, key) && sameSpec(left[key], right[key]));
  return sameSpec(a.propertyKeys, b.propertyKeys) && sameMap(a.tags, b.tags) && sameMap(a.propertyValues, b.propertyValues);
}

/** Plugin tag mutations rewrite ordering references without pruning scope-dependent inventories. */
export function rewriteNavigationTagSorting(sorting: NavigationSorting, from: string, to: string | null, retainOriginal = false): NavigationSorting {
  from = normalizeTagPath(from);
  to = to === null ? null : normalizeTagPath(to);
  const under = (path: string): boolean => path === from || path.startsWith(`${from}/`);
  const rewrite = (path: string): string | null => !under(path) ? path : to === null ? null : to + path.slice(from.length);
  const tags = new Map<string, NavigationSortSpec>(retainOriginal
    ? Object.entries(sorting.tags).filter(([parent]) => under(parent)).map(([parent, spec]) => [parent, { ...spec, order: [...spec.order] }]) : []);
  for (const [parent, spec] of Object.entries(sorting.tags)) {
    const nextParent = rewrite(parent);
    if (nextParent === null) continue;
    const order = spec.order.flatMap((path) => {
      const next = rewrite(path);
      const kept = retainOriginal && under(path) && tagSortParent(path) === nextParent ? [path] : [];
      return [...kept, ...(next !== null && tagSortParent(next) === nextParent ? [next] : [])];
    });
    const existing = tags.get(nextParent) ?? (nextParent !== parent && !under(nextParent)
      && Object.prototype.hasOwnProperty.call(sorting.tags, nextParent) ? sorting.tags[nextParent] : undefined);
    tags.set(nextParent, { mode: existing?.mode ?? spec.mode, order: [...new Set([...(existing?.order ?? []), ...order])] });
  }
  // Moving a tag subtree to another parent appends it to an authored destination order.
  if (to !== null && tagSortParent(from) !== tagSortParent(to)) {
    const destination = tags.get(tagSortParent(to));
    if (destination && !destination.order.includes(to)) destination.order.push(to);
  }
  return { ...sorting, tags: Object.fromEntries(tags) };
}
