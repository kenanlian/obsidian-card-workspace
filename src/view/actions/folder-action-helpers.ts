import { TFolder } from "obsidian";

import { normalizeScopePath } from "../scope";

/** Pure helpers used by `FolderActions`, split out to keep that file under the line budget. */

export function buildSiblingPath(parentPath: string, fileName: string): string {
  const scopePath = normalizeScopePath(parentPath);
  if (scopePath.length === 0) {
    return fileName;
  }

  return `${scopePath}/${fileName}`;
}

export function countFilesInFolder(folder: TFolder): number {
  let total = 0;
  for (const child of folder.children) {
    if (child instanceof TFolder) {
      total += countFilesInFolder(child);
      continue;
    }
    total += 1;
  }
  return total;
}

export function getFallbackFolderPathAfterFolderDeletion(
  currentFolderPath: string,
  deletedPath: string,
): string | null {
  if (currentFolderPath !== deletedPath && !currentFolderPath.startsWith(`${deletedPath}/`)) {
    return null;
  }

  return "";
}
