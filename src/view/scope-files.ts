import { TFile, TFolder, type App } from "obsidian";

import { isSupportedCardFile } from "./file-kind";

/** Every supported card file contained by a folder scope. */
export function collectSupportedFiles(
  app: App,
  folderPath: string,
  includeSubfolders: boolean,
): TFile[] {
  const root = folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);

  if (!(root instanceof TFolder)) {
    return [];
  }

  if (!includeSubfolders) {
    const directFiles: TFile[] = [];
    for (const child of root.children) {
      if (child instanceof TFile && isSupportedCardFile(child)) {
        directFiles.push(child);
      }
    }

    return directFiles;
  }

  const result: TFile[] = [];
  const stack: TFolder[] = [root];

  while (stack.length > 0) {
    const folder = stack.pop();
    if (!folder) {
      continue;
    }

    for (const child of folder.children) {
      if (child instanceof TFolder) {
        stack.push(child);
        continue;
      }

      if (child instanceof TFile && isSupportedCardFile(child)) {
        result.push(child);
      }
    }
  }

  return result;
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
export function rewritePathAfterRename(
  currentPath: string,
  oldPath: string,
  newPath: string,
): string {
  if (currentPath === "") {
    return currentPath;
  }

  if (currentPath === oldPath) {
    return newPath;
  }

  const prefix = `${oldPath}/`;
  if (!currentPath.startsWith(prefix)) {
    return currentPath;
  }

  return `${newPath}${currentPath.slice(oldPath.length)}`;
}
