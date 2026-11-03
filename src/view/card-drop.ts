import type { PropertyScalarRef } from "../property-filter-settings";

/** Internal navigation destinations; editor insertion retains its own protocol. */
export type CardDropTarget =
  | { kind: "folder"; path: string }
  | { kind: "tag"; tag: string }
  | { kind: "property"; key: string; value: PropertyScalarRef }
  | { kind: "box"; boxId: string };
