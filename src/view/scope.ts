import { TFolder, type App } from "obsidian";

import type { CardBoxDefinition, CardBoxSortSpec } from "./types";

/** The folder or card box currently feeding the card stream. */
export type CardScope =
  | { readonly kind: "folder"; readonly path: string; readonly includeSubfolders: boolean }
  | { readonly kind: "box"; readonly boxId: string };

export type FolderScope = Extract<CardScope, { kind: "folder" }>;
export type BoxScope = Extract<CardScope, { kind: "box" }>;

/** `""` is the vault root; the UI's `"/"` spelling is normalized to it. */
export function normalizeScopePath(path: string): string {
  return path === "/" ? "" : path;
}

export function createFolderScope(path: string, includeSubfolders: boolean): CardScope {
  return { kind: "folder", path: normalizeScopePath(path), includeSubfolders };
}

export function createBoxScope(boxId: string): CardScope {
  return { kind: "box", boxId };
}

export function isFolderScope(scope: CardScope): scope is FolderScope {
  return scope.kind === "folder";
}

export function isBoxScope(scope: CardScope): scope is BoxScope {
  return scope.kind === "box";
}

export function scopesEqual(a: CardScope, b: CardScope): boolean {
  if (a.kind === "folder" && b.kind === "folder") {
    return a.path === b.path && a.includeSubfolders === b.includeSubfolders;
  }

  if (a.kind === "box" && b.kind === "box") {
    return a.boxId === b.boxId;
  }

  return false;
}

/** Load key: scope plus sort, plus the box membership signature when relevant. */
export function serializeScopeKey(
  scope: CardScope,
  sort: CardBoxSortSpec,
  membershipSignature?: string,
): string {
  if (scope.kind === "box") {
    return `box::${scope.boxId}::${sort.field}::${sort.direction}::${membershipSignature ?? ""}`;
  }

  return `${scope.path}::${String(scope.includeSubfolders)}::${sort.field}::${sort.direction}`;
}

/** Folder path for display and path-scoped operations; boxes have none. */
export function scopeDisplayPath(scope: CardScope): string {
  return scope.kind === "folder" ? scope.path : "";
}

/** Whether the scope still points at a folder or box that exists. */
export function validateScope(
  app: App,
  scope: CardScope,
  boxes: readonly CardBoxDefinition[],
): boolean {
  if (scope.kind === "box") {
    return boxes.some((box) => box.id === scope.boxId);
  }

  if (scope.path === "") {
    return app.vault.getRoot() instanceof TFolder;
  }

  return app.vault.getAbstractFileByPath(scope.path) instanceof TFolder;
}
