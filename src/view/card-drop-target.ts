import type { CardDropTarget } from "./card-drop";
import type { NavigationRow } from "./navigation-model";
/** Activation availability is independent of metadata editing/drop availability. */
export function resolveCardDropTarget(row: NavigationRow): CardDropTarget | null {
  switch (row.kind) {
    case "folder": return { kind: "folder", path: row.folderPath };
    case "tag": return { kind: "tag", tag: row.tagPath };
    case "box": return { kind: "box", boxId: row.boxId };
    case "property-value": return row.value.kind === "missing" || /^(?:tag|tags)$/i.test(row.propertyKey.trim()) ? null
      : { kind: "property", key: row.propertyKey, value: row.value };
    default: return null;
  }
}
