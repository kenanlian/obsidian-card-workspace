import {
  MarkdownView,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { FolderCardExplorerSettingTab } from "./FolderCardExplorerSettingTab";
import { NoIndexSearchService } from "./search";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from "./settings";
import { FOLDER_CARD_VIEW, FolderCardView } from "./view/FolderCardView";
import type { SearchService, SearchVaultMutation } from "./search";
import type { PartialPluginSettings, PluginSettings } from "./settings";
import { ALL_NOTES_PATH } from "./view/types";
import type { FolderSelectionRequest, FolderSelectionSource, VaultMutationEvent, VaultMutationEventType } from "./view/types";

export default class FolderCardExplorerPlugin extends Plugin {
  private selectedFolderPath: string | null = null;
  private settings: PluginSettings = normalizeSettings(DEFAULT_SETTINGS);
  private selectionRequestSeq = 0;
  private latestHandledRequestId = 0;
  private searchService: SearchService | null = null;
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

    this.addCommand({
      id: "open-folder-card-explorer",
      name: "Open Folder Card Explorer view",
      callback: () => {
        void this.activateView();
      },
    });

    this.registerDomEvent(document, "click", (event: MouseEvent) => {
      void this.onFileExplorerClick(event);
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.syncSelection(file instanceof TFile ? file.path : null);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultObservers();
      const activeFile = this.app.workspace.getActiveFile();
      this.syncSelection(activeFile?.path ?? null);
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
    this.app.workspace.detachLeavesOfType(FOLDER_CARD_VIEW);
  }

  async createNoteInCurrentFolder(): Promise<void> {
    const folderPath = this.resolveNewNoteFolderPath();
    if (folderPath === null) {
      return;
    }

    const fullPath = this.generateUniqueNotePath(folderPath);
    const file = await this.app.vault.create(fullPath, "");
    await this.openNoteFromCard(file.path);
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

  async openNoteFromCard(path: string): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) {
      return;
    }

    const leaf = this.resolveTargetLeaf();
    await leaf.openFile(target, { active: true });
    this.syncSelection(target.path);
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

  async saveSettings(patch: PartialPluginSettings): Promise<void> {
    this.settings = mergeSettings(this.settings, patch);
    await this.saveData(this.settings);
    await this.requestRefreshForViews("settings-change");
  }

  private resolveTargetLeaf(): WorkspaceLeaf {
    const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdown) {
      return activeMarkdown.leaf;
    }

    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    if (existingMarkdown.length > 0) {
      return existingMarkdown[0];
    }

    return this.app.workspace.getLeaf(true);
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
      leaf = workspace.getRightLeaf(false);
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

  private registerVaultObservers(): void {
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
    const service = new NoIndexSearchService();
    this.searchService = service;

    try {
      await service.initialize();
    } catch (error) {
      // Keep search usable by degrading to pipeline fallback when service init fails.
      service.dispose();
      this.searchService = null;
      console.warn("[Folder Card Explorer] Search service initialization failed; using fallback search.", error);
    }
  }

  private disposeSearchService(): void {
    if (!this.searchService) {
      return;
    }

    this.searchService.dispose();
    this.searchService = null;
  }

  private toSearchVaultMutation(event: VaultMutationEvent): SearchVaultMutation {
    return {
      type: event.eventType,
      path: event.path,
      oldPath: event.oldPath,
      isMarkdown: event.isMarkdown,
      isFolder: event.isFolder,
    };
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
      isMarkdown: file instanceof TFile && file.extension.toLowerCase() === "md",
    };
  }

  private dispatchVaultMutation(event: VaultMutationEvent): void {
    this.reconcileSelectedFolderPath(event);

    try {
      this.searchService?.handleVaultMutation(this.toSearchVaultMutation(event));
    } catch (error) {
      console.warn("[Folder Card Explorer] Search service mutation forwarding failed.", error);
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
