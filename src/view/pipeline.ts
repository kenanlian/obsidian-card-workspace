import type { App } from "obsidian";
import { matchesTagFilter } from "./metadata-utils";
import type { CardScope } from "./scope";
import type { NoteCardRecord, PipelineSearchInput } from "./types";

export interface PipelineContext {
  app: App;
  filterTags: string[];
  // Runtime-only input from FolderCardView; query stays out of persisted settings.
  search: PipelineSearchInput;
  // Explicit ordered pin input for projection; prevents reaching through settings with casts.
  pinnedPaths: string[];
}

export type PipelineStep = (
  cards: NoteCardRecord[],
  context: PipelineContext,
) => NoteCardRecord[];

export function runPipeline(
  cards: NoteCardRecord[],
  steps: PipelineStep[],
  context: PipelineContext,
): NoteCardRecord[] {
  let result = cards;
  for (const step of steps) {
    result = step(result, context);
  }
  return result;
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
 * The member set (rule hits ∪ manual − excluded) is resolved during box load,
 * so the box pipeline skips the browse tag filter and only runs
 * `search -> pin`. `context.pinnedPaths` carries the box's own pinned paths.
 */
export function stepsForScope(scope: CardScope): PipelineStep[] {
  return scope.kind === "box"
    ? [applySearchFilter, applyPinReorder]
    : [applyTagFilter, applySearchFilter, applyPinReorder];
}
