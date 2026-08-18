import { TFile } from "obsidian";

import { AsyncEpoch, type EpochToken } from "../async-epoch";
import { compareCards } from "../card-sort";
import { findCardBox, getBoxMembershipSignature } from "../card-boxes";
import { resolveCardFileKind, resolveCardFileKindFromPath } from "../file-kind";
import {
  createFolderScope,
  isFolderScope,
  scopeDisplayPath,
  scopesEqual,
  serializeScopeKey,
  validateScope,
  type CardScope,
} from "../scope";
import { collectSupportedFiles, isPathInFolderScope, rewritePathAfterRename } from "../scope-files";
import { PANEL_GROUPS } from "../panel-model";
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

export interface ScopeControllerDeps {
  context: ViewContext;
  collectBoxFiles: (boxId: string) => TFile[];
  isPathInBox: (path: string, boxId: string) => boolean;
  deriveVisibleCardsFrom: (cards: readonly NoteCardRecord[]) => NoteCardRecord[];
  projectVisibleCards: () => void;
  getBulkSelection: () => BulkSelectionState;
  setBulkSelection: (state: BulkSelectionState) => void;
  clearBulkSelection: () => void;
  pendingHydration: {
    has: (path: string) => boolean;
    delete: (path: string) => boolean;
    clear: () => void;
  };
  hydrateStartupCardPaths: (paths: string[], token: EpochToken) => Promise<void>;
  scheduleHydrationPath: (path: string) => void;
  resetSearchForLoad: () => void;
  refreshSearchProjection: () => void;
  scheduleNavCountRefresh: () => void;
  refreshFolderTreeState: () => void;
  scheduleFolderTreeRefresh: () => void;
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
    const settings = this.context.getSettings();
    if (scope.kind === "box") {
      const box = findCardBox(settings.boxes ?? [], scope.boxId);
      return { scope, sort: box?.sort ?? settings.sort };
    }
    return { scope, sort: settings.sort };
  }

  serializeLoadKey(loadKey: CardLoadKey): string {
    if (loadKey.scope.kind === "box") {
      const box = findCardBox(this.context.getSettings().boxes ?? [], loadKey.scope.boxId);
      return serializeScopeKey(
        loadKey.scope,
        loadKey.sort,
        box ? getBoxMembershipSignature(box) : "",
      );
    }
    return serializeScopeKey(loadKey.scope, loadKey.sort);
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
    const scope = isFolderScope(current)
      ? createFolderScope(current.path, this.context.getSettings().includeSubfolders)
      : current;
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
    this.context.store.setScope(loadScope.scope);
    this.loading = true;
    const loadToken = this.context.epochs.load.bump();
    this.deps.pendingHydration.clear();
    this.deps.resetSearchForLoad();
    this.deps.projectVisibleCards();
    this.context.publishGroups(...PANEL_GROUPS);

    try {
      const records = this.collectScopeFiles(loadScope.scope).flatMap((file) => {
        const fileKind = resolveCardFileKind(file);
        return fileKind === null ? [] : [{
          file,
          fileKind,
          path: file.path,
          title: file.basename,
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
          excerpt: "",
          previewHtml: "",
          previewMode: "empty" as const,
          hydrated: false,
        }];
      });
      if (!this.context.epochs.load.isCurrent(loadToken)) {
        return false;
      }
      records.sort((left, right) =>
        compareCards(left, right, loadScope.sort.field, loadScope.sort.direction));
      this.context.store.replaceBaseCards(records);
      this.loadKey = loadKey;
      this.lastLoadedIncludeSubfolders = isFolderScope(loadScope.scope)
        ? loadScope.scope.includeSubfolders
        : null;
      const startupPaths = this.deps.deriveVisibleCardsFrom(records)
        .slice(0, this.deps.startupCardCount)
        .map((card) => card.path);
      await this.deps.hydrateStartupCardPaths(startupPaths, loadToken);
      return this.context.epochs.load.isCurrent(loadToken);
    } finally {
      if (this.context.epochs.load.isCurrent(loadToken)) {
        this.loading = false;
        this.deps.projectVisibleCards();
        this.context.publishGroups(...PANEL_GROUPS);
        this.deps.refreshFolderTreeState();
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
    if (isFolderScope(scope)) {
      if (settings.lastFolderPath === scope.path && settings.activeBoxId === null) {
        return;
      }
      await this.context.saveSettings({ lastFolderPath: scope.path, activeBoxId: null });
      return;
    }
    if (settings.activeBoxId !== scope.boxId) {
      await this.context.saveSettings({ activeBoxId: scope.boxId });
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
    return scope.kind === "box"
      ? this.deps.isPathInBox(path, scope.boxId)
      : isPathInFolderScope(path, scope.path, scope.includeSubfolders);
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
    const scope = this.context.store.getScope();
    if (event.eventType !== "rename" || !event.isFolder || !event.oldPath || !isFolderScope(scope)) {
      return null;
    }
    const renamedPath = rewritePathAfterRename(scope.path, event.oldPath, event.path);
    if (renamedPath === scope.path) {
      return null;
    }
    this.context.store.setScope(createFolderScope(renamedPath, scope.includeSubfolders));
    this.refreshLoadKeyForCurrentScope();
    return renamedPath;
  }

  handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
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
        pendingHydration: this.deps.pendingHydration,
        getBulkSelection: this.deps.getBulkSelection,
        setBulkSelection: this.deps.setBulkSelection,
        isPathInActiveScope: (path) => this.isPathInActiveScope(path),
      });
      if (outcome.result.handled) {
        if (outcome.nextCards !== null) {
          this.context.store.replaceBaseCards(outcome.nextCards);
        }
        outcome.hydrationPaths.forEach((path) => this.deps.scheduleHydrationPath(path));
        this.deps.projectVisibleCards();
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
