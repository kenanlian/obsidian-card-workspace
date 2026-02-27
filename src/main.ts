import {
  MarkdownView,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from "./settings";
import { FOLDER_CARD_VIEW, FolderCardView } from "./view/FolderCardView";
import { FolderPickerModal } from "./FolderPickerModal";
import type { FolderSelectionRequest, FolderSelectionSource, VaultMutationEvent, VaultMutationEventType } from "./view/types";
import type { PartialPluginSettings, PluginSettings } from "./settings";

export default class FolderCardExplorerPlugin extends Plugin {
  private selectedFolderPath: string | null = null;
  private settings: PluginSettings = normalizeSettings(DEFAULT_SETTINGS);
  private selectionRequestSeq = 0;
  private latestHandledRequestId = 0;
  private debouncedRefresh = debounce(
    () => {
      void this.requestRefreshForViews("vault-change");
    },
    250,
    false,
  );

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(FOLDER_CARD_VIEW, (leaf) => new FolderCardView(leaf, this));

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
    });
  }

  async onunload(): Promise<void> {
    const debouncedRefresh = this.debouncedRefresh as (() => void) & {
      cancel?: () => void;
    };
    debouncedRefresh.cancel?.();
    this.withFolderViews((view) => {
      view.cleanupLifecycle();
    });
    this.app.workspace.detachLeavesOfType(FOLDER_CARD_VIEW);
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

  openFolderPicker(): void {
    new FolderPickerModal(this.app, (folder) => {
      void this.selectFolder(folder, "panel-picker");
    }).open();
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
      mergeSettings(this.settings, { lastFolderPath: folder.path }),
    );
    this.settings = mergeSettings(this.settings, { lastFolderPath: folder.path });
  }

  getSettings(): PluginSettings {
    return normalizeSettings(this.settings);
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

  private async loadSettings(): Promise<void> {
    const rawData = await this.loadData();
    this.settings = normalizeSettings(rawData);
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
