import type { App } from "obsidian";
import type { GroupSpec } from "../card-grouping-settings";
import {
  normalizePropertyFilterClauses,
  type PropertyFilterClause,
} from "../property-filter-settings";
import { arrangeCardsByGroup, type CardGroupSegment, type GroupBucket } from "./card-grouping";
import { getFileFrontmatter, matchesTagFilter } from "./metadata-utils";
import { matchesPropertyFilters } from "./property-metadata";
import type { CardScope } from "./scope";
import type { NoteCardRecord, PipelineSearchInput } from "./types";

export interface PipelineContext {
  app: App;
  filterTags: string[];
  // Workspace-persisted property clauses; applied in folder scopes only.
  propertyFilters: readonly PropertyFilterClause[];
  // Runtime-only input from FolderCardView; query stays out of persisted settings.
  search: PipelineSearchInput;
  // Explicit ordered pin input for projection; prevents reaching through settings with casts.
  pinnedPaths: string[];
  group: {
    spec: GroupSpec;
    /** One bucket per card, keyed by card path. */
    buckets: ReadonlyMap<string, GroupBucket>;
  };
  // Runtime-only per-view collapse state; never persisted.
  collapsedGroupKeys: ReadonlySet<string>;
}

export interface PipelineResult {
  readonly cards: NoteCardRecord[];
  readonly segments: CardGroupSegment[];
}

export type PipelineStep = (
  cards: NoteCardRecord[],
  context: PipelineContext,
) => NoteCardRecord[];

export function runPipeline(
  cards: NoteCardRecord[],
  steps: PipelineStep[],
  context: PipelineContext,
): PipelineResult {
  let result = cards;
  for (const step of steps) {
    result = step(result, context);
  }
  return applyGroupArrangement(result, context);
}

/**
 * Group arrangement stage.
 *
 * This is a stage rather than a `PipelineStep` because it produces two outputs
 * — the collapse-filtered cards and the segment table — which the
 * `(cards, context) => cards` step signature cannot carry.
 *
 * A non-empty query pauses grouping outright, regardless of search execution
 * state: search results are relevance-ordered, and bucketing them would fight
 * that ordering. The collapse set is left untouched while paused, so clearing
 * the query restores both grouping and collapse.
 */
function applyGroupArrangement(
  cards: NoteCardRecord[],
  context: PipelineContext,
): PipelineResult {
  if (context.search.query.trim().length > 0) {
    return { cards, segments: [] };
  }

  return arrangeCardsByGroup(
    cards,
    context.group.buckets,
    context.group.spec,
    context.collapsedGroupKeys,
  );
}

/** Tag filter step — filter cards by metadata tags using AND logic. */
export function applyTagFilter(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  const filterTags = context.filterTags;

  // Pass-through when no tags are selected (empty filter always matches)
  if (filterTags.length === 0) {
    return cards;
  }

  // Filter cards to only include those matching all selected tags (AND semantics)
  return cards.filter((card) => matchesTagFilter(context.app, card.file, filterTags));
}

/**
 * Property filter step.
 *
 * Values within one clause combine with OR; clauses for different keys combine
 * with AND; `missing` matches a card with no supported scalar for that key.
 * Frontmatter comes from the metadata cache only — no body reads. Passes the
 * original array through (same reference) when no normalized clauses remain.
 */
export function applyPropertyFilter(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  const clauses = normalizePropertyFilterClauses(context.propertyFilters);
  if (clauses.length === 0) {
    return cards;
  }

  const app = context.app;
  return matchesPropertyFilters(cards, clauses, (file) => getFileFrontmatter(app, file));
}

/**
 * Search filter step.
 *
 * Indexed-only semantics:
 * - Empty/whitespace query returns all cards.
 * - Non-empty queries filter only when indexed search explicitly ran.
 * - Non-ready indexed states are blocked query states and project zero cards.
 */
export function applySearchFilter(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  const query = context.search.query;
  if (query.trim().length === 0) {
    return cards;
  }

  if (context.search.execution !== "indexed-ready") {
    return [];
  }

  const orderedPaths = context.search.orderedPaths ?? [];
  const cardsByPath = new Map(cards.map((card) => [card.path, card]));
  const orderedMatches: NoteCardRecord[] = [];

  for (const path of orderedPaths) {
    const card = cardsByPath.get(path);
    if (card) {
      orderedMatches.push(card);
    }
  }

  return orderedMatches;
}

/** Pin reorder step — reorder cards to put pinned paths first while preserving relative order. */
export function applyPinReorder(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  // Guard: empty cards
  if (cards.length === 0) {
    return cards;
  }

  // Guard: no pinnedPaths in explicit pipeline inputs
  const pinnedPaths = context.pinnedPaths;
  if (pinnedPaths.length === 0) {
    return cards;
  }

  // Convert pinnedPaths array to Set for O(1) lookups
  const pinnedSet = new Set(pinnedPaths);

  // Partition cards into pinned and unpinned groups, preserving original relative order
  const pinnedCards: NoteCardRecord[] = [];
  const unpinnedCards: NoteCardRecord[] = [];

  for (const card of cards) {
    if (pinnedSet.has(card.path)) {
      pinnedCards.push(card);
    } else {
      unpinnedCards.push(card);
    }
  }

  // Return pinned cards first, then unpinned cards (both groups preserve input order)
  return [...pinnedCards, ...unpinnedCards];
}

/**
 * The member set (rule hits ∪ manual − excluded) is resolved during box load
 * and digests the rule's property clauses there, so the box pipeline skips
 * the browse tag and property filters and runs `search -> pin`.
 * `context.pinnedPaths` carries the box's own pinned paths.
 *
 * Dispatch is total over `CardScope["kind"]`: the `never` arm exists so a new
 * Card Source must declare its own filter chain rather than silently inheriting
 * Folder's.
 */
export function stepsForScope(scope: CardScope): PipelineStep[] {
  switch (scope.kind) {
    case "folder":
      return [applyTagFilter, applyPropertyFilter, applySearchFilter, applyPinReorder];
    case "box":
      return [applySearchFilter, applyPinReorder];
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}
