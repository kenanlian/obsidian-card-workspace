import type { App } from "obsidian";
import type { PluginSettings } from "../settings";
import { matchesSearchQuery, matchesTagFilter } from "./metadata-utils";
import type { NoteCardRecord, PipelineSearchInput } from "./types";

export interface PipelineContext {
  app: App;
  settings: PluginSettings;
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
  const filterTags = context.settings.filter.tags;

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
 * Fallback semantics:
 * - Empty/whitespace query returns all cards.
 * - Title matching works without cached content.
 * - Content matching uses supplied card excerpt when available.
 */
export function applySearchFilter(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  const query = context.search.query;
  if (query.trim().length === 0) {
    return cards;
  }

  if (Array.isArray(context.search.orderedPaths)) {
    const cardsByPath = new Map(cards.map((card) => [card.path, card]));
    const orderedMatches: NoteCardRecord[] = [];

    for (const path of context.search.orderedPaths) {
      const card = cardsByPath.get(path);
      if (card) {
        orderedMatches.push(card);
      }
    }

    return orderedMatches;
  }

  return cards.filter((card) => {
    const cachedContent = card.excerpt.trim().length > 0 ? card.excerpt : null;
    return matchesSearchQuery(card.file, query, cachedContent);
  });
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

export const DEFAULT_PIPELINE_STEPS: PipelineStep[] = [
  applyTagFilter,
  applySearchFilter,
  applyPinReorder,
];
