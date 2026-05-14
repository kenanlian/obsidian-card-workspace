import {
  MarkdownView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { FolderCardExplorerSettingTab } from "./FolderCardExplorerSettingTab";
import {
  IndexedSearchService,
  IndexStore,
  SearchIndexManager,
  prepareSearchableDocument,
} from "./search";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from "./settings";
import { FOLDER_CARD_VIEW, FolderCardView } from "./view/FolderCardView";
import type {
  IndexStoreNamespaceMetadata,
  SearchIndexObservabilitySnapshot,
  SearchService,
  SearchServiceSnapshot,
  SearchVaultMutation,
} from "./search";
import type { OpenDestination, PartialPluginSettings, PluginSettings } from "./settings";
import { ALL_NOTES_PATH } from "./view/types";
import { isMarkdownCardKind, resolveCardFileKind, resolveCardFileKindFromPath } from "./view/file-kind";
import type { FolderSelectionRequest, FolderSelectionSource, VaultMutationEvent, VaultMutationEventType } from "./view/types";

const SEARCH_SCHEMA_VERSION = "phase3-v1";
const SEARCH_TOKENIZER_VERSION = "search-text-v2";
const SEARCH_MAX_CANDIDATE_PATHS = 10000;
type SearchRecoveryBoundaryState = "healthy" | "degraded";

type SearchSnapshotListener = (snapshot: SearchServiceSnapshot) => void;

export default class FolderCardExplorerPlugin extends Plugin {
  private selectedFolderPath: string | null = null;
  private settings: PluginSettings = normalizeSettings(DEFAULT_SETTINGS);
  private selectionRequestSeq = 0;
  private latestHandledRequestId = 0;
  private searchService: SearchService | null = null;
  private searchManager: SearchIndexManager | null = null;
  private searchServiceUnsubscribe: (() => void) | null = null;
  private searchSnapshot: SearchServiceSnapshot | null = null;
  private readonly searchSnapshotListeners = new Set<SearchSnapshotListener>();
  private searchRecoveryBoundaryState: SearchRecoveryBoundaryState = "healthy";
  private layoutReady = false;
  private vaultObserversRegistered = false;
  private shouldRunStartupSearchRebuild = false;
  private pendingStartupSearchRebuildDetail: string | null = null;
  private shouldSyncRestoredSearchState = false;
  private pendingRestoredSearchStateSync: Promise<void> | null = null;
  private pendingSearchRebuild: Promise<void> | null = null;
  private pendingSearchRecovery: Promise<void> | null = null;
  private pendingSearchClearReset: Promise<void> | null = null;
  private pendingMutationRecoveryRebuild: Promise<void> | null = null;
  private debouncedRefresh = debounce(
    () => {
      void this.requestRefreshForViews("vault-change");
    },
    250,
    false,
  );

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.initializeSearchService();
    this.register(() => {
      this.disposeSearchService();
    });

    this.registerView(FOLDER_CARD_VIEW, (leaf) => new FolderCardView(leaf, this));
    this.addSettingTab(new FolderCardExplorerSettingTab(this.app, this));
    this.registerHoverLinkSource("card-workspace", {
      display: "Card Workspace",
      defaultMod: true,
    });

    this.addCommand({
      id: "open-card-workspace",
      name: "Open Card Workspace view",
      callback: () => {
        void this.activateView();
      },
    });
    this.registerSearchCommands();

    this.registerDomEvent(document, "click", (event: MouseEvent) => {
      void this.onFileExplorerClick(event);
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.syncSelection(file instanceof TFile ? file.path : null);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.layoutReady = true;
      this.registerVaultObservers();
      const activeFile = this.app.workspace.getActiveFile();
      this.syncSelection(activeFile?.path ?? null);
      this.flushDeferredSearchStartupWork();
      void this.restoreLastSession();
    });
  }

  async onunload(): Promise<void> {
    const debouncedRefresh = this.debouncedRefresh as (() => void) & {
      cancel?: () => void;
    };
    debouncedRefresh.cancel?.();
    this.disposeSearchService();
    this.withFolderViews((view) => {
      view.cleanupLifecycle();
    });
  }

  async createNoteInCurrentFolder(): Promise<void> {
    const folderPath = this.resolveNewNoteFolderPath();
    if (folderPath === null) {
      return;
    }

    const fullPath = this.generateUniqueNotePath(folderPath);
    const file = await this.app.vault.create(fullPath, "");
    await this.openNoteFromCard(file.path, "current-area");
  }

  private resolveNewNoteFolderPath(): string | null {
    // If viewing a specific folder, use it directly
    if (this.selectedFolderPath && this.selectedFolderPath !== ALL_NOTES_PATH) {
      return this.selectedFolderPath;
    }

    // "All Notes" mode: create in vault root
    if (this.selectedFolderPath === ALL_NOTES_PATH) {
      return "";
    }

    // No folder selected at all
    return null;
  }

  private generateUniqueNotePath(folderPath: string): string {
    const baseName = "Untitled";
    const extension = "md";
    const prefix = folderPath ? `${folderPath}/` : "";

    // Try "Untitled.md" first
    const firstCandidate = `${prefix}${baseName}.${extension}`;
    if (!this.app.vault.getAbstractFileByPath(firstCandidate)) {
      return firstCandidate;
    }

    // Try "Untitled 1.md", "Untitled 2.md", ...
    for (let counter = 1; counter < 10000; counter += 1) {
      const candidate = `${prefix}${baseName} ${counter}.${extension}`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
    }

    // Fallback: use timestamp
    return `${prefix}${baseName} ${Date.now()}.${extension}`;
  }

  async openNoteFromCard(path: string, destination?: OpenDestination): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) {
      return;
    }

    const leaf = await this.resolveOpenDestinationLeaf(destination);
    if (!leaf) {
      return;
    }

    await leaf.openFile(target, { active: true });
    this.syncSelection(target.path);
  }

  private async resolveOpenDestinationLeaf(destination?: OpenDestination): Promise<WorkspaceLeaf | null> {
    if (destination === undefined) {
      return this.resolveDefaultCardOpenLeaf();
    }

    if (destination === "current-area") {
      return this.resolveTargetLeaf();
    }

    if (destination === "new-tab") {
      return this.app.workspace.getLeaf(true);
    }

    if (destination === "split-right") {
      const existingTargetLeaf = this.findExistingRootEditorLeaf();
      if (existingTargetLeaf) {
        return this.app.workspace.createLeafBySplit(existingTargetLeaf, "vertical");
      }

      return this.app.workspace.getLeaf(true);
    }

    const workspaceWithPopout = this.app.workspace as unknown as {
      openPopoutLeaf?: () => WorkspaceLeaf | Promise<WorkspaceLeaf>;
    };
    if (typeof workspaceWithPopout.openPopoutLeaf !== "function") {
      new Notice("Open in new window is available on desktop only.");
      return null;
    }

    return await workspaceWithPopout.openPopoutLeaf();
  }

  private async resolveDefaultCardOpenLeaf(): Promise<WorkspaceLeaf | null> {
    if (this.settings.defaultCardOpenBehavior !== "smart") {
      return this.resolveOpenDestinationLeaf(this.settings.defaultCardOpenBehavior);
    }

    return this.resolveSmartDefaultCardOpenLeaf();
  }

  private resolveSmartDefaultCardOpenLeaf(): WorkspaceLeaf {
    const currentMainEditorLeaf = this.findCurrentMainEditorLeaf();
    if (!currentMainEditorLeaf) {
      return this.app.workspace.getLeaf(true);
    }

    return this.isLeafPinned(currentMainEditorLeaf)
      ? this.app.workspace.getLeaf(true)
      : currentMainEditorLeaf;
  }

  private findCurrentMainEditorLeaf(): WorkspaceLeaf | null {
    const rootSplit = this.app.workspace.rootSplit;
    const recentRootLeaf = this.app.workspace.getMostRecentLeaf(rootSplit);
    if (recentRootLeaf && this.isFileCapableRootLeaf(recentRootLeaf, rootSplit)) {
      return recentRootLeaf;
    }

    const activeRootMarkdownLeaf = this.findActiveRootMarkdownLeaf();
    if (activeRootMarkdownLeaf) {
      return activeRootMarkdownLeaf;
    }

    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    const rootMarkdownLeaf = existingMarkdown.find((leaf) => leaf.getRoot() === rootSplit);
    return rootMarkdownLeaf ?? null;
  }

  private isFileCapableRootLeaf(leaf: WorkspaceLeaf, rootSplit: unknown): boolean {
    const viewType = leaf.getViewState()?.type;
    return leaf.getRoot() === rootSplit && typeof viewType === "string" && viewType !== "empty";
  }

  private findActiveRootMarkdownLeaf(): WorkspaceLeaf | null {
    const rootSplit = this.app.workspace.rootSplit;
    const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
    if (!activeLeaf || activeLeaf.getRoot() !== rootSplit) {
      return null;
    }

    return activeLeaf;
  }

  private isLeafPinned(leaf: WorkspaceLeaf): boolean {
    const pinnedState = (leaf as WorkspaceLeaf & {
      getViewState?: () => { pinned?: boolean };
      pinned?: boolean;
    }).getViewState?.()?.pinned;
    if (typeof pinnedState === "boolean") {
      return pinnedState;
    }

    return (leaf as WorkspaceLeaf & { pinned?: boolean }).pinned === true;
  }

  async selectFolderByPath(path: string, source: FolderSelectionSource): Promise<void> {
    const folder = path === "/" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(path);
    if (!(folder instanceof TFolder)) {
      return;
    }
    await this.selectFolder(folder, source);
  }

  async selectAllNotes(): Promise<void> {
    const request = this.createSelectionRequest(ALL_NOTES_PATH, "panel-picker");
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.dispatchSelectionRequest(request);
    this.selectedFolderPath = ALL_NOTES_PATH;
    await this.saveData(
      mergeSettings(this.settings, { lastViewMode: "all-notes" }),
    );
    this.settings = mergeSettings(this.settings, { lastViewMode: "all-notes" });
  }

  private async selectFolder(
    folder: TFolder,
    source: FolderSelectionSource,
  ): Promise<void> {
    const request = this.createSelectionRequest(folder.path, source);
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.dispatchSelectionRequest(request);
    await this.saveData(
      mergeSettings(this.settings, { lastFolderPath: folder.path, lastViewMode: "folder" }),
    );
    this.settings = mergeSettings(this.settings, {
      lastFolderPath: folder.path,
      lastViewMode: "folder",
    });
  }

  getSettings(): PluginSettings {
    return normalizeSettings(this.settings);
  }

  getSearchService(): SearchService | null {
    return this.searchService;
  }

  getSearchSnapshot(): SearchServiceSnapshot | null {
    if (!this.searchSnapshot) {
      return null;
    }

    return this.cloneSearchSnapshot(this.searchSnapshot);
  }

  getSearchIndexObservabilitySnapshot(): SearchIndexObservabilitySnapshot | null {
    if (!this.searchSnapshot) {
      return null;
    }

    const snapshot = this.cloneSearchSnapshot(this.searchSnapshot);
    return {
      status: snapshot.status,
      queriesAllowed: this.areSearchQueriesAllowed(snapshot),
      health: snapshot.health,
    };
  }

  subscribeSearchSnapshots(listener: SearchSnapshotListener): () => void {
    this.searchSnapshotListeners.add(listener);
    if (this.searchSnapshot) {
      listener(this.cloneSearchSnapshot(this.searchSnapshot));
    }

    return () => {
      this.searchSnapshotListeners.delete(listener);
    };
  }

  async saveSettings(patch: PartialPluginSettings): Promise<void> {
    this.settings = mergeSettings(this.settings, patch);
    await this.saveData(this.settings);
    await this.requestRefreshForViews("settings-change");
  }

  private resolveTargetLeaf(): WorkspaceLeaf {
    const existingTargetLeaf = this.findExistingRootEditorLeaf();
    if (existingTargetLeaf) {
      return existingTargetLeaf;
    }

    return this.app.workspace.getLeaf(true);
  }

  private findExistingRootEditorLeaf(): WorkspaceLeaf | null {
    const rootSplit = this.app.workspace.rootSplit;
    const activeRootMarkdownLeaf = this.findActiveRootMarkdownLeaf();
    if (activeRootMarkdownLeaf) {
      return activeRootMarkdownLeaf;
    }

    const recentRootLeaf = this.app.workspace.getMostRecentLeaf(rootSplit);
    if (recentRootLeaf) {
      return recentRootLeaf;
    }

    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    const rootMarkdownLeaf = existingMarkdown.find((leaf) => leaf.getRoot() === rootSplit);
    return rootMarkdownLeaf ?? null;
  }

  private async onFileExplorerClick(event: MouseEvent): Promise<void> {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const folderPath = this.extractFolderPathFromTarget(target);
    if (!folderPath) {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    await this.selectFolder(folder, "explorer-click");
  }

  private extractFolderPathFromTarget(target: Element): string | null {
    const titleEl = target.closest(".nav-folder-title");
    if (!titleEl) {
      return null;
    }

    return (
      titleEl.getAttribute("data-path") ??
      titleEl.closest(".nav-folder")?.getAttribute("data-path") ??
      null
    );
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    const leaves = workspace.getLeavesOfType(FOLDER_CARD_VIEW);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getLeftLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({
        type: FOLDER_CARD_VIEW,
        active: true,
      });
    }

    if (!leaf) {
      return;
    }
    workspace.revealLeaf(leaf);
  }

  private withFolderViews(callback: (view: FolderCardView) => void): void {
    this.app.workspace.getLeavesOfType(FOLDER_CARD_VIEW).forEach((leaf) => {
      if (leaf.view instanceof FolderCardView) {
        callback(leaf.view);
      }
    });
  }

  private syncSelection(path: string | null): void {
    this.withFolderViews((view) => view.setSelectedFile(path));
  }

  private registerSearchCommands(): void {
    this.addCommand({
      id: "show-folder-card-search-index-status",
      name: "Show Card Workspace local search index lifecycle status",
      callback: () => {
        this.showSearchIndexStatus();
      },
    });

    this.addCommand({
      id: "recover-folder-card-search-index",
      name: "Recover Card Workspace local search index lifecycle",
      callback: () => {
        void this.recoverSearchIndex("Manual recover command requested full local search index rebuild.");
      },
    });

    this.addCommand({
      id: "rebuild-folder-card-search-index",
      name: "Rebuild Card Workspace local search index from notes",
      callback: () => {
        void this.rebuildSearchIndex("Manual rebuild command requested local search index rebuild.");
      },
    });

    this.addCommand({
      id: "clear-reset-folder-card-search-index",
      name: "Clear and reset Card Workspace local search index state",
      callback: () => {
        void this.clearAndResetSearchIndex();
      },
    });
  }

  private registerVaultObservers(): void {
    if (this.vaultObserversRegistered) {
      return;
    }

    this.vaultObserversRegistered = true;
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("create", file, null));
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("modify", file, null));
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("delete", file, null));
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("rename", file, oldPath));
      }),
    );
  }

  private async initializeSearchService(): Promise<void> {
    this.disposeSearchService();

    const indexed = this.createIndexedSearchService();
    this.searchManager = indexed.manager;
    this.bindSearchService(indexed.service);

    try {
      await indexed.service.initialize();
      const restoreResult = await indexed.manager.restore(this.createSearchMetadata(indexed.store.vaultNamespace));
      if (restoreResult.outcome === "rebuild-required") {
        this.queueStartupSearchRebuild("Startup restore required full search rebuild.");
      } else {
        this.scheduleRestoredSearchStateSync();
      }
    } catch (error) {
      console.warn("[Card Workspace] Indexed search initialization failed.", error);
      indexed.manager.markInitializationFailure(error);
      this.shouldRunStartupSearchRebuild = false;
      this.pendingStartupSearchRebuildDetail = null;
      this.shouldSyncRestoredSearchState = false;
    }
  }

  private disposeSearchService(): void {
    if (this.searchServiceUnsubscribe) {
      this.searchServiceUnsubscribe();
      this.searchServiceUnsubscribe = null;
    }

    if (!this.searchService) {
      this.searchManager = null;
      this.searchSnapshot = null;
      return;
    }

    this.searchService.dispose();
    this.searchService = null;
    this.searchManager = null;
    this.searchSnapshot = null;
    this.pendingSearchClearReset = null;
    this.pendingSearchRebuild = null;
    this.pendingSearchRecovery = null;
    this.pendingRestoredSearchStateSync = null;
  }

  private toSearchVaultMutation(event: VaultMutationEvent): SearchVaultMutation {
    const nextPathIsMarkdown = event.fileKind !== null && isMarkdownCardKind(event.fileKind);
    const oldPathWasMarkdown =
      event.eventType === "rename" &&
      event.oldPath !== null &&
      resolveCardFileKindFromPath(event.oldPath) === "markdown";

    return {
      type: event.eventType,
      path: event.path,
      oldPath: event.oldPath,
      isMarkdown: nextPathIsMarkdown || oldPathWasMarkdown,
      isFolder: event.isFolder,
    };
  }

  private createIndexedSearchService(): {
    manager: SearchIndexManager;
    service: IndexedSearchService;
    store: IndexStore;
  } {
    const vaultNamespace = this.resolveVaultNamespace();
    const store = new IndexStore({
      vaultNamespace,
    });
    const manager = new SearchIndexManager({
      store,
      documentSource: {
        readAllDocuments: async () => {
          const getFiles = (this.app.vault as { getFiles?: () => TAbstractFile[] }).getFiles;
          if (typeof getFiles !== "function") {
            return [];
          }

          const files = getFiles.call(this.app.vault);
          const documents = await Promise.all(
            files
              .filter((file): file is TFile => file instanceof TFile)
              .map((file) => this.prepareSearchableDocumentFromFile(file)),
          );
          return documents.filter((document): document is NonNullable<typeof document> => document !== null);
        },
        readDocument: async (path) => {
          const target = this.app.vault.getAbstractFileByPath(path);
          if (!(target instanceof TFile)) {
            return null;
          }
          return this.prepareSearchableDocumentFromFile(target);
        },
      },
    });

    const service = new IndexedSearchService(manager, {
      maxCandidatePaths: SEARCH_MAX_CANDIDATE_PATHS,
    });

    return {
      manager,
      service,
      store,
    };
  }

  private async prepareSearchableDocumentFromFile(file: TFile) {
    try {
      const fileKind = resolveCardFileKind(file);
      const title = file.basename;
      if (fileKind === null || !isMarkdownCardKind(fileKind)) {
        return prepareSearchableDocument({
          path: file.path,
          title,
          mtime: file.stat.mtime,
          ctime: file.stat.ctime,
        });
      }

      const cachedRead = (this.app.vault as { cachedRead?: (target: TFile) => Promise<string> }).cachedRead;
      if (typeof cachedRead !== "function") {
        return null;
      }

      const markdown = await cachedRead.call(this.app.vault, file);
      return prepareSearchableDocument({
        path: file.path,
        title,
        markdown,
        mtime: file.stat.mtime,
        ctime: file.stat.ctime,
      });
    } catch {
      return null;
    }
  }

  private resolveVaultNamespace(): string {
    const adapter = this.app.vault.adapter as {
      getBasePath?: () => string;
      basePath?: string;
    };
    const basePath =
      typeof adapter.getBasePath === "function"
        ? adapter.getBasePath()
        : typeof adapter.basePath === "string"
          ? adapter.basePath
          : "";
    if (basePath.trim().length > 0) {
      return `path:${basePath}`;
    }

    const getName = (this.app.vault as { getName?: () => string }).getName;
    const vaultName = typeof getName === "function" ? getName.call(this.app.vault) : "unknown-vault";
    return `name:${vaultName}`;
  }

  private createSearchMetadata(vaultNamespace: string): IndexStoreNamespaceMetadata {
    const pluginVersion = (this.manifest as { version?: string } | undefined)?.version ?? "0.0.0";
    return {
      vaultNamespace,
      schemaVersion: SEARCH_SCHEMA_VERSION,
      tokenizerVersion: SEARCH_TOKENIZER_VERSION,
      pluginVersion,
      documentCount: 0,
      lastIndexedAt: 0,
    };
  }

  private bindSearchService(service: SearchService): void {
    if (this.searchServiceUnsubscribe) {
      this.searchServiceUnsubscribe();
      this.searchServiceUnsubscribe = null;
    }

    this.searchService = service;
    this.searchServiceUnsubscribe = service.subscribe((snapshot) => {
      this.handleSearchSnapshot(snapshot);
    });
  }

  private handleSearchSnapshot(snapshot: SearchServiceSnapshot): void {
    const nextSnapshot = this.cloneSearchSnapshot(snapshot);
    this.searchSnapshot = nextSnapshot;

    for (const listener of this.searchSnapshotListeners) {
      listener(this.cloneSearchSnapshot(nextSnapshot));
    }

    if (this.shouldRunMutationRecoveryRebuild(nextSnapshot)) {
      this.scheduleMutationRecoveryRebuild();
    }

    this.emitRecoveryBoundaryNotice(nextSnapshot);
  }

  private emitRecoveryBoundaryNotice(snapshot: SearchServiceSnapshot): void {
    const isDegraded =
      snapshot.status === "error" ||
      snapshot.health.outcome === "rebuild-required" ||
      snapshot.health.outcome === "failed";

    if (isDegraded) {
      if (this.searchRecoveryBoundaryState === "degraded") {
        return;
      }
      this.searchRecoveryBoundaryState = "degraded";
      new Notice("Card Workspace search index requires recovery.");
      return;
    }

    if (this.searchRecoveryBoundaryState === "degraded" && snapshot.status === "ready") {
      this.searchRecoveryBoundaryState = "healthy";
      new Notice("Card Workspace search index is ready.");
      return;
    }

    this.searchRecoveryBoundaryState = "healthy";
  }

  private cloneSearchSnapshot(snapshot: SearchServiceSnapshot): SearchServiceSnapshot {
    return {
      ...snapshot,
      health: {
        ...snapshot.health,
        lastSuccessfulRestore: snapshot.health.lastSuccessfulRestore
          ? {
              ...snapshot.health.lastSuccessfulRestore,
            }
          : null,
        lastSuccessfulBuild: snapshot.health.lastSuccessfulBuild
          ? {
              ...snapshot.health.lastSuccessfulBuild,
            }
          : null,
      },
    };
  }

  private showSearchIndexStatus(): void {
    const snapshot = this.getSearchIndexObservabilitySnapshot();
    if (!snapshot) {
      new Notice("Card Workspace local search index lifecycle is not initialized yet.");
      return;
    }

    new Notice(this.formatSearchIndexStatus(snapshot));
  }

  private areSearchQueriesAllowed(snapshot: SearchServiceSnapshot): boolean {
    return (
      snapshot.initialized &&
      !snapshot.disposed &&
      snapshot.mode === "indexed" &&
      snapshot.status === "ready" &&
      snapshot.health.readiness === "ready" &&
      snapshot.health.healthy &&
      !snapshot.health.rebuildRequired
    );
  }

  private formatSearchIndexStatus(snapshot: SearchIndexObservabilitySnapshot): string {
    const { health } = snapshot;
    return [
      "Card Workspace local search index lifecycle",
      `Status: ${snapshot.status}`,
      `Query availability: ${snapshot.queriesAllowed ? "available" : "blocked"}`,
      `Readiness: ${health.readiness}`,
      `Persistence: ${health.persistence}`,
      `Documents: ${health.documentCount === null ? "unknown" : String(health.documentCount)}`,
      `Last outcome: ${health.outcome}`,
      `Last restore: ${this.formatSearchIndexSuccess(health.lastSuccessfulRestore)}`,
      `Last build: ${this.formatSearchIndexSuccess(health.lastSuccessfulBuild)}`,
      `Rebuild reason: ${health.rebuildReason ?? "none"}`,
      `Last error: ${health.lastError ?? "none"}`,
    ].join("\n");
  }

  private formatSearchIndexSuccess(
    snapshot: SearchIndexObservabilitySnapshot["health"]["lastSuccessfulRestore"],
  ): string {
    if (!snapshot) {
      return "none";
    }

    return `${snapshot.outcome} at ${snapshot.at} (${snapshot.documentCount} docs)`;
  }

  private shouldRunMutationRecoveryRebuild(snapshot: SearchServiceSnapshot): boolean {
    return (
      this.searchManager !== null &&
      snapshot.mode === "indexed" &&
      snapshot.status === "building" &&
      snapshot.health.outcome === "rebuild-required" &&
      snapshot.health.rebuildReason === "folder-rebuild-required"
    );
  }

  private scheduleMutationRecoveryRebuild(): void {
    if (this.pendingMutationRecoveryRebuild) {
      return;
    }

    this.pendingMutationRecoveryRebuild = this.rebuildSearchIndex(
      "Unsafe vault mutation requires full search rebuild.",
    )
      .catch((error) => {
        console.warn("[Card Workspace] Search rebuild scheduling failed.", error);
      })
      .finally(() => {
        this.pendingMutationRecoveryRebuild = null;
      });
  }

  private async rebuildSearchIndex(detail: string): Promise<void> {
    if (this.pendingSearchRebuild) {
      return this.pendingSearchRebuild;
    }

    if (!this.searchManager) {
      await this.recoverSearchIndex(detail);
      return;
    }

    if (!this.layoutReady) {
      this.queueStartupSearchRebuild(detail);
      return;
    }

    const manager = this.searchManager;
    this.pendingSearchRebuild = manager.rebuildFromSource(detail).finally(() => {
      if (this.searchManager === manager) {
        this.pendingSearchRebuild = null;
      }
    });
    await this.pendingSearchRebuild;
  }

  private async clearAndResetSearchIndex(): Promise<void> {
    if (this.pendingSearchClearReset) {
      return this.pendingSearchClearReset;
    }

    this.pendingSearchClearReset = this.runClearAndResetSearchIndex().finally(() => {
      this.pendingSearchClearReset = null;
    });
    return this.pendingSearchClearReset;
  }

  private async runClearAndResetSearchIndex(): Promise<void> {
    if (!this.searchManager) {
      await this.initializeSearchService();
    }

    if (!this.searchManager) {
      new Notice("Card Workspace local search index is unavailable.");
      return;
    }

    const clearResult = await this.searchManager.clearAndReset(
      "Manual clear/reset command requested local search index reset.",
    );
    if (clearResult.outcome === "failed") {
      new Notice("Card Workspace local search index reset failed.");
      return;
    }

    new Notice("Card Workspace local search index cleared. Rebuilding from notes...");
    await this.rebuildSearchIndex("Manual clear/reset command requested full local search index rebuild.");
  }

  private async recoverSearchIndex(
    rebuildDetail = "Recovery command requested full search rebuild.",
  ): Promise<void> {
    if (this.pendingSearchRecovery) {
      return this.pendingSearchRecovery;
    }

    this.pendingSearchRecovery = this.runRecoverSearchIndex(rebuildDetail).finally(() => {
      this.pendingSearchRecovery = null;
    });
    return this.pendingSearchRecovery;
  }

  private async runRecoverSearchIndex(rebuildDetail: string): Promise<void> {
    if (!this.searchManager) {
      await this.initializeSearchService();
      if (!this.searchManager) {
        new Notice("Card Workspace local search index is unavailable.");
        return;
      }

      if (this.shouldRunStartupSearchRebuild) {
        await this.rebuildSearchIndex(this.consumeStartupSearchRebuildDetail(rebuildDetail));
        return;
      }

      this.scheduleRestoredSearchStateSync();
      return;
    }

    if (!this.layoutReady && this.shouldRunStartupSearchRebuild) {
      return;
    }

    const result = await this.searchManager.restore(
      this.createSearchMetadata(this.resolveVaultNamespace()),
    );
    if (result.outcome === "rebuild-required") {
      await this.rebuildSearchIndex(rebuildDetail);
      return;
    }

    this.scheduleRestoredSearchStateSync();
  }

  private queueStartupSearchRebuild(detail: string): void {
    this.shouldRunStartupSearchRebuild = true;
    this.pendingStartupSearchRebuildDetail = detail;
  }

  private consumeStartupSearchRebuildDetail(defaultDetail: string): string {
    const detail = this.pendingStartupSearchRebuildDetail ?? defaultDetail;
    this.shouldRunStartupSearchRebuild = false;
    this.pendingStartupSearchRebuildDetail = null;
    return detail;
  }

  private flushDeferredSearchStartupWork(): void {
    if (this.shouldRunStartupSearchRebuild) {
      void this.rebuildSearchIndex(
        this.consumeStartupSearchRebuildDetail("Startup restore required full search rebuild."),
      );
    }

    if (this.shouldSyncRestoredSearchState) {
      this.shouldSyncRestoredSearchState = false;
      void this.syncRestoredSearchState();
    }
  }

  private scheduleRestoredSearchStateSync(): void {
    if (!this.searchManager) {
      return;
    }

    if (!this.layoutReady) {
      this.shouldSyncRestoredSearchState = true;
      return;
    }

    void this.syncRestoredSearchState();
  }

  private async syncRestoredSearchState(): Promise<void> {
    if (this.pendingRestoredSearchStateSync) {
      return this.pendingRestoredSearchStateSync;
    }

    if (!this.searchManager) {
      return;
    }

    const manager = this.searchManager;
    this.pendingRestoredSearchStateSync = manager.syncDocumentStateFromSource()
      .catch((error) => {
        console.warn("[Card Workspace] Restored search state sync failed.", error);
      })
      .finally(() => {
        if (this.searchManager === manager) {
          this.pendingRestoredSearchStateSync = null;
        }
      });
    await this.pendingRestoredSearchStateSync;
  }

  private async loadSettings(): Promise<void> {
    const rawData = await this.loadData();
    this.settings = normalizeSettings(rawData);
  }

  private async restoreLastSession(): Promise<void> {
    if (this.settings.lastViewMode === "all-notes") {
      await this.selectAllNotes();
      return;
    }

    const lastPath = this.settings.lastFolderPath;
    if (!lastPath) {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(lastPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    const request = this.createSelectionRequest(folder.path, "programmatic");
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    this.dispatchSelectionRequest(request);
  }

  private createSelectionRequest(
    folderPath: string,
    source: FolderSelectionSource,
    forceRefresh = false,
  ): FolderSelectionRequest {
    this.selectionRequestSeq += 1;
    const request: FolderSelectionRequest = {
      requestId: this.selectionRequestSeq,
      folderPath,
      source,
      requestedAtMs: Date.now(),
      forceRefresh,
    };

    this.latestHandledRequestId = request.requestId;
    return request;
  }

  private dispatchSelectionRequest(request: FolderSelectionRequest): void {
    this.withFolderViews((view) => {
      void this.handleSelectionResult(view, request);
    });
  }

  private async handleSelectionResult(
    view: FolderCardView,
    request: FolderSelectionRequest,
  ): Promise<void> {
    const result = await view.handleFolderSelection(request);
    if (result.action === "rejected_invalid") {
      return;
    }

    if (request.source === "explorer-click" && request.requestId !== this.latestHandledRequestId) {
      return;
    }

    this.selectedFolderPath = result.folderPath;
  }

  private buildVaultMutationEvent(
    eventType: VaultMutationEventType,
    file: TAbstractFile,
    oldPath: string | null,
  ): VaultMutationEvent {
    return {
      eventType,
      path: file.path,
      oldPath,
      isFolder: file instanceof TFolder,
      fileKind: file instanceof TFile ? resolveCardFileKind(file) : null,
    };
  }

  private dispatchVaultMutation(event: VaultMutationEvent): void {
    this.reconcileSelectedFolderPath(event);

    try {
      this.searchService?.handleVaultMutation(this.toSearchVaultMutation(event));
    } catch (error) {
      console.warn("[Card Workspace] Search service mutation forwarding failed.", error);
    }

    let shouldQueueRefresh = false;
    this.withFolderViews((view) => {
      const result = view.handleVaultMutation(event);
      if (result.selectedFolderPathAfterRename) {
        this.selectedFolderPath = result.selectedFolderPathAfterRename;
      }
      if (result.shouldRefresh) {
        shouldQueueRefresh = true;
      }
    });

    if (shouldQueueRefresh) {
      this.debouncedRefresh();
    }
  }

  private reconcileSelectedFolderPath(event: VaultMutationEvent): void {
    if (
      event.eventType !== "rename" ||
      !event.isFolder ||
      !this.selectedFolderPath ||
      !event.oldPath
    ) {
      return;
    }

    if (this.selectedFolderPath === event.oldPath) {
      this.selectedFolderPath = event.path;
      return;
    }

    const prefix = `${event.oldPath}/`;
    if (this.selectedFolderPath.startsWith(prefix)) {
      this.selectedFolderPath = `${event.path}${this.selectedFolderPath.slice(event.oldPath.length)}`;
    }
  }

  private async requestRefreshForViews(
    reason: "vault-change" | "settings-change" | "manual",
  ): Promise<void> {
    if (!this.selectedFolderPath) {
      return;
    }

    this.withFolderViews((view) => {
      void view.refresh({
        reason,
        folderPath: this.selectedFolderPath ?? undefined,
        forceRefresh: true,
      });
    });
  }
}
