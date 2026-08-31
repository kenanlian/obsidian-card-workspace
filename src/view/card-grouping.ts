import type { App } from "obsidian";
import type { GroupOrderBy, GroupSpec } from "../card-grouping-settings";
import type { UiStrings } from "../i18n";
import { resolveRuleLabel } from "./box-rule-identity";
import { matchesRule } from "./card-box-membership";
import { getFileTagEntries } from "./metadata-utils";
import type { NoteCardRecord, Rule } from "./types";

/**
 * One resolved bucket. Every card resolves to exactly one of these.
 *
 * `sortKey` is a string for every dimension so a single comparator serves all
 * of them. The missing bucket and the box-rule manual bucket never reach that
 * comparator — they are partitioned to the end — so their `sortKey` carries no
 * meaning.
 */
export interface GroupBucket {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly sortKey: string;
  readonly isMissing: boolean;
}

/** Localized labels for the buckets that have no vault-derived name. */
export interface GroupLabels {
  readonly vaultRoot: string;
  readonly noTag: string;
  readonly noTask: string;
  readonly manual: string;
}

export interface CardGroupSegment {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  /** Full membership, counted before collapse. */
  readonly count: number;
  /** `0` when collapsed, otherwise equal to `count`. */
  readonly visibleCount: number;
  /** Index into the post-collapse card array. */
  readonly startIndex: number;
  readonly collapsed: boolean;
  readonly isMissingBucket: boolean;
}

export interface GroupArrangement {
  readonly cards: NoteCardRecord[];
  readonly segments: CardGroupSegment[];
}

const TAG_MISSING_BUCKET_KEY = "tag:__none__";
const MANUAL_RULE_BUCKET_KEY = "rule:__manual__";
const TASK_INCOMPLETE_BUCKET_KEY = "task:incomplete";
const TASK_COMPLETE_BUCKET_KEY = "task:complete";
const TASK_MISSING_BUCKET_KEY = "task:none";

/**
 * Stand-in for a card whose path is absent from the bucket map. That is a
 * programming error, so this keeps no localized label; it exists only so
 * cardinality cannot silently shrink.
 */
const FALLBACK_MISSING_BUCKET: GroupBucket = {
  key: "group:__missing__",
  label: "",
  detail: "",
  sortKey: "",
  isMissing: true,
};

function resolveFolderBucket(card: NoteCardRecord, labels: GroupLabels): GroupBucket {
  const separatorIndex = card.path.lastIndexOf("/");
  const parentPath = separatorIndex === -1 ? "" : card.path.slice(0, separatorIndex);
  const label =
    parentPath === "" ? labels.vaultRoot : parentPath.slice(parentPath.lastIndexOf("/") + 1);

  return {
    key: `folder:${parentPath}`,
    label,
    detail: parentPath,
    sortKey: parentPath,
    isMissing: false,
  };
}

function resolveTagBucket(app: App, card: NoteCardRecord, labels: GroupLabels): GroupBucket {
  const entries = getFileTagEntries(app, card.file);
  if (entries.length === 0) {
    return {
      key: TAG_MISSING_BUCKET_KEY,
      label: labels.noTag,
      detail: "",
      sortKey: "",
      isMissing: true,
    };
  }

  let first = entries[0];
  for (const entry of entries) {
    if (entry.normalized.localeCompare(first.normalized) < 0) {
      first = entry;
    }
  }

  return {
    key: `tag:${first.normalized}`,
    label: `#${first.display}`,
    detail: "",
    sortKey: first.normalized,
    isMissing: false,
  };
}

function resolveBoxRuleBucket(
  app: App,
  card: NoteCardRecord,
  rules: readonly Rule[],
  labels: GroupLabels,
  strings: UiStrings,
): GroupBucket {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!matchesRule(app, card.path, rule)) {
      continue;
    }

    return {
      key: `rule:${rule.id}`,
      label: resolveRuleLabel(strings, rule),
      detail: "",
      sortKey: String(index).padStart(6, "0"),
      isMissing: false,
    };
  }

  // Manual-only membership: real content, not a missing bucket, but still last.
  return {
    key: MANUAL_RULE_BUCKET_KEY,
    label: labels.manual,
    detail: "",
    sortKey: "",
    isMissing: false,
  };
}

function resolveTaskBucket(
  card: NoteCardRecord,
  labels: GroupLabels,
  strings: UiStrings,
): GroupBucket {
  const summary = card.taskSummary;
  if (summary === null) {
    return {
      key: TASK_MISSING_BUCKET_KEY,
      label: labels.noTask,
      detail: "",
      sortKey: "2",
      isMissing: true,
    };
  }

  if (summary.incomplete > 0) {
    return {
      key: TASK_INCOMPLETE_BUCKET_KEY,
      label: strings.sortGroup.bucketTaskIncomplete,
      detail: "",
      sortKey: "0",
      isMissing: false,
    };
  }

  return {
    key: TASK_COMPLETE_BUCKET_KEY,
    label: strings.sortGroup.bucketTaskComplete,
    detail: "",
    sortKey: "1",
    isMissing: false,
  };
}

/**
 * Resolve one bucket per card, keyed by card path.
 *
 * This is the half that reads vault metadata; it is deterministic given the
 * vault. `dimension: "none"` returns an empty map.
 */
/**
 * Two notes can share a normalized tag while spelling it differently, and the
 * arrangement keeps whichever bucket its first member produced — so without a
 * canonical choice the header casing would follow card order. Settle it with
 * the same lexicographic rule `getFileTagEntries` already uses to resolve the
 * identical collision inside one file.
 */
function canonicalizeTagLabels(buckets: Map<string, GroupBucket>): void {
  const labelByKey = new Map<string, string>();
  for (const bucket of buckets.values()) {
    const current = labelByKey.get(bucket.key);
    if (current === undefined || bucket.label < current) {
      labelByKey.set(bucket.key, bucket.label);
    }
  }

  for (const [path, bucket] of buckets) {
    const label = labelByKey.get(bucket.key);
    if (label !== undefined && label !== bucket.label) {
      buckets.set(path, { ...bucket, label });
    }
  }
}

export function buildGroupBuckets(
  app: App,
  cards: readonly NoteCardRecord[],
  spec: GroupSpec,
  rules: readonly Rule[],
  labels: GroupLabels,
  strings: UiStrings,
): Map<string, GroupBucket> {
  const buckets = new Map<string, GroupBucket>();
  if (spec.dimension === "none") {
    return buckets;
  }

  for (const card of cards) {
    switch (spec.dimension) {
      case "folder":
        buckets.set(card.path, resolveFolderBucket(card, labels));
        break;
      case "tag":
        buckets.set(card.path, resolveTagBucket(app, card, labels));
        break;
      case "box-rule":
        buckets.set(card.path, resolveBoxRuleBucket(app, card, rules, labels, strings));
        break;
      case "task":
        buckets.set(card.path, resolveTaskBucket(card, labels, strings));
        break;
      default: {
        const exhaustive: never = spec.dimension;
        throw new Error(`Unhandled group dimension: ${String(exhaustive)}`);
      }
    }
  }

  if (spec.dimension === "tag") {
    canonicalizeTagLabels(buckets);
  }

  return buckets;
}

interface PendingGroup {
  bucket: GroupBucket;
  cards: NoteCardRecord[];
}

/**
 * Total comparator: `orderBy` first, then the dimension's default sort key,
 * then the bucket key, so ordering is stable across reloads.
 */
function compareGroups(left: PendingGroup, right: PendingGroup, orderBy: GroupOrderBy): number {
  if (orderBy === "name") {
    const byLabel = left.bucket.label.localeCompare(right.bucket.label);
    if (byLabel !== 0) {
      return byLabel;
    }
  } else if (orderBy === "count") {
    const byCount = left.cards.length - right.cards.length;
    if (byCount !== 0) {
      return byCount;
    }
  }

  const bySortKey = left.bucket.sortKey.localeCompare(right.bucket.sortKey);
  if (bySortKey !== 0) {
    return bySortKey;
  }

  return left.bucket.key.localeCompare(right.bucket.key);
}

function partitionIntoGroups(
  cards: readonly NoteCardRecord[],
  buckets: ReadonlyMap<string, GroupBucket>,
): PendingGroup[] {
  const groups: PendingGroup[] = [];
  const groupsByKey = new Map<string, PendingGroup>();

  for (const card of cards) {
    const bucket = buckets.get(card.path) ?? FALLBACK_MISSING_BUCKET;
    let group = groupsByKey.get(bucket.key);
    if (!group) {
      group = { bucket, cards: [] };
      groupsByKey.set(bucket.key, group);
      groups.push(group);
    }
    group.cards.push(card);
  }

  return groups;
}

/**
 * Order groups per C4: the manual and missing buckets are partitioned out of
 * the comparator entirely and pinned to the end in both directions — manual
 * first, then missing.
 */
function orderGroups(groups: PendingGroup[], spec: GroupSpec): PendingGroup[] {
  const ordered: PendingGroup[] = [];
  const manual: PendingGroup[] = [];
  const missing: PendingGroup[] = [];

  for (const group of groups) {
    if (group.bucket.isMissing) {
      missing.push(group);
    } else if (group.bucket.key === MANUAL_RULE_BUCKET_KEY) {
      manual.push(group);
    } else {
      ordered.push(group);
    }
  }

  ordered.sort((left, right) => compareGroups(left, right, spec.orderBy));
  if (spec.orderDirection === "desc") {
    ordered.reverse();
  }

  return [...ordered, ...manual, ...missing];
}

/**
 * Pure projection from a flat card array to a grouped card array plus its
 * segment table.
 *
 * Input relative order is preserved inside every group, so the pin-first order
 * established by the preceding pipeline step survives grouping. Collapsed
 * groups drop their cards but keep their segment and full `count`.
 */
export function arrangeCardsByGroup(
  cards: readonly NoteCardRecord[],
  buckets: ReadonlyMap<string, GroupBucket>,
  spec: GroupSpec,
  collapsedKeys: ReadonlySet<string>,
): GroupArrangement {
  if (spec.dimension === "none") {
    return { cards: cards as NoteCardRecord[], segments: [] };
  }

  const groups = orderGroups(partitionIntoGroups(cards, buckets), spec);
  const arrangedCards: NoteCardRecord[] = [];
  const segments: CardGroupSegment[] = [];

  for (const group of groups) {
    const collapsed = collapsedKeys.has(group.bucket.key);
    const startIndex = arrangedCards.length;
    if (!collapsed) {
      for (const card of group.cards) {
        arrangedCards.push(card);
      }
    }

    segments.push({
      key: group.bucket.key,
      label: group.bucket.label,
      detail: group.bucket.detail,
      count: group.cards.length,
      visibleCount: collapsed ? 0 : group.cards.length,
      startIndex,
      collapsed,
      isMissingBucket: group.bucket.isMissing,
    });
  }

  return { cards: arrangedCards, segments };
}
