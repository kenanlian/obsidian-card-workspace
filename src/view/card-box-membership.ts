import type { App, TFile } from "obsidian";
import { matchesTagFilter } from "./metadata-utils";
import type { CardBoxDefinition, Rule } from "./types";

/**
 * Whether a file path is inside a folder scope.
 *
 * Mirrors `FolderCardView.isPathInScope`:
 * - `folder === ""` means the vault root.
 * - `includeSubfolders` controls whether nested folders are in scope.
 */
export function inFolderScope(
  path: string,
  folder: string,
  includeSubfolders: boolean,
): boolean {
  if (folder === "") {
    return includeSubfolders || !path.includes("/");
  }

  if (path === folder) {
    return true;
  }

  const prefix = `${folder}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }

  if (includeSubfolders) {
    return true;
  }

  const relative = path.slice(prefix.length);
  return !relative.includes("/");
}

/**
 * A path matches a rule when it is inside the folder scope AND matches every
 * tag (AND semantics, identical to the browse tag filter).
 *
 * Tag matching resolves the file from `MetadataCache`; it is never gated by the
 * search index readiness state.
 */
export function matchesRule(app: App, path: string, rule: Rule): boolean {
  if (!inFolderScope(path, rule.folder, rule.includeSubfolders)) {
    return false;
  }

  if (rule.tags.length === 0) {
    return true;
  }

  const file = app.vault.getAbstractFileByPath(path) as TFile | null;
  if (!file) {
    return false;
  }

  return matchesTagFilter(app, file, rule.tags);
}

/**
 * Whether a path is a member of a card box.
 *
 * Member ⟺ `path ∈ manualPaths` OR (`∃ rule: matchesRule` AND `path ∉ excludedPaths`).
 * Manual membership always wins over exclusion.
 */
export function isBoxMember(app: App, path: string, box: CardBoxDefinition): boolean {
  if (box.manualPaths.includes(path)) {
    return true;
  }

  if (box.excludedPaths.includes(path)) {
    return false;
  }

  return box.rules.some((rule) => matchesRule(app, path, rule));
}
