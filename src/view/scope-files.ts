import { TFile, TFolder, type App } from "obsidian";

import { isSupportedCardFile } from "./file-kind";

/**
 * Supported card files in folder-scope order. The caller controls whether the
 * walk is consumed immediately or paused between files.
 */
export function* iterateSupportedFiles(
  app: App,
  folderPath: string,
  includeSubfolders: boolean,
): Generator<TFile> {
  const root = folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
  if (!(root instanceof TFolder)) return;

  if (!includeSubfolders) {
    for (const child of root.children) {
      if (child instanceof TFile && isSupportedCardFile(child)) yield child;
    }
    return;
  }

  const stack: TFolder[] = [root];
  while (stack.length > 0) {
    const folder = stack.pop();
    if (!folder) continue;
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        stack.push(child);
        continue;
      }
      if (child instanceof TFile && isSupportedCardFile(child)) yield child;
    }
  }
}

/** Every supported card file contained by a folder scope. */
export function collectSupportedFiles(
  app: App,
  folderPath: string,
  includeSubfolders: boolean,
): TFile[] {
  return [...iterateSupportedFiles(app, folderPath, includeSubfolders)];
}

/** Whether `path` belongs to the folder scope rooted at `scopePath`. */
export function isPathInFolderScope(
  path: string,
  scopePath: string,
  includeSubfolders: boolean,
): boolean {
  if (scopePath === "") {
    return includeSubfolders || !path.includes("/");
  }

  if (path === scopePath) {
    return true;
  }

  const prefix = `${scopePath}/`;
  if (!path.startsWith(prefix)) {
    return false;
  }

  if (includeSubfolders) {
    return true;
  }

  return !path.slice(prefix.length).includes("/");
}

/** Rewrites a path that points at or inside a renamed folder. */
export { rewritePathReference as rewritePathAfterRename } from "../path-references";
