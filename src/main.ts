import {
  addIcon,
  MarkdownView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { EditorView, dropCursor } from "@codemirror/view";
import { getUiStrings, resolveUiLanguage, type UiLanguage, type UiStrings } from "./i18n";
import { CardWorkspaceSettingTab } from "./CardWorkspaceSettingTab";
import { EditorDropController } from "./services/EditorDropController";
import { SearchCoordinator, type SearchSnapshotListener } from "./services/SearchCoordinator";
import { SettingsStore, hasPatchValues, splitFlatPatch } from "./services/SettingsStore";
import { FOLDER_CARD_VIEW, FolderCardView } from "./view/FolderCardView";
import type {
  SearchIndexObservabilitySnapshot,
  SearchService,
  SearchServiceSnapshot,
} from "./search";
import type { OpenDestination, PartialPluginSettings, PluginSettings } from "./settings";
import type { FolderSelectionRequest, FolderSelectionSource, SelectionResult, VaultMutationEvent, VaultMutationEventType } from "./view/types";
import { resolveCardFileKind } from "./view/file-kind";
import { createFolderScope, type CardScope } from "./view/scope";
import { rewritePathAfterRename } from "./view/scope-files";
import { reconcileBoxForVaultMutation } from "./view/card-boxes";
import { pruneFavoriteTags, reconcileFavoritesForVaultMutation } from "./view/favorites";
import { collectVaultTagIndex } from "./view/metadata-utils";
import { maxIntent, type ViewUpdateIntent } from "./view/update-intent";
import {
  BULK_ADD_TO_BOX_ICON,
  BULK_ADD_TO_BOX_ICON_SVG,
  BULK_REMOVE_FROM_BOX_ICON,
  BULK_REMOVE_FROM_BOX_ICON_SVG,
  CARD_WORKSPACE_ICON,
  PLAIN_FOLDER_ICON,
  PLAIN_FOLDER_ICON_SVG,
} from "./icons";

const BULK_ADD_TAG_ICON = "card-workspace-tag-plus";
const BULK_REMOVE_TAG_ICON = "card-workspace-tag-minus";
const TABLER_ICON_SCALE = 4.1666666667;
const BULK_ADD_TAG_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${TABLER_ICON_SCALE})"><path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M21.002 13c0 -.617 -.235 -1.233 -.706 -1.704l-7.71 -7.71c-.375 -.375 -.884 -.586 -1.414 -.586h-5.172c-1.657 0 -3 1.343 -3 3v5.172c0 .53 .211 1.039 .586 1.414l7.71 7.71c.471 .47 1.087 .706 1.704 .706" /><path d="M16 19h6" /><path d="M19 16v6" /></g>`;
const BULK_REMOVE_TAG_ICON_SVG = `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="scale(${TABLER_ICON_SCALE})"><path d="M6.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M18.898 16.102l.699 -.699l.699 -.699c.941 -.941 .941 -2.467 0 -3.408l-7.71 -7.71c-.375 -.375 -.884 -.586 -1.414 -.586h-5.172c-1.657 0 -3 1.343 -3 3v5.172c0 .53 .211 1.039 .586 1.414l7.71 7.71c.471 .47 1.087 .706 1.704 .706" /><path d="M16 19h6" /></g>`;

function normalizeFolderScopePath(path: string): string {
  return path === "/" ? "" : path;
}
const NEW_NOTE_TAGS_FRONTMATTER = "---\ntags:\n---\n\n";

export default class CardWorkspacePlugin extends Plugin {
  private readonly uiLanguage: UiLanguage = resolveUiLanguage();
  private readonly settingsStore = new SettingsStore({
    load: () => this.loadData(),
    save: (data) => this.saveData(data),
  });
  private selectionRequestSeq = 0;
  private latestHandledRequestId = 0;
  private vaultObserversRegistered = false;
  private startupPromise: Promise<void> = Promise.resolve();
  private readonly editorDropController = new EditorDropController({
    app: this.app,
    getSettings: () => this.getSettings(),
    getUiStrings: () => this.getUiStrings(),
  });
  private readonly searchCoordinator = new SearchCoordinator({
    getApp: () => this.app,
    getUiStrings: () => this.getUiStrings(),
    getPluginVersion: () => (this.manifest as { version?: string } | undefined)?.version ?? "0.0.0",
  });
  private debouncedRefresh = debounce(
    () => {
      void this.requestRefreshForViews("vault-change");
    },
    250,
    false,
  );
  private debouncedNavStateRefresh = debounce(
    () => {
      this.withFolderViews((view) => {
        view.refreshNavState();
      });
    },
    250,
    false,
  );
  // Longer than the other vault-change debouncers: this one walks every markdown
  // file's cache, and the cache lags the vault events that trigger it.
  private debouncedFavoriteTagPrune = debounce(
    () => {
      this.pruneFavoriteTagsNow();
    },
    1000,
    false,
  );

  onload(): void {
    this.startupPromise = this.initializePlugin().catch((error: unknown) => {
      console.error("[Card Workspace] Plugin load failed.", error);
    });
  }

  private async initializePlugin(): Promise<void> {
    await this.loadSettings();
    await this.searchCoordinator.initialize();
    this.registerCustomIcons();

    this.register(() => {
      this.searchCoordinator.dispose();
    });

    this.registerView(FOLDER_CARD_VIEW, (leaf) => new FolderCardView(leaf, this));
    this.addRibbonIcon(CARD_WORKSPACE_ICON, this.getUiStrings().app.ribbonTooltip, () => {
      void this.activateView();
    });
    this.addSettingTab(new CardWorkspaceSettingTab(this.app, this));
    this.registerHoverLinkSource("card-workspace", {
      display: this.getUiStrings().app.hoverSourceDisplay,
      defaultMod: true,
    });

    this.addCommand({
      id: "open-view",
      name: this.getUiStrings().app.openCardWorkspaceViewCommand,
      callback: () => {
        void this.activateView();
      },
    });
    this.registerSearchCommands();
    this.registerEditorExtension([
      dropCursor(),
      EditorView.domEventHandlers({
        dragover: (event) => this.editorDropController.handleDragOver(event),
        drop: (event, view) => this.editorDropController.handleDomDrop(event, view),
      }),
    ]);
    this.registerEvent(
      this.app.workspace.on("editor-drop", (event, editor, info) => {
        this.editorDropController.handleWorkspaceEditorDrop(event, editor, info);
      }),
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.syncSelection(file instanceof TFile ? file.path : null);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultObservers();
      const activeFile = this.app.workspace.getActiveFile();
      this.syncSelection(activeFile?.path ?? null);
      this.searchCoordinator.flushDeferredStartupWork();
      void this.restoreLastSession();
    });
  }

  private registerCustomIcons(): void {
    addIcon(BULK_ADD_TAG_ICON, BULK_ADD_TAG_ICON_SVG);
    addIcon(BULK_REMOVE_TAG_ICON, BULK_REMOVE_TAG_ICON_SVG);
    addIcon(PLAIN_FOLDER_ICON, PLAIN_FOLDER_ICON_SVG);
    addIcon(BULK_ADD_TO_BOX_ICON, BULK_ADD_TO_BOX_ICON_SVG);
    addIcon(BULK_REMOVE_FROM_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON_SVG);
  }

  onunload(): void {
    const debouncedRefresh = this.debouncedRefresh as (() => void) & {
      cancel?: () => void;
    };
    debouncedRefresh.cancel?.();
    void this.settingsStore.flushPendingWrites();
    const navStateRefresh = this.debouncedNavStateRefresh as (() => void) & {
      cancel?: () => void;
    };
    navStateRefresh.cancel?.();
    const favoriteTagPrune = this.debouncedFavoriteTagPrune as (() => void) & {
      cancel?: () => void;
    };
    favoriteTagPrune.cancel?.();
    this.searchCoordinator.dispose();
    this.withFolderViews((view) => {
      view.cleanupLifecycle();
    });
  }


  async createNoteInCurrentFolder(): Promise<void> {
    await this.createNoteInFolder(this.getSettings().lastFolderPath);
  }

  async createNoteInFolder(folderPath: string, tags: string[] = []): Promise<void> {
    const fullPath = this.generateUniqueNotePath(folderPath);
    const file = await this.app.vault.create(fullPath, this.buildNewNoteContent(tags));
    await this.openNoteFromCard(file.path, "new-tab");
  }

  private buildNewNoteContent(tags: string[] = []): string {
    if (tags.length > 0) {
      return `---\ntags:\n${tags.map((tag) => `  - ${tag}\n`).join("")}---\n\n`;
    }

    return this.getSettings().newNoteTemplate === "tags-frontmatter" ? NEW_NOTE_TAGS_FRONTMATTER : "";
  }

  private generateUniqueNotePath(folderPath: string): string {
    const baseName = this.getUiStrings().app.untitledNoteBaseName;
    const extension = "md";
    const scopePath = normalizeFolderScopePath(folderPath);
    const prefix = scopePath ? `${scopePath}/` : "";

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
      new Notice(this.getUiStrings().app.openInNewWindowDesktopOnly);
      return null;
    }

    return await workspaceWithPopout.openPopoutLeaf();
  }

  private async resolveDefaultCardOpenLeaf(): Promise<WorkspaceLeaf | null> {
    const defaultCardOpenBehavior = this.getSettings().defaultCardOpenBehavior;
    if (defaultCardOpenBehavior !== "smart") {
      return this.resolveOpenDestinationLeaf(defaultCardOpenBehavior);
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
    const normalizedPath = normalizeFolderScopePath(path);
    const folder = normalizedPath === ""
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(folder instanceof TFolder)) {
      return;
    }
    await this.selectFolder(folder, source);
  }


  private async selectFolder(
    folder: TFolder,
    source: FolderSelectionSource,
  ): Promise<void> {
    const request = this.createSelectionRequest(createFolderScope(folder.path, this.getSettings().includeSubfolders), source);
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    await this.dispatchSelectionRequest(request);
  }

  getSettings(): PluginSettings {
    return this.settingsStore.getFlat();
  }

  getUiLanguage(): UiLanguage {
    return this.uiLanguage;
  }

  getUiStrings(): UiStrings {
    return getUiStrings(this.uiLanguage);
  }

  getSearchService(): SearchService | null {
    return this.searchCoordinator.getService();
  }

  getSearchSnapshot(): SearchServiceSnapshot | null {
    return this.searchCoordinator.getSnapshot();
  }

  getSearchIndexObservabilitySnapshot(): SearchIndexObservabilitySnapshot | null {
    return this.searchCoordinator.getObservabilitySnapshot();
  }

  subscribeSearchSnapshots(listener: SearchSnapshotListener): () => void {
    return this.searchCoordinator.subscribe(listener);
  }

  async saveSettings(patch: PartialPluginSettings): Promise<void> {
    const { preferences, workspace, userData } = splitFlatPatch(patch);
    const writes: Array<Promise<ViewUpdateIntent | null>> = [];
    if (hasPatchValues(preferences)) {
      writes.push(this.settingsStore.updatePreferences(preferences));
    }
    if (hasPatchValues(workspace)) {
      writes.push(this.settingsStore.updateWorkspace(workspace));
    }
    if (hasPatchValues(userData)) {
      writes.push(this.settingsStore.updateUserData(userData));
    }
    if (writes.length === 0) {
      return;
    }

    const intent = (await Promise.all(writes)).reduce<ViewUpdateIntent | null>(
      (current, next) => (current === null ? next : next === null ? current : maxIntent(current, next)),
      null,
    );
    if (intent === null) {
      return;
    }

    this.withFolderViews((view) => {
      void view.applyUpdateIntent(intent, "settings-change");
    });
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
    workspace.setActiveLeaf(leaf, { focus: false });
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
    const strings = this.getUiStrings().app;
    this.addCommand({
      id: "show-folder-card-search-index-status",
      name: strings.showSearchStatusCommand,
      callback: () => {
        this.searchCoordinator.showStatus();
      },
    });

    this.addCommand({
      id: "recover-folder-card-search-index",
      name: strings.recoverSearchIndexCommand,
      callback: () => {
        void this.searchCoordinator.recover("Manual recover command requested full local search index rebuild.");
      },
    });

    this.addCommand({
      id: "rebuild-folder-card-search-index",
      name: strings.rebuildSearchIndexCommand,
      callback: () => {
        void this.searchCoordinator.rebuild("Manual rebuild command requested local search index rebuild.");
      },
    });

    this.addCommand({
      id: "clear-reset-folder-card-search-index",
      name: strings.clearResetSearchIndexCommand,
      callback: () => {
        void this.searchCoordinator.clearAndReset();
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

  private async loadSettings(): Promise<void> {
    await this.settingsStore.init();
    // Card boxes always start collapsed to browse mode on launch.
    this.settingsStore.applyLaunchOverride();
  }

  private async restoreLastSession(): Promise<void> {
    const settings = this.getSettings();
    const lastPath = normalizeFolderScopePath(settings.lastFolderPath);
    const folder = lastPath === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(lastPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    const request = this.createSelectionRequest(createFolderScope(folder.path, settings.includeSubfolders), "programmatic");
    await this.activateView();
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    await this.dispatchSelectionRequest(request);
  }

  private createSelectionRequest(scope: CardScope, source: FolderSelectionSource, forceRefresh = false): FolderSelectionRequest {
    this.selectionRequestSeq += 1;
    const request: FolderSelectionRequest = {
      requestId: this.selectionRequestSeq,
      scope,
      source,
      requestedAtMs: Date.now(),
      forceRefresh,
    };

    this.latestHandledRequestId = request.requestId;
    return request;
  }

  /** Returns the first accepted result, the final rejection, or null when no views exist. */
  private async dispatchSelectionRequest(request: FolderSelectionRequest): Promise<SelectionResult | null> {
    const views: FolderCardView[] = [];
    this.withFolderViews((view) => {
      views.push(view);
    });

    let fallback: SelectionResult | null = null;
    let accepted: SelectionResult | null = null;
    for (const view of views) {
      const result = await this.handleSelectionResult(view, request);
      fallback = result;
      if (accepted === null && result.action !== "rejected_invalid") {
        accepted = result;
      }
    }
    return accepted ?? fallback;
  }

  private async handleSelectionResult(
    view: FolderCardView,
    request: FolderSelectionRequest,
  ): Promise<SelectionResult> {
    return view.handleScopeSelection(request);
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
    // TODO(WP-32): 注册到 VaultEventBus 后删除，由 publish 的 try/catch 接管。
    void this.reconcileLastFolderPath(event).catch((error: unknown) => {
      console.warn("[Card Workspace] Scope projection reconcile failed.", error);
    });
    this.reconcileBoxesForVaultMutation(event);
    this.reconcileFavoritesForVaultMutation(event);
    this.queueFavoriteTagPrune(event);

    try {
      this.searchCoordinator.applyVaultMutation(event);
    } catch (error) {
      console.warn("[Card Workspace] Search service mutation forwarding failed.", error);
    }

    let shouldQueueRefresh = false;
    this.withFolderViews((view) => {
      const result = view.handleVaultMutation(event);
      if (result.shouldRefresh) {
        shouldQueueRefresh = true;
      }
    });

    if (shouldQueueRefresh) {
      this.debouncedRefresh();
    }
  }

  private reconcileBoxesForVaultMutation(event: VaultMutationEvent): void {
    const boxes = this.getSettings().boxes;
    if (boxes.length === 0) {
      return;
    }

    if (event.eventType !== "rename" && event.eventType !== "delete") {
      return;
    }

    let changed = false;
    const nextBoxes = boxes.map((box) => {
      const reconciled = reconcileBoxForVaultMutation(box, {
        eventType: event.eventType,
        path: event.path,
        oldPath: event.oldPath,
        isFolder: event.isFolder,
      });
      if (reconciled !== box) {
        changed = true;
      }
      return reconciled;
    });

    if (!changed) {
      return;
    }

    void this.settingsStore.updateUserData({ boxes: nextBoxes });
    this.debouncedNavStateRefresh();
  }

  private reconcileFavoritesForVaultMutation(event: VaultMutationEvent): void {
    const favorites = this.getSettings().favorites;
    if (favorites.length === 0) {
      return;
    }

    if (event.eventType !== "rename" && event.eventType !== "delete") {
      return;
    }

    const nextFavorites = reconcileFavoritesForVaultMutation(favorites, {
      eventType: event.eventType,
      path: event.path,
      oldPath: event.oldPath,
      isFolder: event.isFolder,
    });

    if (nextFavorites === favorites) {
      return;
    }

    void this.settingsStore.updateUserData({ favorites: nextFavorites });
    this.debouncedNavStateRefresh();
  }

  /**
   * `create` is skipped on purpose: it can only add tags, and the metadata cache
   * may not have parsed the new file yet, which would look like a vanished tag.
   */
  private queueFavoriteTagPrune(event: VaultMutationEvent): void {
    if (event.eventType === "create") {
      return;
    }

    if (!this.getSettings().favorites.some((entry) => entry.kind === "tag")) {
      return;
    }

    this.debouncedFavoriteTagPrune();
  }

  private pruneFavoriteTagsNow(): void {
    const favorites = this.getSettings().favorites;
    if (!favorites.some((entry) => entry.kind === "tag")) {
      return;
    }

    const vaultTags = collectVaultTagIndex(this.app);
    if (vaultTags === null) {
      return;
    }

    const nextFavorites = pruneFavoriteTags(favorites, vaultTags.tagPaths);
    if (nextFavorites === favorites) {
      return;
    }

    void this.settingsStore.updateUserData({ favorites: nextFavorites });
    this.debouncedNavStateRefresh();
  }

  private async reconcileLastFolderPath(event: VaultMutationEvent): Promise<void> {
    if (event.eventType !== "rename" || !event.isFolder || !event.oldPath) {
      return;
    }

    const currentPath = this.getSettings().lastFolderPath;
    const nextPath = rewritePathAfterRename(currentPath, event.oldPath, event.path);
    if (nextPath !== currentPath) {
      await this.saveSettings({ lastFolderPath: nextPath });
    }
  }

  private async requestRefreshForViews(reason: "vault-change" | "manual"): Promise<void> {
    this.withFolderViews((view) => {
      void view.refresh({
        reason,
        forceRefresh: true,
      });
    });
  }
}
