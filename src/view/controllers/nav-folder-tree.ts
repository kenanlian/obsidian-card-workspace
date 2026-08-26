import { TFile, TFolder, type App } from "obsidian";

import { isSupportedCardFile } from "../file-kind";
import { normalizeScopePath } from "../scope";
import type { FolderTreeNode } from "../types";

export function buildNavigationFolderTree(app: App): FolderTreeNode[] {
  const vault = app.vault as unknown as { getRoot?: unknown };
  if (typeof vault.getRoot !== "function") return [];

  const countDirectFiles = (folder: TFolder): number => folder.children.reduce(
    (total, child) => total + (child instanceof TFile && isSupportedCardFile(child) ? 1 : 0),
    0,
  );
  const buildNode = (folder: TFolder, depth: number): FolderTreeNode => {
    const subfolders = folder.children
      .filter((child): child is TFolder => child instanceof TFolder)
      .sort((left, right) => left.name.localeCompare(right.name));
    const children = subfolders.map((subfolder) => buildNode(subfolder, depth + 1));
    const directCount = countDirectFiles(folder);
    return {
      name: folder.name || "/", path: folder.path === "" ? "/" : folder.path, children, depth,
      directCount,
      recursiveCount: children.reduce((total, child) => total + child.recursiveCount, directCount),
      recursiveFolderCount: children.reduce(
        (total, child) => total + 1 + child.recursiveFolderCount, 0,
      ),
    };
  };

  const root = app.vault.getRoot();
  const children = root.children
    .filter((child): child is TFolder => child instanceof TFolder)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((subfolder) => buildNode(subfolder, 0));
  const directCount = countDirectFiles(root);
  return [{
    name: root.name || "/", path: "/", children: [], depth: 0, directCount,
    recursiveCount: children.reduce((total, node) => total + node.recursiveCount, directCount),
    recursiveFolderCount: children.reduce(
      (total, node) => total + 1 + node.recursiveFolderCount, 0,
    ),
  }, ...children];
}

export function cacheNavigationFolderCounts(
  tree: readonly FolderTreeNode[],
): Map<string, { direct: number; recursive: number }> {
  const counts = new Map<string, { direct: number; recursive: number }>();
  const visit = (node: FolderTreeNode): void => {
    counts.set(normalizeScopePath(node.path), { direct: node.directCount, recursive: node.recursiveCount });
    node.children.forEach(visit);
  };
  tree.forEach(visit);
  return counts;
}
