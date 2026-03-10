import type { App } from "obsidian";
import type { NoteCardRecord } from "./types";
import type { PluginSettings } from "../settings";
import { matchesTagFilter } from "./metadata-utils";

export interface PipelineContext {
  app: App;
  settings: PluginSettings;
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

/** Search filter step — pass-through until Task 22/27 implement search. */
export function applySearchFilter(cards: NoteCardRecord[], _context: PipelineContext): NoteCardRecord[] {
  return cards;
}

/** Pin reorder step — reorder cards to put pinned paths first while preserving relative order. */
export function applyPinReorder(cards: NoteCardRecord[], context: PipelineContext): NoteCardRecord[] {
  // Guard: empty cards
  if (cards.length === 0) {
    return cards;
  }

  // Guard: no pinnedPaths in settings
  const pinnedPaths = (context.settings as unknown as { pinnedPaths?: string[] }).pinnedPaths;
  if (!pinnedPaths || pinnedPaths.length === 0) {
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
