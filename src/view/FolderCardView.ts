import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { buildLightPreview } from "./markdown-utils";
import type { SortDirection, SortField } from "../settings";
import { ALL_NOTES_PATH } from "./types";
import type {
  CleanupResult,
  FolderLoadKey,
  FolderSelectionRequest,
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

  private static readonly HYDRATION_BATCH_SIZE = 5;

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
    this.component.$on("toolbar-action", (event: any) => {
      if (event.detail.action === "pick-folder") {
        this.plugin.openFolderPicker();
      } else if (event.detail.action === "all-notes") {
        void this.plugin.selectAllNotes();
      } else if (event.detail.action === "new-note") {
        void this.plugin.createNoteInCurrentFolder();
      }
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
    this.cards = [];
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
    let high = this.cards.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const existingCard = this.cards[mid];
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
      const index = this.cards.findIndex((c) => c.path === targetPath);
      if (index === -1) {
        return { handled: true, action: "skipped_not_found" };
      }
      this.pendingHydration.delete(index);
      // Rebuild pendingHydration indices for cards after the removed one
      const shifted = new Set<number>();
      for (const idx of this.pendingHydration) {
        shifted.add(idx > index ? idx - 1 : idx);
      }
      this.pendingHydration = shifted;
      this.cards.splice(index, 1);
      return { handled: true, action: "removed" };
    }

    if (event.eventType === "create") {
      const settings = this.plugin.getSettings();
      if (!this.isPathInScope(event.path, settings.includeSubfolders)) {
        return { handled: true, action: "skipped_not_found" };
      }

      // Avoid duplicates (e.g. rapid create+modify)
      const alreadyExists = this.cards.some((c) => c.path === event.path);
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
      this.cards.splice(insertIndex, 0, newCard);

      // Shift pendingHydration indices for cards after insertion point
      const shifted = new Set<number>();
      for (const idx of this.pendingHydration) {
        shifted.add(idx >= insertIndex ? idx + 1 : idx);
      }
      this.pendingHydration = shifted;

      // Hydrate the new card immediately
      const capturedGeneration = this.generation;
      void this.hydrateCard(insertIndex, capturedGeneration).then(() => {
        if (capturedGeneration === this.generation) {
          this.pushState();
        }
      });

      return { handled: true, action: "inserted" };
    }

    if (event.eventType === "modify") {
      const index = this.cards.findIndex((c) => c.path === event.path);
      if (index === -1) {
        return { handled: true, action: "skipped_not_found" };
      }

      const card = this.cards[index];
      if (!card) {
        return { handled: true, action: "skipped_not_found" };
      }

      this.pendingHydration.delete(index);

      // Re-hydrate immediately; Obsidian already debounces modify events.
      // Keep old preview visible until new content is ready.
      const capturedGeneration = this.generation;
      void this.hydrateCard(index, capturedGeneration).then(() => {
        if (capturedGeneration === this.generation) {
          this.pushState();
        }
      });

      return { handled: true, action: "hydration_reset" };
    }

    if (event.eventType === "rename" && !event.isFolder) {
      const settings = this.plugin.getSettings();
      const oldIndex = event.oldPath
        ? this.cards.findIndex((c) => c.path === event.oldPath)
        : -1;

      const newInScope = this.isPathInScope(event.path, settings.includeSubfolders);

      if (oldIndex !== -1) {
        if (!newInScope) {
          // File moved out of scope — remove it
          const shifted = new Set<number>();
          for (const idx of this.pendingHydration) {
            if (idx !== oldIndex) {
              shifted.add(idx > oldIndex ? idx - 1 : idx);
            }
          }
          this.pendingHydration = shifted;
          this.cards.splice(oldIndex, 1);
          return { handled: true, action: "removed" };
        }

        // Update in-place
        const card = this.cards[oldIndex];
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
        const alreadyExists = this.cards.some((c) => c.path === event.path);
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
          this.cards.splice(insertIndex, 0, newCard);

          const shifted = new Set<number>();
          for (const idx of this.pendingHydration) {
            shifted.add(idx >= insertIndex ? idx + 1 : idx);
          }
          this.pendingHydration = shifted;

          void this.hydrateCard(insertIndex, this.generation).then(() => {
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

    const batchSize = FolderCardView.HYDRATION_BATCH_SIZE;
    for (let batchStart = 0; batchStart < targets.length; batchStart += batchSize) {
      if (generation !== this.generation) {
        break;
      }

      const batch = targets.slice(batchStart, batchStart + batchSize);
      await Promise.all(batch.map((index) => this.hydrateCard(index, generation)));

      batch.forEach((index) => this.pendingHydration.delete(index));

      if (generation === this.generation) {
        this.pushState();
      }
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
    const displayFolderPath = this.folderPath === ALL_NOTES_PATH
      ? "All Notes"
      : (this.folderPath ?? "");

    this.component?.$set({
      cards: this.cards,
      folderPath: displayFolderPath,
      selectedPath: this.selectedPath,
      loading: this.loading,
      generation: this.generation,
    });
  }
}
