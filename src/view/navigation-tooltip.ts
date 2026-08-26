import type { UiStrings } from "../i18n";
import type { NavigationRow } from "./navigation-model";

/** Restore 1.1.5 hover copy: counts for folders/tags/boxes, label for favorites. */
export function resolveNavigationRowTooltip(row: NavigationRow, strings: UiStrings): string {
  const nav = strings.toolbar.navPane;
  if (row.kind === "folder") {
    return nav.folderCountsTooltip(row.recursiveCount, row.recursiveFolderCount);
  }
  if (row.kind === "tag") {
    return nav.tagCountsTooltip(row.count, row.descendantCount);
  }
  if (row.kind === "box") {
    return nav.boxCountsTooltip(row.count);
  }
  if (row.kind === "favorite") {
    return row.missing ? `${row.label} ${nav.favoriteMissing}` : row.label;
  }
  return "";
}
