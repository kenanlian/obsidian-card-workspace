import { tagSortParent, type NavigationSortTarget } from "../navigation-sorting";
import { serializePropertyScalarRef } from "../property-filter-settings";
import type { NavigationRow } from "./navigation-model";
import type { NavigationRowDragState } from "./navigation-favorite-dnd";

export type NavigationReorderTarget = NavigationSortTarget | { kind: "boxes" } | { kind: "templates" } | { kind: "links" } | { kind: "sections" };
export interface NavigationSortEntry { target: NavigationReorderTarget; identity: string }
export interface NavigationSortDragState {
  sourceId: string | null;
  target: { rowId: string; position: "before" | "after" } | null;
}
export function navigationSortEntry(row: NavigationRow): NavigationSortEntry | null {
  switch (row.kind) {
    case "section": return { target: { kind: "sections" }, identity: row.section };
    case "box": return { target: { kind: "boxes" }, identity: row.boxId };
    case "template": return { target: { kind: "templates" }, identity: row.templateId };
    case "links": return { target: { kind: "links" }, identity: row.direction };
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
  if (!left || !right || left.target.kind !== right.target.kind) return false;
  if (left.target.kind === "tags") return right.target.kind === "tags" && left.target.parent === right.target.parent;
  if (left.target.kind === "property-values") return right.target.kind === "property-values" && left.target.key === right.target.key;
  return true;
}
export function navigationSortRowDragState(row: NavigationRow, drag: NavigationSortDragState): NavigationRowDragState | null {
  if (!navigationSortEntry(row)) return null;
  return { draggable: true, dragging: row.id === drag.sourceId,
    dropIndicator: drag.target?.rowId === row.id ? drag.target.position : null };
}
