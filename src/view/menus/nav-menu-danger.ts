import type { NavContextMenuPayload, NavMenuDeps } from "../nav-context-menu";

/**
 * Menu-item title that `markMenuItemAsDanger` should highlight, or null.
 * `markMenuItemAsDanger` matches on rendered title text, so the wrong label
 * silently leaves the delete row unstyled.
 */
export function resolveNavMenuDangerLabel(
  payload: NavContextMenuPayload,
  deps: NavMenuDeps,
): string | null {
  if (payload.scope === "header") {
    return null;
  }

  if (payload.section === "folders") {
    return payload.itemId === "/" || typeof payload.itemId !== "string"
      ? null
      : deps.strings.toolbar.folderMenu.deleteFolder;
  }

  if (payload.section === "tags") {
    return typeof payload.itemId === "string" ? deps.strings.view.navMenu.deleteTag : null;
  }

  if (payload.section === "boxes") {
    return typeof payload.itemId === "string" ? deps.strings.box.delete : null;
  }

  if (payload.section === "favorites") {
    const favorite = payload.favorite;
    if (!favorite) {
      return null;
    }
    if (favorite.kind === "folder") {
      return favorite.ref === "" ? null : deps.strings.toolbar.folderMenu.deleteFolder;
    }
    if (favorite.kind === "file") {
      return deps.strings.view.contextMenu.delete;
    }
    if (favorite.kind === "box") {
      return deps.strings.box.delete;
    }
    if (favorite.kind === "tag") {
      return deps.strings.view.navMenu.deleteTag;
    }
  }

  return null;
}
