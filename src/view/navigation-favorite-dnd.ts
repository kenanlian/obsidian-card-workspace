import type { FavoriteEntry, FavoriteKind } from "./types";

/**
 * Presentation state for one favorites row during a manual drag reorder:
 * `draggable` marks drag sources (favorites only), `dragging` highlights the
 * row being dragged, and `dropIndicator` draws the insertion edge on the
 * current drop target. Pure data — the pane owns the reactive state.
 */
export interface NavigationRowDragState {
  draggable: boolean;
  dragging: boolean;
  dropIndicator: "before" | "after" | null;
}

export interface FavoriteDragState {
  source: FavoriteEntry | null;
  target: { rowId: string; position: "before" | "after" } | null;
}

/** Pointer-Y versus row midpoint decides "insert before" or "insert after". */
export function resolveFavoriteDropPosition(
  clientY: number,
  rect: { top: number; height: number },
): "before" | "after" {
  return clientY <= rect.top + rect.height / 2 ? "before" : "after";
}

/** Drops only land inside the favorites section and only within one kind group. */
export function canAcceptFavoriteDrop(
  source: FavoriteEntry | null,
  target: { kind: FavoriteKind },
): boolean {
  return source !== null && source.kind === target.kind;
}

/**
 * Drag-state projection for a projected navigation row. Non-favorite rows are
 * never draggable and never show indicators, so other sections stay inert.
 */
export function favoriteRowDragState(
  row: { kind: string; id: string; favorite?: FavoriteEntry },
  drag: FavoriteDragState,
): NavigationRowDragState | null {
  if (row.kind !== "favorite" || !row.favorite) {
    return null;
  }
  const source = drag.source;
  return {
    draggable: true,
    dragging: source !== null && source.kind === row.favorite.kind && source.ref === row.favorite.ref,
    dropIndicator: source !== null && drag.target?.rowId === row.id ? drag.target.position : null,
  };
}
