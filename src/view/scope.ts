import { TFile, TFolder, type App } from "obsidian";

import type { CardBoxDefinition, CardBoxSortSpec } from "./types";

/** The folder, card box, or links source currently feeding the card stream. */
export type CardScope =
  | { readonly kind: "folder"; readonly path: string; readonly includeSubfolders: boolean }
  | { readonly kind: "box"; readonly boxId: string }
  | { readonly kind: "links"; readonly notePath: string; readonly direction: "backlinks" | "outgoing" };

export type FolderScope = Extract<CardScope, { kind: "folder" }>;
export type BoxScope = Extract<CardScope, { kind: "box" }>;
export type LinksScope = Extract<CardScope, { kind: "links" }>;

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

export function createLinksScope(
  notePath: string,
  direction: LinksScope["direction"],
): CardScope {
  return { kind: "links", notePath, direction };
}

export function isFolderScope(scope: CardScope): scope is FolderScope {
  return scope.kind === "folder";
}

export function isBoxScope(scope: CardScope): scope is BoxScope {
  return scope.kind === "box";
}

export function isLinksScope(scope: CardScope): scope is LinksScope {
  return scope.kind === "links";
}

export function scopesEqual(a: CardScope, b: CardScope): boolean {
  switch (a.kind) {
    case "folder":
      return b.kind === "folder" && a.path === b.path && a.includeSubfolders === b.includeSubfolders;
    case "box":
      return b.kind === "box" && a.boxId === b.boxId;
    case "links":
      return b.kind === "links" && a.notePath === b.notePath && a.direction === b.direction;
    default: {
      const exhaustive: never = a;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Load key: scope plus sort, plus the box membership signature when relevant. */
export function serializeScopeKey(
  scope: CardScope,
  sort: CardBoxSortSpec,
  membershipSignature?: string,
): string {
  switch (scope.kind) {
    case "box":
      return `box::${scope.boxId}::${sort.field}::${sort.direction}::${membershipSignature ?? ""}`;
    case "folder":
      return `${scope.path}::${String(scope.includeSubfolders)}::${sort.field}::${sort.direction}`;
    case "links":
      return `links::${scope.notePath}::${scope.direction}::${sort.field}::${sort.direction}`;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Runtime identity of a scope, independent of sort and box membership.
 *
 * Deliberately not `serializeScopeKey`: that key embeds sort, so runtime state
 * keyed by it would reset on every sort change.
 */
export function scopeIdentity(scope: CardScope): string {
  switch (scope.kind) {
    case "box":
      return `box:${scope.boxId}`;
    case "folder":
      return `folder:${scope.path}:${String(scope.includeSubfolders)}`;
    case "links":
      return `links:${scope.notePath}:${scope.direction}`;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Folder path for display and path-scoped operations; boxes and links have none. */
export function scopeDisplayPath(scope: CardScope): string {
  switch (scope.kind) {
    case "folder":
      return scope.path;
    case "box":
    case "links":
      return "";
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Whether a folder reference (favorite row, nav row, browse target) is the
 * folder the scope is currently showing. Box and links sources show no current
 * folder; a later source must choose this explicitly rather than inheriting Folder.
 */
export function isCurrentFolderPath(scope: CardScope, folderPath: string): boolean {
  switch (scope.kind) {
    case "folder":
      return normalizeScopePath(folderPath) === scope.path;
    case "box":
    case "links":
      return false;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Whether a box reference is the box the scope is currently showing. Folder
 * and links sources show no current box; a later source must choose explicitly.
 */
export function isCurrentBoxId(scope: CardScope, boxId: string): boolean {
  switch (scope.kind) {
    case "box":
      return scope.boxId === boxId;
    case "folder":
    case "links":
      return false;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Folder browse include-subfolders state, with the global setting as the
 * fallback for sources that carry no folder of their own.
 */
export function resolveBrowseIncludeSubfolders(scope: CardScope, fallback: boolean): boolean {
  switch (scope.kind) {
    case "folder":
      return scope.includeSubfolders;
    case "box":
    case "links":
      return fallback;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Folder path the scope is showing, or null when the source has none. */
export function resolveScopeFolderPath(scope: CardScope): string | null {
  switch (scope.kind) {
    case "folder":
      return scope.path;
    case "box":
    case "links":
      return null;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Folder used for toolbar new-note. Folder scopes use their own path
 * (including `""` for vault root). Box and links fall back to the persisted
 * last-folder path and do not switch scope.
 */
export function resolveNewNoteFolderPath(scope: CardScope, fallback: string): string {
  switch (scope.kind) {
    case "folder":
      return scope.path;
    case "box":
    case "links":
      return fallback;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** Whether the scope still points at a folder, box, or links source note that exists. */
export function validateScope(
  app: App,
  scope: CardScope,
  boxes: readonly CardBoxDefinition[],
): boolean {
  switch (scope.kind) {
    case "box":
      return boxes.some((box) => box.id === scope.boxId);
    case "folder": {
      if (scope.path === "") {
        return app.vault.getRoot() instanceof TFolder;
      }

      return app.vault.getAbstractFileByPath(scope.path) instanceof TFolder;
    }
    case "links":
      return app.vault.getAbstractFileByPath(scope.notePath) instanceof TFile;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}
