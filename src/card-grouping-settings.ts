import type { SortDirection } from "./settings";

export type GroupDimension = "none" | "folder" | "tag" | "box-rule" | "task";

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
  orderBy: GroupOrderBy;
  orderDirection: SortDirection;
}

export const DEFAULT_GROUP_SPEC: GroupSpec = {
  dimension: "none",
  orderBy: "default",
  orderDirection: "asc",
};

const KNOWN_GROUP_DIMENSIONS: ReadonlySet<string> = new Set<GroupDimension>([
  "none",
  "folder",
  "tag",
  "box-rule",
  "task",
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

  return {
    dimension: normalizeGroupDimension(value.dimension),
    orderBy: normalizeGroupOrderBy(value.orderBy),
    orderDirection: normalizeGroupOrderDirection(value.orderDirection),
  };
}
