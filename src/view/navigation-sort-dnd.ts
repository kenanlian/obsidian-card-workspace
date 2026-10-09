import { tagSortParent, type NavigationSortTarget } from "../navigation-sorting";
import { serializePropertyScalarRef } from "../property-filter-settings";
import type { NavigationRow } from "./navigation-model";
import type { NavigationRowDragState } from "./navigation-favorite-dnd";

export interface NavigationSortEntry { target: NavigationSortTarget; identity: string }
export interface NavigationSortDragState {
  sourceId: string | null;
  target: { rowId: string; position: "before" | "after" } | null;
}
export function navigationSortEntry(row: NavigationRow): NavigationSortEntry | null {
  if (row.disabled) return null;
  switch (row.kind) {
    case "tag": return { target: { kind: "tags", parent: tagSortParent(row.tagPath) }, identity: row.tagPath };
    case "property": return { target: { kind: "property-keys" }, identity: row.propertyKey };
    case "property-value": return row.value.kind === "missing" ? null
      : { target: { kind: "property-values", key: row.propertyKey }, identity: serializePropertyScalarRef(row.value) };
    default: return null;
  }
}
export function canAcceptNavigationSortDrop(source: NavigationRow | undefined, target: NavigationRow): boolean {
  if (!source || source.id === target.id || source.parentId !== target.parentId) return false;
  const left = navigationSortEntry(source), right = navigationSortEntry(target);
  return left !== null && right !== null && left.target.kind === right.target.kind;
}
export function navigationSortRowDragState(row: NavigationRow, drag: NavigationSortDragState): NavigationRowDragState | null {
  if (!navigationSortEntry(row)) return null;
  return { draggable: true, dragging: row.id === drag.sourceId,
    dropIndicator: drag.target?.rowId === row.id ? drag.target.position : null };
}
