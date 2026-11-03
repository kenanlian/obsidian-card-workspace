import { type IconTarget, normalizeIconTarget } from "../icon-config";
import type { NavigationMenuTarget } from "./navigation-model";
/** Favorites are aliases; their own row ID is never persisted as an icon target. */
export function navigationIconTarget(target: NavigationMenuTarget): IconTarget | null {
  if (target.scope !== "item") return null;
  if (target.section === "favorites") return normalizeIconTarget({ kind: target.favorite.kind, ref: target.favorite.ref });
  if (target.section === "properties") return normalizeIconTarget({ kind: target.value ? "property-value" : "property", ref: target.itemId, value: target.value });
  const kind = ({ folders: "folder", tags: "tag", boxes: "box", templates: "template", links: "links" } as const)[target.section];
  return kind ? normalizeIconTarget({ kind, ref: target.itemId }) : null;
}
