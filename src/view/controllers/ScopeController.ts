import { TFile } from "obsidian";

import { AsyncEpoch, type EpochToken } from "../async-epoch";
import { createCardRecord } from "../card-record";
import { compareCards, findSortedInsertIndex } from "../card-sort";
import { findCardBox, getBoxMembershipSignature } from "../card-boxes";
import { resolveCardFileKind, resolveCardFileKindFromPath } from "../file-kind";
import { createFolderScope, scopeDisplayPath, scopesEqual,
  serializeScopeKey, validateScope, type BoxScope, type CardScope } from "../scope";
import { resolveViewConfig } from "../view-config";
import { collectSupportedFiles, isPathInFolderScope, rewritePathAfterRename } from "../scope-files";
import type {
  CardLoadKey,
  FolderSelectionRequest,
  NoteCardRecord,
  RefreshRequest,
  RefreshResult,
  SelectionResult,
  VaultMutationEvent,
  VaultMutationResult,
} from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";
import {
  applyIncrementalMutation,
  type BulkSelectionState,
} from "./incremental-mutation";

const VAULT_REFRESH_DEBOUNCE_MS = 250;

/** Result of one metadata-path Box membership reconciliation. */
export type MetadataMembershipOutcome = "unchanged" | "entered" | "left";

/** Folder scopes remember their loaded include-subfolders state; others have none. */
function resolveLoadedIncludeSubfolders(scope: CardScope): boolean | null {
  switch (scope.kind) {
    case "folder":
      return scope.includeSubfolders;
    case "box":
      return null;
    default: {
      const exhaustive: never = scope;
      throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export interface ScopeControllerDeps {
  context: ViewContext;
  collectBoxFiles: (boxId: string) => TFile[];
  isPathInBox: (path: string, boxId: string) => boolean;
  deriveVisibleCardsFrom: (cards: readonly NoteCardRecord[]) => NoteCardRecord[];
  projectVisibleCards: () => void;
  getBulkSelection: () => BulkSelectionState;
  setBulkSelection: (state: BulkSelectionState) => void;
  clearBulkSelection: () => void;
  hasPendingHydration: (path: string) => boolean; deletePendingHydration: (path: string) => boolean;
  resetHydrationForLoad: () => void; prepareRecordsFromCache: (records: NoteCardRecord[]) => void;
  invalidateForVaultMutation: (event: VaultMutationEvent) => void;
  hydrateStartupCardPaths: (paths: string[], token: EpochToken) => Promise<void>;
  scheduleHydrationPath: (path: string) => void;
  resetSearchForLoad: () => void;
  refreshSearchProjection: () => void;
  scheduleNavCountRefresh: () => void;
  refreshFolderTreeState: () => void;
  scheduleFolderTreeRefresh: () => void;
  publishLoadStart: (scopeChanged: boolean) => void; publishLoadCommit: () => void;
  startupCardCount: number;
}

/** Owns runtime scope selection, the single-flight load queue, and vault refresh decisions. */
export class ScopeController implements DisposableController {
  private loading = false;
  private loadKey: string | null = null;
  private lastLoadedIncludeSubfolders: boolean | null = null;
  private inFlight: Promise<boolean> | null = null;
  private inFlightKey: string | null = null;
  private inFlightLoadScope: CardLoadKey | null = null;
  private queuedRequest: FolderSelectionRequest | null = null;
  private refreshQueued = false;
  private vaultRefreshTimer: ReturnType<Window["setTimeout"]> | null = null;
  private readonly selectionEpoch = new AsyncEpoch();

  constructor(private readonly deps: ScopeControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  getLoadKey(): string | null {
    return this.loadKey;
  }

  isLoading(): boolean {
    return this.loading;
  }

  getLastLoadedIncludeSubfolders(): boolean | null {
    return this.lastLoadedIncludeSubfolders;
  }

  buildLoadKey(scope: CardScope): CardLoadKey {
    return { scope, sort: resolveViewConfig(scope, this.context.getSettings()).sort };
  }

  serializeLoadKey(loadKey: CardLoadKey): string {
    switch (loadKey.scope.kind) {
      case "box": {
        const box = findCardBox(this.context.getSettings().boxes ?? [], loadKey.scope.boxId);
        return serializeScopeKey(
          loadKey.scope,
          loadKey.sort,
          box ? getBoxMembershipSignature(box) : "",
        );
      }
      case "folder":
        return serializeScopeKey(loadKey.scope, loadKey.sort);
      default: {
        const exhaustive: never = loadKey.scope;
        throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  refreshLoadKeyForCurrentScope(): void {
    this.loadKey = this.serializeLoadKey(this.buildLoadKey(this.context.store.getScope()));
  }

  createProgrammaticSelectionRequest(
    scope: CardScope,
    forceRefresh: boolean,
  ): FolderSelectionRequest {
    return {
      requestId: this.selectionEpoch.bump().value,
      scope,
      source: "programmatic",
      requestedAtMs: Date.now(),
      forceRefresh,
    };
  }

  async moveScopeToFolder(path: string): Promise<SelectionResult> {
    return this.handleScopeSelection(this.createProgrammaticSelectionRequest(
      createFolderScope(path, this.context.getSettings().includeSubfolders),
      false,
    ));
  }

  async handleScopeSelection(request: FolderSelectionRequest): Promise<SelectionResult> {
    if (!validateScope(this.context.getApp(), request.scope, this.context.getSettings().boxes ?? [])) {
      return {
        action: "rejected_invalid",
        scope: request.scope,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const forceRefresh = request.forceRefresh ?? false;
    const nextLoadScope = this.buildLoadKey(request.scope);
    const nextKey = this.serializeLoadKey(nextLoadScope);
    const clearedBulkSelection = this.reconcileBulkSelectionBeforeLoad(nextLoadScope);

    if (this.inFlight) {
      if (clearedBulkSelection) {
        this.context.publishGroups("cards", "bulk");
      }
      if (!forceRefresh && this.inFlightKey === nextKey) {
        return {
          action: "reused_inflight",
          scope: request.scope,
          generationChanged: false,
          preserveUiState: true,
        };
      }
      this.queuedRequest = request;
      return {
        action: "queued_latest",
        scope: request.scope,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    if (!forceRefresh && this.loadKey === nextKey) {
      return {
        action: "noop",
        scope: request.scope,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const scopeBeforeRequest = this.context.store.getScope();
    const committed = await this.runLoad(nextLoadScope, nextKey);
    await this.drainQueuedRequest();
    if (committed && !scopesEqual(scopeBeforeRequest, this.context.store.getScope())) {
      await this.persistScopeProjection();
    }

    return {
      action: "started",
      scope: request.scope,
      generationChanged: true,
      preserveUiState: false,
    };
  }

  async refresh(request: RefreshRequest = { reason: "manual" }): Promise<RefreshResult> {
    if (request.reason === "vault-change") {
      this.refreshQueued = false;
    }
    const current = this.context.store.getScope();
    let scope: CardScope = current;
    switch (current.kind) {
      case "folder":
        scope = createFolderScope(current.path, this.context.getSettings().includeSubfolders);
        break;
      case "box":
        break;
      default: {
        const exhaustive: never = current;
        throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
      }
    }
    const result = await this.handleScopeSelection(
      this.createProgrammaticSelectionRequest(scope, request.forceRefresh ?? true),
    );
    if (result.action === "rejected_invalid") {
      return { action: "skipped_invalid_folder", inFlightKey: this.inFlightKey };
    }
    return {
      action: result.action === "started" ? "started" : "queued_latest",
      inFlightKey: this.inFlightKey,
    };
  }

  private reconcileBulkSelectionBeforeLoad(nextLoadScope: CardLoadKey): boolean {
    if (!this.shouldClearBulkSelectionForScopeChange(nextLoadScope)) {
      return false;
    }
    this.deps.clearBulkSelection();
    return true;
  }

  private shouldClearBulkSelectionForScopeChange(nextLoadScope: CardLoadKey): boolean {
    const current = this.inFlightLoadScope?.scope ?? this.context.store.getScope();
    return !scopesEqual(current, nextLoadScope.scope);
  }

  private async runLoad(loadScope: CardLoadKey, loadKey: string): Promise<boolean> {
    const task = this.loadScope(loadScope, loadKey);
    this.inFlight = task;
    this.inFlightKey = loadKey;
    this.inFlightLoadScope = loadScope;
    try {
      return await task;
    } finally {
      if (this.inFlight === task) {
        this.inFlight = null;
        this.inFlightKey = null;
        this.inFlightLoadScope = null;
      }
    }
  }

  private async loadScope(loadScope: CardLoadKey, loadKey: string): Promise<boolean> {
    const scopeChanged = !scopesEqual(this.context.store.getScope(), loadScope.scope);
    this.context.store.setScope(loadScope.scope);
    this.loading = true;
    const loadToken = this.context.epochs.load.bump();
    this.deps.resetHydrationForLoad();
    this.deps.resetSearchForLoad();
    if (scopeChanged) {
      this.context.store.replaceBaseCards([]); this.context.store.replaceVisibleCards([]);
    }
    this.deps.publishLoadStart(scopeChanged);

    try {
      const app = this.context.getApp();
      const records = this.collectScopeFiles(loadScope.scope).flatMap((file) => {
        const fileKind = resolveCardFileKind(file);
        return fileKind === null ? [] : [createCardRecord(app, file, fileKind)];
      });
      if (!this.context.epochs.load.isCurrent(loadToken)) {
        return false;
      }
      this.deps.prepareRecordsFromCache(records);
      records.sort((left, right) =>
        compareCards(left, right, loadScope.sort.field, loadScope.sort.direction));
      this.context.store.replaceBaseCards(records);
      this.loadKey = loadKey;
      this.lastLoadedIncludeSubfolders = resolveLoadedIncludeSubfolders(loadScope.scope);
      const startupPaths = this.deps.deriveVisibleCardsFrom(records)
        .slice(0, this.deps.startupCardCount)
        .map((card) => card.path);
      await this.deps.hydrateStartupCardPaths(startupPaths, loadToken);
      return this.context.epochs.load.isCurrent(loadToken);
    } finally {
      if (this.context.epochs.load.isCurrent(loadToken)) {
        this.loading = false;
        this.deps.projectVisibleCards();
        this.deps.publishLoadCommit();
        this.deps.refreshSearchProjection();
      }
    }
  }

  private async drainQueuedRequest(): Promise<void> {
    if (this.inFlight || this.queuedRequest === null) {
      return;
    }
    const request = this.queuedRequest;
    this.queuedRequest = null;
    await this.handleScopeSelection(request);
  }

  private async persistScopeProjection(): Promise<void> {
    const scope = this.context.store.getScope();
    const settings = this.context.getSettings();
    switch (scope.kind) {
      case "folder":
        if (settings.lastFolderPath === scope.path && settings.activeBoxId === null) {
          return;
        }
        await this.context.saveSettings({ lastFolderPath: scope.path, activeBoxId: null });
        return;
      case "box":
        if (settings.activeBoxId !== scope.boxId) {
          await this.context.saveSettings({ activeBoxId: scope.boxId });
        }
        return;
      default: {
        const exhaustive: never = scope;
        throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  collectScopeFiles(scope: CardScope): TFile[] {
    switch (scope.kind) {
      case "folder":
        return collectSupportedFiles(this.context.getApp(), scope.path, scope.includeSubfolders);
      case "box":
        return this.deps.collectBoxFiles(scope.boxId);
      default: {
        const exhaustive: never = scope;
        throw new Error(`Unhandled card scope: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  isPathInScope(path: string, includeSubfolders: boolean): boolean {
    return isPathInFolderScope(
      path,
      scopeDisplayPath(this.context.store.getScope()),
      includeSubfolders,
    );
  }

  isPathInActiveScope(path: string): boolean {
    const scope = this.context.store.getScope();
    switch (scope.kind) {
      case "box":
        return this.deps.isPathInBox(path, scope.boxId);
      case "folder":
        return isPathInFolderScope(path, scope.path, scope.includeSubfolders);
      default: {
        const exhaustive: never = scope;
        throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /**
   * Symmetric Box membership reconciliation for one metadata path.
   *
   * A loaded card that no longer matches is removed; an absent supported file
   * that now matches is inserted through `createCardRecord`, prepared from the
   * runtime preview cache / non-Markdown placeholder path, and reinserted under
   * the active Box sort. Manual membership and exclusions keep their
   * `isBoxMember` precedence through the injected `isPathInBox`. A missing or
   * unsupported live file is a safe no-op ("unchanged"). Repeat-safe: an
   * already-applied counterpart event reports "unchanged".
   */
  reconcileMetadataMembershipForPath(path: string): MetadataMembershipOutcome {
    const scope = this.context.store.getScope();
    switch (scope.kind) {
      case "box":
        return this.reconcileBoxMembershipForPath(scope, path);
      case "folder":
        return "unchanged";
      default: {
        const exhaustive: never = scope;
        throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  private reconcileBoxMembershipForPath(scope: BoxScope, path: string): MetadataMembershipOutcome {
    const cards = this.context.store.getBaseCards();
    const index = cards.findIndex((card) => card.path === path);
    const isMember = this.deps.isPathInBox(path, scope.boxId);

    if (index !== -1) {
      if (isMember) {
        return "unchanged";
      }
      this.deps.deletePendingHydration(path);
      this.context.store.replaceBaseCards(cards.filter((card) => card.path !== path));
      return "left";
    }

    if (!isMember) {
      return "unchanged";
    }

    const file = this.context.getApp().vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return "unchanged";
    }
    const fileKind = resolveCardFileKind(file);
    if (fileKind === null) {
      return "unchanged";
    }

    const record = createCardRecord(this.context.getApp(), file, fileKind);
    this.deps.prepareRecordsFromCache([record]);
    const sort = this.buildLoadKey(scope).sort;
    const nextCards = [...cards];
    nextCards.splice(
      findSortedInsertIndex(nextCards, record, sort.field, sort.direction),
      0,
      record,
    );
    this.context.store.replaceBaseCards(nextCards);
    return "entered";
  }

  private shouldRefreshForVaultEvent(event: VaultMutationEvent): boolean {
    if (!event.isFolder) {
      const oldKind = event.oldPath ? resolveCardFileKindFromPath(event.oldPath) : null;
      if (event.fileKind === null && oldKind === null) {
        return false;
      }
    }
    return this.isPathInActiveScope(event.path)
      || (event.oldPath !== null && this.isPathInActiveScope(event.oldPath));
  }

  applyScopeRename(event: VaultMutationEvent): string | null {
    if (event.eventType !== "rename" || !event.isFolder || !event.oldPath) {
      return null;
    }
    const scope = this.context.store.getScope();
    switch (scope.kind) {
      case "folder": {
        const renamedPath = rewritePathAfterRename(scope.path, event.oldPath, event.path);
        if (renamedPath === scope.path) {
          return null;
        }
        this.context.store.setScope(createFolderScope(renamedPath, scope.includeSubfolders));
        this.refreshLoadKeyForCurrentScope();
        return renamedPath;
      }
      case "box":
        return null;
      default: {
        const exhaustive: never = scope;
        throw new Error(`Unhandled card source: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
    this.deps.invalidateForVaultMutation(event);
    this.context.epochs.vaultContent.bump();
    this.deps.scheduleNavCountRefresh();
    if (event.isFolder) {
      this.deps.refreshFolderTreeState();
    } else if (event.eventType !== "modify") {
      this.deps.scheduleFolderTreeRefresh();
    }
    const selectedFolderPathAfterRename = this.applyScopeRename(event);
    if (!this.shouldRefreshForVaultEvent(event)) {
      return {
        shouldRefresh: false,
        queueAction: "ignored",
        selectedFolderPathAfterRename,
        incrementalResult: null,
      };
    }

    if (!this.inFlight && !this.loading) {
      const outcome = applyIncrementalMutation(event, this.context.store.getBaseCards(), {
        app: this.context.getApp(),
        sort: this.buildLoadKey(this.context.store.getScope()).sort,
        pendingHydration: {
          has: this.deps.hasPendingHydration,
          delete: this.deps.deletePendingHydration,
        },
        getBulkSelection: this.deps.getBulkSelection,
        setBulkSelection: this.deps.setBulkSelection,
        prepareRecordsFromCache: this.deps.prepareRecordsFromCache,
        isPathInActiveScope: (path) => this.isPathInActiveScope(path),
      });
      if (outcome.result.handled) {
        if (outcome.nextCards !== null) {
          this.context.store.replaceBaseCards(outcome.nextCards);
        }
        this.deps.projectVisibleCards();
        this.scheduleVisibleHydrationCandidates(outcome.hydrationPaths);
        this.context.publishGroups("cards", "projection", "bulk", "scope");
        return {
          shouldRefresh: false,
          queueAction: "ignored",
          selectedFolderPathAfterRename,
          incrementalResult: outcome.result,
        };
      }
    }

    this.refreshQueued = true;
    return {
      shouldRefresh: true,
      queueAction: this.inFlight ? "deferred_while_inflight" : "enqueued",
      selectedFolderPathAfterRename,
      incrementalResult: null,
    };
  }

  /**
   * Schedules only hydration candidates still visible and unhydrated after
   * reprojection; hidden cards wait for ordinary viewport demand. Public so
   * the metadata coordinator can apply the same projection-first rule to a
   * Box entry that became visible only after the refreshed projection.
   */
  scheduleVisibleHydrationCandidates(paths: readonly string[]): void {
    const visiblePaths = new Set(this.context.store.getVisibleCards().map((card) => card.path));
    for (const path of paths) {
      const card = visiblePaths.has(path) ? this.context.store.getBaseCard(path) : undefined;
      if (card && !card.hydrated) {
        this.deps.scheduleHydrationPath(path);
      }
    }
  }

  scheduleVaultRefresh(): void {
    const viewWindow = this.context.getViewWindow();
    if (this.vaultRefreshTimer !== null) {
      viewWindow.clearTimeout(this.vaultRefreshTimer);
    }
    this.vaultRefreshTimer = viewWindow.setTimeout(() => {
      this.vaultRefreshTimer = null;
      void this.context.requestUpdate("reload", "vault-change");
    }, VAULT_REFRESH_DEBOUNCE_MS);
  }

  dispose(): DisposeReport {
    const clearedQueuedRequest = this.queuedRequest !== null || this.refreshQueued;
    const cancelledDebounce = this.vaultRefreshTimer !== null;
    if (this.vaultRefreshTimer !== null) {
      this.context.getViewWindow().clearTimeout(this.vaultRefreshTimer);
    }
    this.vaultRefreshTimer = null;
    this.queuedRequest = null;
    this.refreshQueued = false;
    this.inFlight = null;
    this.inFlightKey = null;
    this.inFlightLoadScope = null;
    this.loading = false;
    this.selectionEpoch.bump();
    this.context.epochs.load.bump();
    return { clearedQueuedRequest, cancelledDebounce };
  }
}
