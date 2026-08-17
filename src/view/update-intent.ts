import type { PluginSettings } from "../settings";
import { getBoxMembershipSignature } from "./card-boxes";
import { isBoxScope, type CardScope } from "./scope";
import type { CardBoxDefinition, FavoriteEntry } from "./types";

/**
 * Update strength, weakest to strongest. When a settings key is added, update
 * both resolveSettingsUpdateIntent and its exhaustive expectation table.
 */
export type ViewUpdateIntent = "patch" | "reproject" | "rehydrate" | "reload";

export const UPDATE_INTENT_RANK: Record<ViewUpdateIntent, number> = {
  patch: 0,
  reproject: 1,
  rehydrate: 2,
  reload: 3,
};

export function maxIntent(a: ViewUpdateIntent, b: ViewUpdateIntent): ViewUpdateIntent {
  return UPDATE_INTENT_RANK[a] >= UPDATE_INTENT_RANK[b] ? a : b;
}

function mergeIntent(
  current: ViewUpdateIntent | null,
  next: ViewUpdateIntent | null,
): ViewUpdateIntent | null {
  if (next === null) {
    return current;
  }
  return current === null ? next : maxIntent(current, next);
}

function stringArraysEqual(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function favoritesEqual(
  previous: readonly FavoriteEntry[],
  next: readonly FavoriteEntry[],
): boolean {
  return previous.length === next.length && previous.every(
    (favorite, index) => favorite.kind === next[index]?.kind && favorite.ref === next[index]?.ref,
  );
}

export function resolveBoxesUpdateIntent(
  previousBoxes: readonly CardBoxDefinition[],
  nextBoxes: readonly CardBoxDefinition[],
  activeBoxId: string | null,
): ViewUpdateIntent | null {
  if (JSON.stringify(previousBoxes) === JSON.stringify(nextBoxes)) {
    return null;
  }
  if (activeBoxId === null) {
    return "patch";
  }

  const previousBox = previousBoxes.find((box) => box.id === activeBoxId);
  const nextBox = nextBoxes.find((box) => box.id === activeBoxId);
  if (!previousBox || !nextBox) {
    return "patch";
  }
  if (getBoxMembershipSignature(previousBox) !== getBoxMembershipSignature(nextBox)) {
    return "reload";
  }

  const sortChanged = previousBox.sort.field !== nextBox.sort.field
    || previousBox.sort.direction !== nextBox.sort.direction;
  return sortChanged || !stringArraysEqual(previousBox.pinnedPaths, nextBox.pinnedPaths)
    ? "reproject"
    : "patch";
}

/**
 * Compares every PluginSettings key by semantic value. Keep this resolver and
 * its exhaustive test expectation table synchronized when adding a setting.
 */
export function resolveSettingsUpdateIntent(
  previous: PluginSettings,
  next: PluginSettings,
  scope?: CardScope,
): ViewUpdateIntent | null {
  let intent: ViewUpdateIntent | null = null;

  if (previous.includeSubfolders !== next.includeSubfolders) {
    intent = mergeIntent(intent, "reload");
  }

  if (!stringArraysEqual(previous.filter.tags, next.filter.tags)) {
    intent = mergeIntent(intent, "reproject");
  }
  if (!stringArraysEqual(previous.pinnedPaths, next.pinnedPaths)) {
    intent = mergeIntent(intent, "reproject");
  }
  if (previous.sort.field !== next.sort.field || previous.sort.direction !== next.sort.direction) {
    intent = mergeIntent(intent, "reproject");
  }

  if (previous.previewLines !== next.previewLines) {
    intent = mergeIntent(intent, "rehydrate");
  }

  if (previous.defaultView !== next.defaultView) intent = mergeIntent(intent, "patch");
  if (previous.defaultCardOpenBehavior !== next.defaultCardOpenBehavior) intent = mergeIntent(intent, "patch");
  if (previous.dragInsertAction !== next.dragInsertAction) intent = mergeIntent(intent, "patch");
  if (previous.cardCornerRadius !== next.cardCornerRadius) intent = mergeIntent(intent, "patch");
  if (previous.newNoteTemplate !== next.newNoteTemplate) intent = mergeIntent(intent, "patch");
  if (previous.lastFolderPath !== next.lastFolderPath) intent = mergeIntent(intent, "patch");
  if (!favoritesEqual(previous.favorites, next.favorites)) intent = mergeIntent(intent, "patch");
  if (previous.activeBoxId !== next.activeBoxId) intent = mergeIntent(intent, "patch");
  if (previous.navPaneWidth !== next.navPaneWidth) intent = mergeIntent(intent, "patch");
  if (previous.navPaneCollapsed !== next.navPaneCollapsed) intent = mergeIntent(intent, "patch");
  if (previous.folderSectionCollapsed !== next.folderSectionCollapsed) intent = mergeIntent(intent, "patch");
  if (previous.tagSectionCollapsed !== next.tagSectionCollapsed) intent = mergeIntent(intent, "patch");
  if (previous.boxSectionCollapsed !== next.boxSectionCollapsed) intent = mergeIntent(intent, "patch");
  if (previous.favoritesSectionCollapsed !== next.favoritesSectionCollapsed) intent = mergeIntent(intent, "patch");
  if (previous.showNavItemCounts !== next.showNavItemCounts) intent = mergeIntent(intent, "patch");

  // SettingsStore callers have no view scope and retain the global/default
  // classification. View dispatch must always pass its runtime scope (C7).
  const activeBoxId = scope === undefined
    ? next.activeBoxId
    : isBoxScope(scope) ? scope.boxId : null;
  return mergeIntent(intent, resolveBoxesUpdateIntent(previous.boxes, next.boxes, activeBoxId));
}
