import { TFile, type App } from "obsidian";

import { resolveCardFileKind, resolveCardFileKindFromPath } from "./file-kind";
import {
  createLinksScope,
  isLinksScope,
  type CardScope,
  type LinksScope,
} from "./scope";

/**
 * Read-only link-graph helpers for a Links card source.
 *
 * Backlinks scan `metadataCache.resolvedLinks` (installed Obsidian API has no
 * `getBacklinksForFile`). Destination keys are vault-absolute `TFile.path`
 * values per the installed `obsidian.d.ts` and resolve through
 * `vault.getAbstractFileByPath`; no `getFirstLinkpathDest` fallback.
 *
 * v1 limitation: this module never subscribes to metadataCache `"resolved"`
 * (R6). Graph freshness rides the `"changed"` reconcile path plus the
 * vault-event debounce (settled decision 8).
 *
 * Pure functions only: no `.on`/`.off`, no Notice, no settings.
 */

type ResolvedLinks = Record<string, Record<string, number>>;

function readResolvedLinks(app: App): ResolvedLinks {
  const raw = app.metadataCache?.resolvedLinks;
  if (raw == null || typeof raw !== "object") {
    return {};
  }
  return raw;
}

function readDestMap(resolvedLinks: ResolvedLinks, sourcePath: string): Record<string, number> {
  const raw = resolvedLinks[sourcePath];
  if (raw == null || typeof raw !== "object") {
    return {};
  }
  return raw;
}

function asSupportedCardFile(app: App, path: string): TFile | null {
  const abstract = app.vault.getAbstractFileByPath(path);
  if (!(abstract instanceof TFile)) {
    return null;
  }
  if (resolveCardFileKind(abstract) === null) {
    return null;
  }
  return abstract;
}

function candidatePaths(app: App, scope: LinksScope): string[] {
  const resolvedLinks = readResolvedLinks(app);
  if (scope.direction === "backlinks") {
    return Object.keys(resolvedLinks);
  }
  return Object.keys(readDestMap(resolvedLinks, scope.notePath));
}

/** C10 + C8: resolved, supported card files linked to `scope.notePath`, excluding the source itself. */
export function collectLinksFiles(app: App, scope: LinksScope): TFile[] {
  const files: TFile[] = [];
  for (const path of candidatePaths(app, scope)) {
    if (!isLinksMember(app, scope, path)) {
      continue;
    }
    const file = asSupportedCardFile(app, path);
    if (file) {
      files.push(file);
    }
  }
  return files;
}

/**
 * C10 membership used by reconcile: backlinks require a supported linker whose
 * dest map contains `notePath`; outgoing requires a supported dest listed on
 * the source note. The source note is never a member of itself.
 */
export function isLinksMember(app: App, scope: LinksScope, path: string): boolean {
  if (path === scope.notePath) {
    return false;
  }
  if (asSupportedCardFile(app, path) === null) {
    return false;
  }

  const resolvedLinks = readResolvedLinks(app);
  if (scope.direction === "backlinks") {
    return scope.notePath in readDestMap(resolvedLinks, path);
  }
  return path in readDestMap(resolvedLinks, scope.notePath);
}

/** C11: source note or any supported card-file extension (graph-unevaluable after delete). */
export function isPathRelevantToLinksScope(scope: LinksScope, path: string): boolean {
  return path === scope.notePath || resolveCardFileKindFromPath(path) !== null;
}

/**
 * C4 follow decision: re-point a links scope to `selectedPath`, preserving
 * direction. Returns `null` when pinned, not a links scope, path is missing,
 * or the path is already the source note.
 */
export function resolveLinksFollowScope(
  scope: CardScope,
  selectedPath: string | null,
  pinned: boolean,
): CardScope | null {
  if (pinned || selectedPath === null || !isLinksScope(scope) || selectedPath === scope.notePath) {
    return null;
  }
  return createLinksScope(selectedPath, scope.direction);
}
