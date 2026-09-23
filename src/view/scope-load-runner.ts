import type { TFile } from "obsidian";

import { normalizeGroupSpec } from "../card-grouping-settings";
import type { EpochToken } from "./async-epoch";
import { createCardRecord } from "./card-record";
import { resolveCardFileKind } from "./file-kind";
import type { FolderScopeFileCache } from "./folder-scope-file-cache";
import { orderScopeFiles } from "./scope-load-order";
import type { CardScope } from "./scope";
import { scopesEqual } from "./scope";
import { iterateSupportedFiles } from "./scope-files";
import type { CardLoadKey, NoteCardRecord } from "./types";
import { resolveViewConfig } from "./view-config";
import type { ViewContext } from "./view-context";

export interface ScopeLoadRuntime {
  context: ViewContext;
  loadScope: CardLoadKey;
  loadKey: string;
  forceRefresh: boolean;
  startupCardCount: number;
  folderCandidateCache: FolderScopeFileCache;
  collectScopeFiles: (scope: CardScope) => TFile[];
  prepareRecordsFromCache: (records: NoteCardRecord[]) => void;
  projectVisibleCards: () => void;
  hydrateStartupCardPaths: (paths: string[], token: EpochToken) => Promise<void>;
  refreshSearchProjection: () => void;
  publishLoadStart: (scopeChanged: boolean) => void;
  publishPreparedCards: () => void;
  resetHydrationForLoad: () => void;
  resetSearchForLoad: () => void;
  isDisposed: () => boolean;
  setLoading: (loading: boolean) => void;
  setExtentCount: (count: number) => void;
  setMetadataStatus: (status: "pending" | "ready") => void;
  getLoadKey: () => string | null;
  setLoadKey: (key: string | null) => void;
  getLastLoadedIncludeSubfolders: () => boolean | null;
  setLastLoadedIncludeSubfolders: (value: boolean | null) => void;
  setScopeSettled: (settled: boolean) => void;
  consumeQueuedRefresh: () => void;
}

/** Folder scopes remember include-subfolders; box and links scopes do not. */
function resolveLoadedIncludeSubfolders(scope: CardScope): boolean | null {
  switch (scope.kind) {
    case "folder":
      return scope.includeSubfolders;
    case "box": case "links":
      return null;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function yieldMacrotask(context: ViewContext): Promise<void> {
  return new Promise((resolve) => {
    context.getViewWindow().setTimeout(() => resolve(), 0);
  });
}

function isCurrent(runtime: ScopeLoadRuntime, token: EpochToken): boolean {
  return !runtime.isDisposed() && runtime.context.epochs.load.isCurrent(token);
}

function materializeFiles(
  runtime: ScopeLoadRuntime,
  files: readonly TFile[],
  deriveTasks: boolean,
): NoteCardRecord[] {
  const app = runtime.context.getApp();
  const records: NoteCardRecord[] = [];
  for (const file of files) {
    const fileKind = resolveCardFileKind(file);
    if (fileKind !== null) {
      records.push(createCardRecord(app, file, fileKind, deriveTasks));
    }
  }
  return records;
}

function enumerateScopeFiles(
  runtime: ScopeLoadRuntime,
  token: EpochToken,
): TFile[] | null {
  const scope = runtime.loadScope.scope;
  const source = scope.kind === "folder"
    ? iterateSupportedFiles(runtime.context.getApp(), scope.path, scope.includeSubfolders)
    : runtime.collectScopeFiles(scope);
  const accepted: TFile[] = [];
  const iterator = source[Symbol.iterator]();
  while (isCurrent(runtime, token)) {
    const next = iterator.next();
    if (next.done) return accepted;
    accepted.push(next.value);
  }
  iterator.return?.(undefined);
  return null;
}

function startupPaths(runtime: ScopeLoadRuntime): string[] {
  return runtime.context.store.getVisibleCards()
    .slice(0, runtime.startupCardCount)
    .map((card) => card.path);
}

function rememberLoad(runtime: ScopeLoadRuntime): void {
  runtime.setLoadKey(runtime.loadKey);
  runtime.setLastLoadedIncludeSubfolders(resolveLoadedIncludeSubfolders(runtime.loadScope.scope));
}

function releasePrepared(runtime: ScopeLoadRuntime, token: EpochToken, onPublished: () => void): boolean {
  runtime.setExtentCount(runtime.context.store.getVisibleCards().length);
  runtime.setMetadataStatus("ready");
  runtime.setScopeSettled(true);
  runtime.setLoading(false);
  runtime.publishPreparedCards();
  onPublished();
  if (!isCurrent(runtime, token)) return false;
  void runtime.hydrateStartupCardPaths(startupPaths(runtime), token);
  if (!isCurrent(runtime, token)) return false;
  runtime.refreshSearchProjection();
  runtime.consumeQueuedRefresh();
  return true;
}

/**
 * Builds a complete lightweight snapshot, projects it, and publishes it once.
 * Preview hydration starts only after the complete card list is committed.
 */
export async function runScopeLoad(runtime: ScopeLoadRuntime): Promise<boolean> {
  const { context, loadScope } = runtime;
  const previousScope = context.store.getScope();
  const scopeChanged = !scopesEqual(previousScope, loadScope.scope);
  const previousBaseCards = context.store.getBaseCards();
  const previousVisibleCards = context.store.getVisibleCards();
  const previousLoadKey = runtime.getLoadKey();
  const previousIncludeSubfolders = runtime.getLastLoadedIncludeSubfolders();
  if (runtime.forceRefresh && loadScope.scope.kind === "folder") {
    runtime.folderCandidateCache.delete(runtime.loadKey);
  }
  runtime.setLoading(true);
  const loadToken = context.epochs.load.bump();
  let published = false;
  try {
    runtime.setScopeSettled(false);
    runtime.setMetadataStatus("pending");
    runtime.resetHydrationForLoad();
    runtime.resetSearchForLoad();
    // Keep the last committed scope and cards available to the panel until
    // the replacement is complete. The load key carries the requested scope.
    runtime.publishLoadStart(scopeChanged);

    const warmVaultGeneration = context.epochs.vaultContent.value;
    let cachedFiles = !runtime.forceRefresh && loadScope.scope.kind === "folder"
      ? runtime.folderCandidateCache.get(runtime.loadKey)
      : null;
    if (cachedFiles !== null) {
      // Let ScopeController register the in-flight promise before preparation
      // callbacks can reenter selection, without paying for a timer turn.
      await Promise.resolve();
      if (!isCurrent(runtime, loadToken)) return false;
      if (context.epochs.vaultContent.value !== warmVaultGeneration) cachedFiles = null;
    }
    if (cachedFiles === null) {
      await yieldMacrotask(context);
      if (!isCurrent(runtime, loadToken)) return false;
    }

    const candidateVaultGeneration = context.epochs.vaultContent.value;
    const files = cachedFiles ?? enumerateScopeFiles(runtime, loadToken);
    if (files === null || !isCurrent(runtime, loadToken)) return false;
    const orderedFiles = cachedFiles ?? orderScopeFiles(files, loadScope.sort, []);
    if (!isCurrent(runtime, loadToken)) return false;

    const settings = context.getSettings();
    const viewConfig = resolveViewConfig(loadScope.scope, settings);
    const dimension = normalizeGroupSpec(viewConfig.group).dimension;
    const records = materializeFiles(runtime, orderedFiles, dimension === "task");
    if (!isCurrent(runtime, loadToken)) return false;
    runtime.prepareRecordsFromCache(records);
    if (!isCurrent(runtime, loadToken)) return false;
    context.store.setScope(loadScope.scope);
    context.store.replaceBaseCards(records);
    if (!isCurrent(runtime, loadToken)) return false;

    // Projection cache keys include the committed load key. Make this complete
    // base snapshot visible under its own identity, then roll back the identity
    // if projection is interrupted before the prepared publish.
    rememberLoad(runtime);
    try {
      runtime.projectVisibleCards();
    } catch (error) {
      runtime.setLoadKey(previousLoadKey);
      runtime.setLastLoadedIncludeSubfolders(previousIncludeSubfolders);
      throw error;
    }
    if (!isCurrent(runtime, loadToken)) {
      runtime.setLoadKey(previousLoadKey);
      runtime.setLastLoadedIncludeSubfolders(previousIncludeSubfolders);
      return false;
    }
    const committed = releasePrepared(runtime, loadToken, () => { published = true; });
    if (committed && isCurrent(runtime, loadToken) && loadScope.scope.kind === "folder"
      && context.epochs.vaultContent.value === candidateVaultGeneration) {
      runtime.folderCandidateCache.set(runtime.loadKey, orderedFiles);
    }
    return committed;
  } finally {
    if (!published && isCurrent(runtime, loadToken)) {
      runtime.setLoadKey(previousLoadKey);
      runtime.setLastLoadedIncludeSubfolders(previousIncludeSubfolders);
      context.store.setScope(previousScope);
      context.store.replaceBaseCards([...previousBaseCards]);
      context.store.replaceVisibleCards([...previousVisibleCards]);
      runtime.setExtentCount(context.store.getVisibleCards().length);
      runtime.setMetadataStatus("ready");
      runtime.setScopeSettled(true);
      runtime.setLoading(false);
      runtime.publishLoadStart(false);
      runtime.refreshSearchProjection();
      runtime.consumeQueuedRefresh();
    }
  }
}
