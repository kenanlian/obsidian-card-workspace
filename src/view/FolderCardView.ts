import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { buildLightPreview } from "./markdown-utils";
import type { SortDirection, SortField } from "../settings";
import type {
  CleanupResult,
  FolderLoadKey,
  FolderSelectionRequest,
  NoteCardRecord,
  RefreshRequest,
  RefreshResult,
  SelectionResult,
  VaultMutationEvent,
  VaultMutationResult,
} from "./types";
import type FolderCardExplorerPlugin from "../main";

export const FOLDER_CARD_VIEW = "folder-card-view";

export class FolderCardView extends ItemView {
  private plugin: FolderCardExplorerPlugin;
  private component: InstanceType<typeof FolderCardPanel> | null = null;
  private hostEl: HTMLElement | null = null;

  private folderPath: string | null = null;
  private folderLoadKey: string | null = null;
  private cards: NoteCardRecord[] = [];
  private selectedPath: string | null = null;
  private loading = false;

  private generation = 0;
  private pendingHydration = new Set<number>();
  private requestSeq = 0;

  private inFlight: Promise<void> | null = null;
  private inFlightKey: string | null = null;
  private queuedRequest: FolderSelectionRequest | null = null;
  private refreshQueued = false;

  constructor(leaf: WorkspaceLeaf, plugin: FolderCardExplorerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return FOLDER_CARD_VIEW;
  }

  getDisplayText(): string {
    return "Folder Card Explorer";
  }

  getIcon(): string {
    return "gallery-horizontal";
  }

  async onOpen(): Promise<void> {
    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = new FolderCardPanel({
      target: this.hostEl,
      props: {
        cards: this.cards,
        folderPath: this.folderPath ?? "",
        selectedPath: this.selectedPath,
        loading: this.loading,
        generation: this.generation,
      },
    });

    this.component.$on("open-note", (event: any) => {
      this.plugin.openNoteFromCard(event.detail.path);
    });
    this.component.$on("hydrate-range", (event: any) => {
      void this.hydrateRange(event.detail.start, event.detail.end);
    });
  }

  async onClose(): Promise<void> {
    this.cleanupLifecycle();
    this.component?.$destroy();
    this.component = null;
    this.hostEl = null;
  }

  async setFolder(folder: TFolder): Promise<SelectionResult> {
    const request = this.createProgrammaticSelectionRequest(folder.path, false);
    return this.handleFolderSelection(request);
  }

  async handleFolderSelection(request: FolderSelectionRequest): Promise<SelectionResult> {
    const folder = this.app.vault.getAbstractFileByPath(request.folderPath);
    if (!(folder instanceof TFolder)) {
      return {
        action: "rejected_invalid",
        folderPath: request.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const forceRefresh = request.forceRefresh ?? false;
    const loadKey = this.serializeLoadKey(this.buildLoadKey(folder.path));

    if (this.inFlight) {
      if (!forceRefresh && this.inFlightKey === loadKey) {
        return {
          action: "reused_inflight",
          folderPath: folder.path,
          generationChanged: false,
          preserveUiState: true,
        };
      }

      this.queuedRequest = request;
      return {
        action: "queued_latest",
        folderPath: folder.path,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    if (!forceRefresh && this.folderLoadKey === loadKey) {
      return {
        action: "noop",
        folderPath: folder.path,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    await this.runLoad(folder, loadKey);
    await this.drainQueuedRequest();

    return {
      action: "started",
      folderPath: folder.path,
      generationChanged: true,
      preserveUiState: false,
    };
  }

  async refresh(request: RefreshRequest = { reason: "manual" }): Promise<RefreshResult> {
    const targetPath = request.folderPath ?? this.folderPath;
    if (!targetPath) {
      return {
        action: "skipped_no_folder",
        inFlightKey: this.inFlightKey,
      };
    }

    if (request.reason === "vault-change") {
      this.refreshQueued = false;
    }

    const selectionRequest = this.createProgrammaticSelectionRequest(
      targetPath,
      request.forceRefresh ?? true,
    );

    const selectionResult = await this.handleFolderSelection(selectionRequest);
    if (selectionResult.action === "rejected_invalid") {
      return {
        action: "skipped_invalid_folder",
        inFlightKey: this.inFlightKey,
      };
    }

    if (selectionResult.action === "started") {
      return {
        action: "started",
        inFlightKey: this.inFlightKey,
      };
    }

    return {
      action: "queued_latest",
      inFlightKey: this.inFlightKey,
    };
  }

  handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
    let selectedFolderPathAfterRename: string | null = null;
    if (event.eventType === "rename" && event.isFolder && event.oldPath) {
      const renamedPath = this.rewritePathAfterRename(this.folderPath, event.oldPath, event.path);
      if (renamedPath !== this.folderPath) {
        this.folderPath = renamedPath;
        this.folderLoadKey = renamedPath ? this.serializeLoadKey(this.buildLoadKey(renamedPath)) : null;
        selectedFolderPathAfterRename = renamedPath;
      }
    }

    if (!this.shouldRefreshForVaultEvent(event)) {
      return {
        shouldRefresh: false,
        queueAction: "ignored",
        selectedFolderPathAfterRename,
      };
    }

    const queueAction = this.inFlight ? "deferred_while_inflight" : "enqueued";
    this.refreshQueued = true;

    return {
      shouldRefresh: true,
      queueAction,
      selectedFolderPathAfterRename,
    };
  }

  cleanupLifecycle(): CleanupResult {
    const hadQueuedRequest = this.queuedRequest !== null || this.refreshQueued;
    const hadPendingHydration = this.pendingHydration.size > 0;
    this.queuedRequest = null;
    this.refreshQueued = false;
    this.pendingHydration.clear();
    this.inFlight = null;
    this.inFlightKey = null;
    this.loading = false;
    this.generation += 1;

    return {
      cancelledDebounce: false,
      clearedQueuedRequest: hadQueuedRequest,
      clearedPendingHydration: hadPendingHydration,
    };
  }

  setSelectedFile(path: string | null): void {
    if (this.selectedPath === path) {
      return;
    }

    this.selectedPath = path;
    this.pushState();
  }

  getCurrentFolderPath(): string | null {
    return this.folderPath;
  }

  private createProgrammaticSelectionRequest(
    folderPath: string,
    forceRefresh: boolean,
  ): FolderSelectionRequest {
    this.requestSeq += 1;
    return {
      requestId: this.requestSeq,
      folderPath,
      source: "programmatic",
      requestedAtMs: Date.now(),
      forceRefresh,
    };
  }

  private buildLoadKey(folderPath: string): FolderLoadKey {
    const settings = this.plugin.getSettings();
    return {
      folderPath,
      includeSubfolders: settings.includeSubfolders,
      sortField: settings.sort.field,
      sortDirection: settings.sort.direction,
    };
  }

  private serializeLoadKey(loadKey: FolderLoadKey): string {
    return `${loadKey.folderPath}::${loadKey.includeSubfolders}::${loadKey.sortField}::${loadKey.sortDirection}`;
  }

  private async runLoad(folder: TFolder, loadKey: string): Promise<void> {
    const task = this.loadFolder(folder, loadKey);
    this.inFlight = task;
    this.inFlightKey = loadKey;

    try {
      await task;
    } finally {
      if (this.inFlight === task) {
        this.inFlight = null;
        this.inFlightKey = null;
      }
    }
  }

  private async loadFolder(folder: TFolder, loadKey: string): Promise<void> {
    this.folderPath = folder.path;
    this.loading = true;
    this.cards = [];
    this.generation += 1;
    this.pendingHydration.clear();
    this.pushState();

    const buildGeneration = this.generation;
    const settings = this.plugin.getSettings();

    try {
      const files = this.collectMarkdownFiles(folder, settings.includeSubfolders);
      const records: NoteCardRecord[] = files.map((file) => {
        return {
          file,
          path: file.path,
          title: file.basename,
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
          excerpt: "",
          previewHtml: "",
          previewMode: "empty",
          hydrated: false,
        };
      });

      if (buildGeneration !== this.generation) {
        return;
      }

      records.sort((left, right) =>
        this.compareCards(left, right, settings.sort.field, settings.sort.direction),
      );
      this.cards = records;
      this.folderLoadKey = loadKey;
    } finally {
      if (buildGeneration === this.generation) {
        this.loading = false;
        this.pushState();
      }
    }
  }

  private async drainQueuedRequest(): Promise<void> {
    if (this.inFlight) {
      return;
    }

    const queued = this.queuedRequest;
    if (!queued) {
      return;
    }

    this.queuedRequest = null;
    await this.handleFolderSelection(queued);
  }

  private shouldRefreshForVaultEvent(event: VaultMutationEvent): boolean {
    if (!this.folderPath) {
      return false;
    }

    if (!event.isFolder && !event.isMarkdown) {
      return false;
    }

    const includeSubfolders = this.plugin.getSettings().includeSubfolders;
    const pathInScope = this.isPathInScope(event.path, includeSubfolders);
    const oldPathInScope =
      typeof event.oldPath === "string" && event.oldPath.length > 0
        ? this.isPathInScope(event.oldPath, includeSubfolders)
        : false;

    return pathInScope || oldPathInScope;
  }

  private isPathInScope(path: string, includeSubfolders: boolean): boolean {
    if (!this.folderPath) {
      return false;
    }

    if (path === this.folderPath) {
      return true;
    }

    const prefix = `${this.folderPath}/`;
    if (!path.startsWith(prefix)) {
      return false;
    }

    if (includeSubfolders) {
      return true;
    }

    const relative = path.slice(prefix.length);
    return !relative.includes("/");
  }

  private rewritePathAfterRename(
    currentPath: string | null,
    oldPath: string,
    newPath: string,
  ): string | null {
    if (!currentPath) {
      return currentPath;
    }

    if (currentPath === oldPath) {
      return newPath;
    }

    const prefix = `${oldPath}/`;
    if (!currentPath.startsWith(prefix)) {
      return currentPath;
    }

    return `${newPath}${currentPath.slice(oldPath.length)}`;
  }

  private collectMarkdownFiles(root: TFolder, includeSubfolders: boolean): TFile[] {
    if (!includeSubfolders) {
      const directFiles: TFile[] = [];
      for (const child of root.children) {
        if (child instanceof TFile && child.extension.toLowerCase() === "md") {
          directFiles.push(child);
        }
      }

      return directFiles;
    }

    const result: TFile[] = [];
    const stack: TFolder[] = [root];

    while (stack.length > 0) {
      const folder = stack.pop();
      if (!folder) {
        continue;
      }

      for (const child of folder.children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (child instanceof TFile && child.extension.toLowerCase() === "md") {
          result.push(child);
        }
      }
    }

    return result;
  }

  private compareCards(
    left: NoteCardRecord,
    right: NoteCardRecord,
    field: SortField,
    direction: SortDirection,
  ): number {
    const leftValue = field === "ctime" ? left.ctime : left.mtime;
    const rightValue = field === "ctime" ? right.ctime : right.mtime;
    const difference = leftValue - rightValue;

    if (difference !== 0) {
      return direction === "asc" ? difference : -difference;
    }

    return left.path.localeCompare(right.path);
  }

  private async hydrateRange(start: number, end: number): Promise<void> {
    if (this.cards.length === 0 || this.loading) {
      return;
    }

    const generation = this.generation;
    const targets: number[] = [];
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(this.cards.length, end);

    for (let index = safeStart; index < safeEnd; index += 1) {
      const card = this.cards[index];
      if (!card || card.hydrated || this.pendingHydration.has(index)) {
        continue;
      }
      this.pendingHydration.add(index);
      targets.push(index);
    }

    if (targets.length === 0) {
      return;
    }

    await Promise.all(targets.map((index) => this.hydrateCard(index, generation)));

    targets.forEach((index) => this.pendingHydration.delete(index));
    if (generation === this.generation) {
      this.pushState();
    }
  }

  private async hydrateCard(index: number, generation: number): Promise<void> {
    const card = this.cards[index];
    if (!card) {
      return;
    }

    try {
      const markdown = await this.app.vault.cachedRead(card.file);
      if (generation !== this.generation) {
        return;
      }

      const preview = buildLightPreview(markdown, 200, 4);
      card.previewHtml = preview.html;
      card.previewMode = preview.mode;
      card.hydrated = true;
    } catch {
      card.excerpt = "";
      card.previewHtml = "";
      card.previewMode = "empty";
      card.hydrated = true;
    }
  }

  private pushState(): void {
    this.component?.$set({
      cards: this.cards,
      folderPath: this.folderPath ?? "",
      selectedPath: this.selectedPath,
      loading: this.loading,
      generation: this.generation,
    });
  }
}
