import { ItemView, Menu, Notice, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { FolderPickerModal } from "../FolderPickerModal";
import { buildLightPreview } from "./markdown-utils";
import { copyNoteToClipboard, moveFile } from "./note-ops";
import { runPipeline, DEFAULT_PIPELINE_STEPS } from "./pipeline";
import type { PipelineContext } from "./pipeline";
import type { SortDirection, SortField } from "../settings";
import { ALL_NOTES_PATH } from "./types";
import type {
  CleanupResult,
  FolderLoadKey,
  FolderSelectionRequest,
  FolderTreeNode,
  IncrementalMutationResult,
  NoteCardRecord,
  RefreshRequest,
  RefreshResult,
  SelectionResult,
  VaultMutationEvent,
  VaultMutationResult,
} from "./types";
import type FolderCardExplorerPlugin from "../main";

export const FOLDER_CARD_VIEW = "folder-card-view";

type CardMenuAction = "move" | "copy";

type FolderCardPanelInstance = {
  $on(event: string, handler: (event: any) => void): () => void;
  $set(props: Record<string, unknown>): void;
  $destroy(): void;
};

type FolderCardPanelConstructor = new (options: {
  target: HTMLElement;
  props: Record<string, unknown>;
}) => FolderCardPanelInstance;

export class FolderCardView extends ItemView {
  private plugin: FolderCardExplorerPlugin;
  private component: FolderCardPanelInstance | null = null;
  private hostEl: HTMLElement | null = null;

  private folderPath: string | null = null;
  private folderLoadKey: string | null = null;
  private baseCards: NoteCardRecord[] = [];
  private visibleCards: NoteCardRecord[] = [];
  private selectedPath: string | null = null;
  private loading = false;

  private generation = 0;
  private pendingHydration = new Set<string>();
  private requestSeq = 0;

  private static readonly HYDRATION_BATCH_SIZE = 5;
  private static readonly STARTUP_HYDRATION_CARD_COUNT = 12;

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

  private getTooltipSide(): "left" | "right" {
    const root = this.leaf.getRoot();
    return root === this.app.workspace.leftSplit ? "right" : "left";
  }

  async onOpen(): Promise<void> {
    const panelModule = await import("./FolderCardPanel.svelte");
    const FolderCardPanel = panelModule.default as FolderCardPanelConstructor;

    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = new FolderCardPanel({
      target: this.hostEl,
      props: {
        cards: this.visibleCards,
        folderPath: this.folderPath ?? "",
        selectedPath: this.selectedPath,
        loading: this.loading,
        generation: this.generation,
        sortField: this.plugin.getSettings().sort.field,
        sortDirection: this.plugin.getSettings().sort.direction,
        tooltipSide: this.getTooltipSide(),
      },
    });

    this.component.$on("open-note", (event: any) => {
      this.plugin.openNoteFromCard(event.detail.path);
    });
    this.component.$on("card-context-menu", (event: any) => {
      this.openCardContextMenu(event.detail.path, event.detail.mouseEvent);
    });
    this.component.$on("hydrate-range", (event: any) => {
      void this.hydrateRange(event.detail.start, event.detail.end);
    });
    this.component.$on("toolbar-action", (event: any) => {
      if (event.detail.action === "pick-folder") {
        this.component?.$set({ folderTree: this.buildFolderTree() });
      } else if (event.detail.action === "all-notes") {
        void this.plugin.selectAllNotes();
      } else if (event.detail.action === "new-note") {
        void this.plugin.createNoteInCurrentFolder();
      }
    });
    this.component.$on("sort-change", (event: any) => {
      void this.onSortChange(event.detail);
    });
    this.component.$on("select-folder", (event: any) => {
      void this.plugin.selectFolderByPath(event.detail.path, "panel-picker");
    });

    this.hydrateVisibleCardsOnOpen();
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
    const isAllNotes = request.folderPath === ALL_NOTES_PATH;
    const folder = isAllNotes
      ? null
      : this.app.vault.getAbstractFileByPath(request.folderPath);

    if (!isAllNotes && !(folder instanceof TFolder)) {
      return {
        action: "rejected_invalid",
        folderPath: request.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const forceRefresh = request.forceRefresh ?? false;
    const loadKey = this.serializeLoadKey(this.buildLoadKey(request.folderPath));

    if (this.inFlight) {
      if (!forceRefresh && this.inFlightKey === loadKey) {
        return {
          action: "reused_inflight",
          folderPath: request.folderPath,
          generationChanged: false,
          preserveUiState: true,
        };
      }

      this.queuedRequest = request;
      return {
        action: "queued_latest",
        folderPath: request.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    if (!forceRefresh && this.folderLoadKey === loadKey) {
      return {
        action: "noop",
        folderPath: request.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    await this.runLoad(request.folderPath, loadKey);
    await this.drainQueuedRequest();

    return {
      action: "started",
      folderPath: request.folderPath,
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
        incrementalResult: null,
      };
    }

    // Attempt incremental update. Only fall back to full reload if not handled.
    if (!this.inFlight && !this.loading) {
      const incrementalResult = this.applyIncrementalMutation(event);
      if (incrementalResult.handled) {
        this.pushState();
        return {
          shouldRefresh: false,
          queueAction: "ignored",
          selectedFolderPathAfterRename,
          incrementalResult,
        };
      }
    }

    const queueAction = this.inFlight ? "deferred_while_inflight" : "enqueued";
    this.refreshQueued = true;

    return {
      shouldRefresh: true,
      queueAction,
      selectedFolderPathAfterRename,
      incrementalResult: null,
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

  private openCardContextMenu(notePath: unknown, mouseEvent: unknown): void {
    if (typeof notePath !== "string" || !this.isMouseEventLike(mouseEvent)) {
      return;
    }

    const menu = new Menu();
    this.addCardContextMenuItems(menu, notePath);
    menu.showAtMouseEvent(mouseEvent);

    const menuDom = this.getMenuDom(menu);
    if (menuDom) {
      menuDom.classList.add("fce-card-context-menu");
    }
  }

  private getMenuDom(menu: Menu): { classList: { add: (token: string) => void } } | null {
    const candidate = menu as unknown as { dom?: unknown };
    if (typeof candidate.dom !== "object" || candidate.dom === null) {
      return null;
    }

    if (!("classList" in candidate.dom)) {
      return null;
    }

    const classList = candidate.dom.classList;
    if (
      typeof classList !== "object" ||
      classList === null ||
      !("add" in classList) ||
      typeof classList.add !== "function"
    ) {
      return null;
    }

    return { classList: { add: classList.add.bind(classList) } };
  }

  private isMouseEventLike(event: unknown): event is MouseEvent {
    if (typeof event !== "object" || event === null) {
      return false;
    }

    return "clientX" in event && "clientY" in event;
  }

  private addCardContextMenuItems(menu: Menu, notePath: string): void {
    menu.addItem((item) => {
      item
        .setTitle("Move to…")
        .setIcon("folder-input")
        .onClick(() => {
          void this.routeCardMenuAction("move", notePath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle("Copy")
        .setIcon("documents")
        .onClick(() => {
          void this.routeCardMenuAction("copy", notePath);
        });
    });
  }

  private async routeCardMenuAction(action: CardMenuAction, notePath: string): Promise<void> {
    if (action === "copy") {
      await this.copyCardNote(notePath);
      return;
    }

    this.moveCardNote(notePath);
  }

  private async copyCardNote(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    await copyNoteToClipboard(this.app, file);
  }

  private moveCardNote(notePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    this.openMoveFolderPicker(file);
  }

  private openMoveFolderPicker(file: TFile): void {
    const modal = new FolderPickerModal(this.app, (targetFolder: TFolder) => {
      void this.onMoveTargetChosen(file.path, targetFolder);
    });
    modal.open();
  }

  private async onMoveTargetChosen(filePath: string, targetFolder: TFolder | null): Promise<void> {
    if (!(targetFolder instanceof TFolder)) {
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const parentPath = file.parent?.path ?? "";
    if (parentPath === targetFolder.path) {
      return;
    }

    const result = await moveFile(this.app, file, targetFolder);
    if (!result.ok) {
      new Notice(`Failed to move note: ${result.error}`);
    }
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

  private async runLoad(folderPath: string, loadKey: string): Promise<void> {
    const task = this.loadFolder(folderPath, loadKey);
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

  private async loadFolder(folderPath: string, loadKey: string): Promise<void> {
    this.folderPath = folderPath;
    this.loading = true;
    this.baseCards = [];
    this.generation += 1;
    this.pendingHydration.clear();
    this.pushState();

    const buildGeneration = this.generation;
    const settings = this.plugin.getSettings();

    try {
      const files = this.collectMarkdownFiles(folderPath, settings.includeSubfolders);
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
      this.baseCards = records;
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

    // All-notes mode: every markdown file is in scope
    if (this.folderPath === ALL_NOTES_PATH) {
      return true;
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

  private collectMarkdownFiles(folderPath: string, includeSubfolders: boolean): TFile[] {
    const isAllNotes = folderPath === ALL_NOTES_PATH;
    const root = isAllNotes
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(folderPath);

    if (!(root instanceof TFolder)) {
      return [];
    }

    if (!isAllNotes && !includeSubfolders) {
      const directFiles: TFile[] = [];
      for (const child of root.children) {
        if (child instanceof TFile && child.extension.toLowerCase() === "md") {
          directFiles.push(child);
        }
      }

      return directFiles;
    }

    // recursive (all-notes always recurses)
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

  private findSortedInsertIndex(newCard: NoteCardRecord): number {
    let low = 0;
    let high = this.baseCards.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const existingCard = this.baseCards[mid];
      if (!existingCard) {
        break;
      }
      const cmp = this.compareCards(
        existingCard,
        newCard,
        this.plugin.getSettings().sort.field,
        this.plugin.getSettings().sort.direction,
      );
      if (cmp <= 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  private applyIncrementalMutation(event: VaultMutationEvent): IncrementalMutationResult {
    if (!this.folderPath) {
      return { handled: false, action: "skipped_no_folder" };
    }

    if (event.isFolder) {
      // Folder-level events (other than rename path-rewrite already handled above)
      // are deferred to full reload for safety.
      return { handled: false, action: "skipped_folder_event" };
    }

    if (!event.isMarkdown) {
      return { handled: false, action: "skipped_folder_event" };
    }

    if (event.eventType === "delete") {
      const targetPath = event.path;
      const index = this.baseCards.findIndex((c) => c.path === targetPath);
      if (index === -1) {
        return { handled: true, action: "skipped_not_found" };
      }
      this.pendingHydration.delete(targetPath);
      this.baseCards.splice(index, 1);
      return { handled: true, action: "removed" };
    }

    if (event.eventType === "create") {
      const settings = this.plugin.getSettings();
      if (!this.isPathInScope(event.path, settings.includeSubfolders)) {
        return { handled: true, action: "skipped_not_found" };
      }

      // Avoid duplicates (e.g. rapid create+modify)
      const alreadyExists = this.baseCards.some((c) => c.path === event.path);
      if (alreadyExists) {
        return { handled: true, action: "skipped_not_found" };
      }

      const file = this.app.vault.getAbstractFileByPath(event.path);
      if (!(file instanceof TFile)) {
        return { handled: false, action: "deferred_full_reload" };
      }

      const newCard: NoteCardRecord = {
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

      const insertIndex = this.findSortedInsertIndex(newCard);
      this.baseCards.splice(insertIndex, 0, newCard);

      // Hydrate the new card immediately
      const capturedGeneration = this.generation;
      void this.hydrateCard(newCard.path, capturedGeneration).then(() => {
        if (capturedGeneration === this.generation) {
          this.pushState();
        }
      });

      return { handled: true, action: "inserted" };
    }

    if (event.eventType === "modify") {
      const index = this.baseCards.findIndex((c) => c.path === event.path);
      if (index === -1) {
        return { handled: true, action: "skipped_not_found" };
      }

      const card = this.baseCards[index];
      if (!card) {
        return { handled: true, action: "skipped_not_found" };
      }

      this.pendingHydration.delete(card.path);

      // Re-hydrate immediately; Obsidian already debounces modify events.
      // Keep old preview visible until new content is ready.
      const capturedGeneration = this.generation;
      void this.hydrateCard(card.path, capturedGeneration).then(() => {
        if (capturedGeneration === this.generation) {
          this.pushState();
        }
      });

      return { handled: true, action: "hydration_reset" };
    }

    if (event.eventType === "rename" && !event.isFolder) {
      const settings = this.plugin.getSettings();
      const oldIndex = event.oldPath
        ? this.baseCards.findIndex((c) => c.path === event.oldPath)
        : -1;

      const newInScope = this.isPathInScope(event.path, settings.includeSubfolders);

      if (oldIndex !== -1) {
        if (!newInScope) {
          // File moved out of scope — remove it
          const removedCard = this.baseCards[oldIndex];
          if (removedCard) {
            this.pendingHydration.delete(removedCard.path);
          }
          this.baseCards.splice(oldIndex, 1);
          return { handled: true, action: "removed" };
        }

        // Update in-place
        const card = this.baseCards[oldIndex];
        if (!card) {
          return { handled: false, action: "deferred_full_reload" };
        }

        const file = this.app.vault.getAbstractFileByPath(event.path);
        if (!(file instanceof TFile)) {
          return { handled: false, action: "deferred_full_reload" };
        }

        card.file = file;
        card.path = file.path;
        card.title = file.basename;
        return { handled: true, action: "updated" };
      }

      // Old path not in cards — file may have moved into scope
      if (newInScope) {
        const alreadyExists = this.baseCards.some((c) => c.path === event.path);
        if (!alreadyExists) {
          const file = this.app.vault.getAbstractFileByPath(event.path);
          if (!(file instanceof TFile)) {
            return { handled: false, action: "deferred_full_reload" };
          }

          const newCard: NoteCardRecord = {
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

          const insertIndex = this.findSortedInsertIndex(newCard);
          this.baseCards.splice(insertIndex, 0, newCard);

          void this.hydrateCard(newCard.path, this.generation).then(() => {
            this.pushState();
          });

          return { handled: true, action: "inserted" };
        }
      }

      return { handled: true, action: "skipped_not_found" };
    }

    return { handled: false, action: "deferred_full_reload" };
  }

  private async hydrateRange(start: number, end: number): Promise<void> {
    if (this.visibleCards.length === 0 || this.loading) {
      return;
    }

    const generation = this.generation;
    const targets: string[] = [];
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(this.visibleCards.length, end);

    for (let index = safeStart; index < safeEnd; index += 1) {
      const card = this.visibleCards[index];
      if (!card || card.hydrated || this.pendingHydration.has(card.path)) {
        continue;
      }
      this.pendingHydration.add(card.path);
      targets.push(card.path);
    }

    if (targets.length === 0) {
      return;
    }

    const batchSize = FolderCardView.HYDRATION_BATCH_SIZE;
    for (let batchStart = 0; batchStart < targets.length; batchStart += batchSize) {
      if (generation !== this.generation) {
        break;
      }

      const batch = targets.slice(batchStart, batchStart + batchSize);
      await Promise.all(batch.map((path) => this.hydrateCard(path, generation)));

      batch.forEach((path) => this.pendingHydration.delete(path));

      if (generation === this.generation) {
        this.pushState();
      }
    }
  }

  private hydrateVisibleCardsOnOpen(): void {
    if (this.loading || this.visibleCards.length === 0) {
      return;
    }

    const end = Math.min(
      this.visibleCards.length,
      FolderCardView.STARTUP_HYDRATION_CARD_COUNT,
    );
    void this.hydrateRange(0, end);
  }

  private async hydrateCard(cardPath: string, generation: number): Promise<void> {
    const card = this.baseCards.find((c) => c.path === cardPath);
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

  private async onSortChange(detail: {
    field?: unknown;
    direction?: unknown;
  }): Promise<void> {
    const nextField: SortField = detail.field === "ctime" ? "ctime" : "mtime";
    const nextDirection: SortDirection = detail.direction === "asc" ? "asc" : "desc";
    const currentSettings = this.plugin.getSettings();

    if (
      currentSettings.sort.field === nextField &&
      currentSettings.sort.direction === nextDirection
    ) {
      return;
    }

    await this.plugin.saveSettings({
      sort: {
        field: nextField,
        direction: nextDirection,
      },
    });

    this.pushState();
  }

  private buildFolderTree(): FolderTreeNode[] {
    const root = this.app.vault.getRoot();
    const rootNode: FolderTreeNode = {
      name: root.name || "/",
      path: "/",
      children: [],
      depth: 0,
    };

    function buildNode(folder: TFolder, depth: number): FolderTreeNode {
      const subfolders = folder.children
        .filter((c): c is TFolder => c instanceof TFolder)
        .sort((a, b) => a.name.localeCompare(b.name));
      return {
        name: folder.name || "/",
        path: folder.path === "" ? "/" : folder.path,
        children: subfolders.map((sf) => buildNode(sf, depth + 1)),
        depth,
      };
    }

    const subfolders = root.children
      .filter((c): c is TFolder => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name));

    rootNode.children = subfolders.map((sf) => buildNode(sf, 0));
    return rootNode.children;
  }

  private deriveVisibleCards(): NoteCardRecord[] {
    const context: PipelineContext = {
      app: this.app,
      settings: this.plugin.getSettings(),
    };
    return runPipeline(this.baseCards, DEFAULT_PIPELINE_STEPS, context);
  }

  private pushState(): void {
    this.visibleCards = this.deriveVisibleCards();

    const displayFolderPath = this.folderPath === ALL_NOTES_PATH
      ? "All Notes"
      : (this.folderPath ?? "");
    const settings = this.plugin.getSettings();

    this.component?.$set({
      cards: this.visibleCards,
      folderPath: displayFolderPath,
      selectedPath: this.selectedPath,
      loading: this.loading,
      generation: this.generation,
      sortField: settings.sort.field,
      sortDirection: settings.sort.direction,
    });
  }
}
