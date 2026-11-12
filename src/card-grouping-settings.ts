import type { SortDirection } from "./settings";
import { normalizePropertyKey } from "./property-filter-settings";

export type GroupDimension = "none" | "folder" | "tag" | "box-rule" | "task" | "property" | "ctime" | "mtime";

export const TIME_GROUP_GRANULARITIES = ["day", "week", "biweek", "month", "year", "relative"] as const;
export type TimeGroupGranularity = typeof TIME_GROUP_GRANULARITIES[number];
export function isTimeGroupDimension(value: unknown): value is "ctime" | "mtime" {
  return value === "ctime" || value === "mtime";
}
export function isTimeGroupGranularity(value: unknown): value is TimeGroupGranularity {
  return TIME_GROUP_GRANULARITIES.some((entry) => entry === value);
}

export type GroupOrderBy = "default" | "name" | "count";

/**
 * How the visible cards are bucketed and how those buckets are ordered.
 *
 * - `dimension`: what the buckets are keyed by (`"none"` = flat card stream).
 * - `orderBy`: bucket ordering key (`"default"` = the dimension's natural order).
 * - `orderDirection`: bucket ordering direction, reusing the card sort vocabulary.
 */
export interface GroupSpec {
  dimension: GroupDimension;
  /** Present only for property grouping. */
  propertyKey?: string;
  /** Present only for creation/edit time grouping; defaults to calendar day. */
  timeGranularity?: TimeGroupGranularity;
  orderBy: GroupOrderBy;
  orderDirection: SortDirection;
}

export const DEFAULT_GROUP_SPEC: GroupSpec = {
  dimension: "none",
  orderBy: "default",
  orderDirection: "asc",
};

const KNOWN_GROUP_DIMENSIONS: ReadonlySet<string> = new Set<GroupDimension>([
  "ctime",
  "mtime",
  "none",
  "folder",
  "tag",
  "box-rule",
  "task",
  "property",
]);

const KNOWN_GROUP_ORDER_BY: ReadonlySet<string> = new Set<GroupOrderBy>([
  "default",
  "name",
  "count",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeGroupDimension(value: unknown): GroupDimension {
  return typeof value === "string" && KNOWN_GROUP_DIMENSIONS.has(value)
    ? (value as GroupDimension)
    : DEFAULT_GROUP_SPEC.dimension;
}

function normalizeGroupOrderBy(value: unknown): GroupOrderBy {
  return typeof value === "string" && KNOWN_GROUP_ORDER_BY.has(value)
    ? (value as GroupOrderBy)
    : DEFAULT_GROUP_SPEC.orderBy;
}

function normalizeGroupOrderDirection(value: unknown): SortDirection {
  return value === "asc" || value === "desc" ? value : DEFAULT_GROUP_SPEC.orderDirection;
}

export function normalizeGroupSpec(value: unknown): GroupSpec {
  if (!isRecord(value)) {
    return { ...DEFAULT_GROUP_SPEC };
  }

  const dimension = normalizeGroupDimension(value.dimension);
  const propertyKey = dimension === "property" ? normalizePropertyKey(value.propertyKey) : null;
  return {
    dimension: dimension === "property" && propertyKey === null ? "none" : dimension,
    ...(propertyKey === null ? {} : { propertyKey }),
    ...(isTimeGroupDimension(dimension) ? { timeGranularity: isTimeGroupGranularity(value.timeGranularity) ? value.timeGranularity : "day" as const } : {}),
    orderBy: normalizeGroupOrderBy(value.orderBy),
    orderDirection: normalizeGroupOrderDirection(value.orderDirection),
  };
}

/** Clears a persisted property group when its key is no longer enabled. */
export function normalizeVisibleGroupSpec(value: unknown, visibleKeys: ReadonlySet<string>): GroupSpec {
  const group = normalizeGroupSpec(value);
  return group.dimension === "property" && !visibleKeys.has(group.propertyKey ?? "")
    ? { dimension: "none", orderBy: group.orderBy, orderDirection: group.orderDirection }
    : group;
}
