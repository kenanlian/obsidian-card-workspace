import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  TFile,
  TFolder,
  type App,
  type WorkspaceLeaf,
} from "obsidian";
import { mount, unmount } from "svelte";
import { FolderPickerModal } from "../FolderPickerModal";
import type { UiStrings } from "../i18n";
import { buildLightPreview, DEFAULT_PREVIEW_MAX_VISIBLE_CHARS } from "./markdown-utils";
import { collectAllTags } from "./metadata-utils";
import {
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchTrashFiles,
  copyNoteToClipboard,
  deleteFileUsingObsidianPreference,
  duplicateFile,
  mergeNotes,
  moveFile,
} from "./note-ops";
import { runPipeline, DEFAULT_PIPELINE_STEPS } from "./pipeline";
import {
  clearSelection,
  migrateRenamedPath,
  pruneRemovedPath,
  rangeSelect,
  reconcileToVisiblePaths,
  selectAll,
  toggleSelection,
} from "./bulk-selection";
import type { PipelineContext } from "./pipeline";
import type { OpenDestination, SortDirection, SortField } from "../settings";
import type { CardHoverLinkPayload } from "./types";
import {
  getCardPlaceholderText,
  isMarkdownCardKind,
  resolveCardFileKind,
  resolveCardFileKindFromPath,
  isSupportedCardFile,
} from "./file-kind";
import { createPanelModel, type PanelModel, type PanelModelState } from "./panel-model";
import type {
  BulkRuntimePanelState,
  CleanupResult,
  FolderLoadKey,
  FolderSelectionRequest,
  FolderTreeNode,
  IncrementalMutationResult,
  NoteCardRecord,
  RefreshRequest,
  RefreshResult,
  SearchStatus,
  SelectionResult,
  VaultMutationEvent,
  VaultMutationResult,
  PipelineSearchInput,
} from "./types";
import type { SearchQueryExecutionState, SearchQueryResult, SearchServiceSnapshot } from "../search";
import type FolderCardExplorerPlugin from "../main";

function normalizeFolderScopePath(path: string): string {
  return path === "/" ? "" : path;
}

export const FOLDER_CARD_VIEW = "folder-card-view";

type CardMenuAction =
  | OpenDestination
  | "make-copy"
  | "move"
  | "rename"
  | "delete"
  | "copy-note-content";

class BulkActionConfirmModal extends Modal {
  private readonly titleText: string;
  private readonly message: string;
  private readonly cancelButtonText: string;
  private readonly confirmButtonText: string;
  private readonly onDecision: (confirmed: boolean) => void;
  private resolved = false;

  constructor(
    app: App,
    options: {
      title: string;
      message: string;
      cancelButtonText: string;
      confirmButtonText: string;
    },
    onDecision: (confirmed: boolean) => void,
  ) {
    super(app);
    this.titleText = options.title;
    this.message = options.message;
    this.cancelButtonText = options.cancelButtonText;
    this.confirmButtonText = options.confirmButtonText;
    this.onDecision = onDecision;
  }

  onOpen(): void {
    this.setTitle(this.titleText);
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: this.message });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(this.cancelButtonText).onClick(() => {
          this.resolve(false);
        });
      })
      .addButton((button) => {
        button
          .setButtonText(this.confirmButtonText)
          .setWarning()
          .onClick(() => {
            this.resolve(true);
          });
      });
  }

  onClose(): void {
    this.contentEl.empty();

    if (!this.resolved) {
      this.onDecision(false);
    }
  }

  private resolve(confirmed: boolean): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.close();
    this.onDecision(confirmed);
  }
}

type MergeCleanupMode = "keep" | "trash";

interface MergeModalSubmitResult {
  files: TFile[];
  targetFolder: TFolder;
  mergedTitle: string;
  separator: string;
  cleanupMode: MergeCleanupMode;
}

function buildMergedMarkdownContent(files: Array<{ file: TFile; content: string }>, separator: string): string {
  return files
    .map(({ file, content }) => {
      return `# ${file.basename}\n\n${content}`;
    })
    .join(separator);
}

class BulkMergeModal extends Modal {
  private readonly strings: UiStrings["view"]["merge"];
  private readonly folderPickerTitle: string;
  private readonly onSubmit: (result: MergeModalSubmitResult) => Promise<boolean>;
  private orderedFiles: TFile[];
  private targetFolder: TFolder;
  private mergedTitle: string;
  private separator = "\n\n";
  private cleanupMode: MergeCleanupMode = "keep";
  private previewText: string;
  private previewError: string | null = null;
  private submitting = false;
  private closed = true;
  private previewRequestSeq = 0;
  private submitRequestSeq = 0;

  constructor(
    app: App,
    options: {
      files: TFile[];
      initialTargetFolder: TFolder;
      initialMergedTitle: string;
      strings: UiStrings["view"]["merge"];
      folderPickerTitle: string;
    },
    onSubmit: (result: MergeModalSubmitResult) => Promise<boolean>,
  ) {
    super(app);
    this.orderedFiles = [...options.files];
    this.targetFolder = options.initialTargetFolder;
    this.mergedTitle = options.initialMergedTitle;
    this.strings = options.strings;
    this.folderPickerTitle = options.folderPickerTitle;
    this.previewText = options.strings.loadingPreview;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.closed = false;
    void this.refreshPreview();
    this.render();
  }

  onClose(): void {
    this.closed = true;
    this.previewRequestSeq += 1;
    this.submitRequestSeq += 1;
    this.contentEl.empty();
  }
  private getScrollContainer(): HTMLElement {
    if (this.modalEl.scrollTop > 0 || this.modalEl.scrollHeight > this.modalEl.clientHeight) {
      return this.modalEl;
    }

    return this.contentEl;
  }


  private render(): void {
    if (this.closed) {
      return;
    }

    this.setTitle(this.strings.title);
    const scrollContainer = this.getScrollContainer();
    const scrollTop = scrollContainer.scrollTop;
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: this.strings.sourceCount(this.orderedFiles.length),
    });

    new Setting(this.contentEl)
      .setName(this.strings.mergedTitle)
      .addText((text) => {
        text.setValue(this.mergedTitle).onChange((value) => {
          this.mergedTitle = value;
        });
      });

    new Setting(this.contentEl)
      .setName(this.strings.targetFolder)
      .setDesc(this.targetFolder.path === "" ? "/" : this.targetFolder.path)
      .addButton((button) => {
        button.setButtonText(this.strings.chooseFolder).onClick(() => {
          const picker = new FolderPickerModal(this.app, (folder: TFolder) => {
            this.targetFolder = folder;
            this.render();
          }, this.folderPickerTitle);
          picker.open();
        });
      });

    new Setting(this.contentEl)
      .setName(this.strings.separator)
      .addText((text) => {
        text.setValue(this.separator).onChange((value) => {
          this.separator = value;
          void this.refreshPreview();
        });
      });

    this.contentEl.createEl("h4", { text: this.strings.sourceOrder });
    this.orderedFiles.forEach((file, index) => {
      new Setting(this.contentEl)
        .setName(`${index + 1}. ${file.path}`)
        .addButton((button) => {
          button.setButtonText(this.strings.up).onClick(() => {
            this.moveFile(index, -1);
          });
        })
        .addButton((button) => {
          button.setButtonText(this.strings.down).onClick(() => {
            this.moveFile(index, 1);
          });
        });
    });

    new Setting(this.contentEl)
      .setName(this.strings.sourceCleanup)
      .setDesc(this.cleanupMode === "keep" ? this.strings.keepSourceNotes : this.strings.trashSourceNotesAfterMerge)
      .addButton((button) => {
        button
          .setButtonText(this.strings.keepSourceNotes)
          .setCta()
          .onClick(() => {
            this.cleanupMode = "keep";
            this.render();
          });
      })
      .addButton((button) => {
        button
          .setButtonText(this.strings.trashSourceNotesAfterMerge)
          .setWarning()
          .onClick(() => {
            this.cleanupMode = "trash";
            this.render();
          });
      });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(this.strings.cancel).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(this.submitting ? this.strings.merging : this.strings.mergeNotes)
          .onClick(() => {
            void this.submit();
          });
      });

    this.contentEl.createEl("h4", { text: this.strings.preview });
    this.contentEl.createEl("pre", {
      text: this.previewError ?? this.previewText,
    });
    scrollContainer.scrollTop = scrollTop;
  }

  private moveFile(index: number, delta: -1 | 1): void {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= this.orderedFiles.length) {
      return;
    }

    const nextFiles = [...this.orderedFiles];
    const [moved] = nextFiles.splice(index, 1);
    if (!moved) {
      return;
    }
    nextFiles.splice(nextIndex, 0, moved);
    this.orderedFiles = nextFiles;
    void this.refreshPreview();
    this.render();
  }

  private async refreshPreview(): Promise<void> {
    const requestSeq = ++this.previewRequestSeq;
    const orderedFiles = [...this.orderedFiles];
    const separator = this.separator;

    try {
      const fileContents: Array<{ file: TFile; content: string }> = [];
      for (const file of orderedFiles) {
        const content = await this.app.vault.read(file);
        if (this.closed || requestSeq !== this.previewRequestSeq) {
          return;
        }
        fileContents.push({ file, content });
      }
      if (this.closed || requestSeq !== this.previewRequestSeq) {
        return;
      }
      this.previewText = buildMergedMarkdownContent(fileContents, separator);
      this.previewError = null;
    } catch (error) {
      if (this.closed || requestSeq !== this.previewRequestSeq) {
        return;
      }
      this.previewError = this.strings.failedToBuildPreview(String(error));
    }

    this.render();
  }

  private async submit(): Promise<void> {
    if (this.submitting || this.orderedFiles.length < 2) {
      return;
    }

    const requestSeq = ++this.submitRequestSeq;
    this.submitting = true;
    this.render();

    try {
      const mergedTitle = this.mergedTitle.trim();
      const shouldClose = await this.onSubmit({
        files: [...this.orderedFiles],
        targetFolder: this.targetFolder,
        mergedTitle: mergedTitle.length > 0 ? mergedTitle : this.strings.defaultMergedTitle,
        separator: this.separator,
        cleanupMode: this.cleanupMode,
      });
      if (this.closed || requestSeq !== this.submitRequestSeq) {
        return;
      }
      if (shouldClose) {
        this.close();
      }
    } catch (error) {
      if (this.closed || requestSeq !== this.submitRequestSeq) {
        return;
      }
      new Notice(this.strings.failedToMergeNotes(String(error)));
    } finally {
      if (requestSeq !== this.submitRequestSeq) {
        return;
      }
      this.submitting = false;
      this.render();
    }
  }
}

class RenameFileModal extends Modal {
  private readonly strings: UiStrings["view"]["rename"];
  private readonly initialName: string;
  private readonly onSubmit: (nextName: string) => Promise<void>;
  private nextName: string;
  private submitting = false;

  constructor(
    app: App,
    options: {
      initialName: string;
      strings: UiStrings["view"]["rename"];
    },
    onSubmit: (nextName: string) => Promise<void>,
  ) {
    super(app);
    this.initialName = options.initialName;
    this.strings = options.strings;
    this.nextName = options.initialName;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private render(): void {
    this.setTitle(this.strings.title);
    this.contentEl.empty();

    new Setting(this.contentEl).setName(this.strings.nameLabel).addText((text) => {
      text.setValue(this.nextName).setPlaceholder(this.initialName).onChange((value) => {
        this.nextName = value;
      });
    });

    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(this.strings.cancel).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(this.submitting ? this.strings.renaming : this.strings.rename)
          .onClick(() => {
            void this.submit();
          });
      });
  }

  private async submit(): Promise<void> {
    if (this.submitting) {
      return;
    }

    this.submitting = true;
    this.render();

    try {
      await this.onSubmit(this.nextName);
      this.close();
    } finally {
      this.submitting = false;
      this.render();
    }
  }
}

export class FolderCardView extends ItemView {
  private plugin: FolderCardExplorerPlugin;
  private component: ReturnType<typeof mount> | null = null;
  private hostEl: HTMLElement | null = null;
  private readonly panelModel: PanelModel;

  private folderPath = "";
  private folderLoadKey: string | null = null;
  private lastLoadedIncludeSubfolders: boolean | null = null;
  private baseCards: NoteCardRecord[] = [];
  private visibleCards: NoteCardRecord[] = [];
  // Runtime-only query state is view-owned and intentionally excluded from persisted settings.
  private searchQuery = "";
  private searchExecution: SearchQueryExecutionState = "indexed-unavailable";
  private searchOrderedPaths: string[] | undefined = undefined;
  private searchMatchCountsByPath: Record<string, number> = {};
  private searchStatus: SearchStatus = "idle";
  private selectedPath: string | null = null;
  private bulkMode = false;
  private selectedPaths = new Set<string>();
  private bulkAnchorPath: string | null = null;
  private loading = false;

  private generation = 0;
  private pendingHydration = new Set<string>();
  private requestSeq = 0;
  private searchRequestSeq = 0;
  private searchSnapshotSeq = 0;
  private searchSnapshot: SearchServiceSnapshot | null = null;
  private searchSnapshotUnsubscribe: (() => void) | null = null;
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  private static readonly HYDRATION_BATCH_SIZE = 5;
  private static readonly STARTUP_PREVIEW_CARD_COUNT = 6;
  private static readonly STARTUP_PREVIEW_WAIT_MS = 120;
  private static readonly SEARCH_DEBOUNCE_MS = 120;

  private inFlight: Promise<void> | null = null;
  private inFlightKey: string | null = null;
  private inFlightLoadScope: FolderLoadKey | null = null;
  private queuedRequest: FolderSelectionRequest | null = null;
  private refreshQueued = false;

  constructor(leaf: WorkspaceLeaf, plugin: FolderCardExplorerPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.panelModel = createPanelModel(this.buildPanelModelState());
  }

  getViewType(): string {
    return FOLDER_CARD_VIEW;
  }

  getDisplayText(): string {
    return this.strings.view.displayName;
  }

  getIcon(): string {
    return "gallery-horizontal";
  }

  private get strings(): UiStrings {
    return this.plugin.getUiStrings();
  }

  private getTooltipSide(): "left" | "right" {
    const root = this.leaf.getRoot();
    return root === this.app.workspace.leftSplit ? "right" : "left";
  }

  private buildEmptyStateMessage(): string {
    const strings = this.strings.view;
    const query = this.searchQuery.trim();

    if (query.length === 0) {
      return strings.emptyFolder;
    }

    const hasActiveTags = this.plugin.getSettings().filter.tags.length > 0;

    return hasActiveTags
      ? strings.emptySearchCurrentFolderWithTags(query)
      : strings.emptySearchCurrentFolder(query);
  }

  private openCardWithDestination(path: string, destination: OpenDestination): void {
    void this.plugin.openNoteFromCard(path, destination);
  }

  async onOpen(): Promise<void> {
    const panelModule = await import("./FolderCardPanel.svelte");
    const FolderCardPanel = panelModule.default;
    this.initializeSearchSnapshotState();
    this.panelModel.mutate((state) => {
      const settings = this.plugin.getSettings();
      const bulkRuntimeState = this.buildBulkRuntimePanelState();

      state.strings = this.strings;
      state.cards = this.visibleCards;
      state.emptyStateMessage = this.buildEmptyStateMessage();
      state.folderPath = this.getDisplayFolderPath();
      state.selectedPath = this.selectedPath;
      state.bulkMode = bulkRuntimeState.bulkMode;
      state.selectedPaths = bulkRuntimeState.selectedPaths;
      state.selectedCount = bulkRuntimeState.selectedCount;
      state.bulkAnchorPath = bulkRuntimeState.bulkAnchorPath;
      state.canBulkSelectAll = bulkRuntimeState.canBulkSelectAll;
      state.canBulkClearSelection = bulkRuntimeState.canBulkClearSelection;
      state.canBulkMoveSelected = bulkRuntimeState.canBulkMoveSelected;
      state.canBulkDeleteSelected = bulkRuntimeState.canBulkDeleteSelected;
      state.canBulkMergeSelected = bulkRuntimeState.canBulkMergeSelected;
      state.loading = this.loading;
      state.generation = this.generation;
      state.searchQuery = this.searchQuery;
      state.searchStatus = this.getSearchStatus();
      state.searchIndexReadiness = this.searchSnapshot?.health?.readiness;
      state.searchIndexPersistence = this.searchSnapshot?.health?.persistence;
      state.searchIndexRebuildReason = this.searchSnapshot?.health?.rebuildReason ?? null;
      state.sortField = settings.sort.field;
      state.sortDirection = settings.sort.direction;
      state.availableTags = this.deriveAvailableTags();
      state.activeFilterTags = settings.filter.tags;
      state.pinnedPaths = settings.pinnedPaths;
      state.cardCornerRadius = settings.cardCornerRadius;
      state.previewLines = settings.previewLines;
      state.includeSubfolders = settings.includeSubfolders;
      state.tooltipSide = this.getTooltipSide();
      state.tooltipSide = this.getTooltipSide();
    });

    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = mount(FolderCardPanel as any, {
      target: this.hostEl,
      props: {
        panelModel: this.panelModel,
        onOpenNote: (detail: { path?: unknown }) => {
          if (this.bulkMode || typeof detail.path !== "string") {
            return;
          }
          void this.plugin.openNoteFromCard(detail.path);
        },
        onBulkSelectCard: (detail: { path?: unknown; shiftKey?: unknown }) => {
          this.onBulkSelectCard(detail);
        },
        onCardContextMenu: (detail: {
          path?: unknown;
          mouseEvent?: unknown;
          trigger?: unknown;
          position?: unknown;
        }) => {
          this.openCardContextMenu({
            notePath: detail.path,
            trigger: detail.trigger,
            mouseEvent: detail.mouseEvent,
            position: detail.position,
          });
        },
        onHydrateRange: (detail: { start?: unknown; end?: unknown }) => {
          if (typeof detail.start !== "number" || typeof detail.end !== "number") {
            return;
          }
          void this.hydrateRange(detail.start, detail.end);
        },
        onToolbarAction: (detail: { action?: unknown }) => {
          this.handleToolbarAction(detail);
        },
        onSortChange: (detail: { field?: unknown; direction?: unknown }) => {
          void this.onSortChange(detail);
        },
        onFilterChange: (detail: { tags?: unknown }) => {
          void this.onFilterChange(detail);
        },
        onIncludeSubfoldersChange: (detail: { value?: unknown }) => {
          void this.onIncludeSubfoldersChange(detail);
        },
        onSearchQueryChange: (detail: { query?: unknown }) => {
          this.onSearchQueryChange(detail);
        },
        onSearchQueryReset: () => {
          this.resetSearchQuery();
        },
        onPinToggle: (detail: { path?: unknown; pinned?: unknown }) => {
          void this.onPinToggle(detail);
        },
        onCardHoverLink: (detail: CardHoverLinkPayload) => {
          this.onCardHoverLink(detail);
        },
        onSelectFolder: (detail: { path?: unknown }) => {
          if (typeof detail.path !== "string") {
            return;
          }
          void this.plugin.selectFolderByPath(detail.path, "panel-picker");
        },
      },
    });

    this.hydrateVisibleCardsOnOpen();
  }

  async onClose(): Promise<void> {
    this.cleanupLifecycle();

    if (this.component) {
      await unmount(this.component);
    }

    this.component = null;
    this.hostEl = null;
  }

  private handleToolbarAction(detail: { action?: unknown }): void {
    const action = detail.action;

    if (action === "pick-folder") {
      this.panelModel.mutate((state) => {
        state.folderTree = this.buildFolderTree();
      });
      return;
    }

    if (action === "new-note") {
      void this.plugin.createNoteInCurrentFolder();
      return;
    }

    if (action === "bulk") {
      this.toggleBulkMode();
      return;
    }

    if (action === "bulk-select-all") {
      this.bulkSelectAll();
      return;
    }

    if (action === "bulk-clear-selection") {
      this.bulkClearSelection();
      return;
    }

    if (action === "bulk-move-selected") {
      this.bulkMoveSelected();
      return;
    }

    if (action === "bulk-delete-selected") {
      void this.bulkDeleteSelected();
      return;
    }

    if (action === "bulk-merge-selected") {
      this.bulkMergeSelected();
    }
  }

  async setFolder(folder: TFolder): Promise<SelectionResult> {
    const request = this.createProgrammaticSelectionRequest(folder.path, false);
    return this.handleFolderSelection(request);
  }

  async handleFolderSelection(request: FolderSelectionRequest): Promise<SelectionResult> {
    const normalizedFolderPath = normalizeFolderScopePath(request.folderPath);
    const normalizedRequest =
      normalizedFolderPath === request.folderPath
        ? request
        : { ...request, folderPath: normalizedFolderPath };
    const folder = normalizedFolderPath === ""
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(normalizedFolderPath);

    if (!(folder instanceof TFolder)) {
      return {
        action: "rejected_invalid",
        folderPath: normalizedRequest.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const forceRefresh = normalizedRequest.forceRefresh ?? false;
    const nextLoadScope = this.buildLoadScope(normalizedRequest.folderPath);
    const loadKey = this.serializeLoadKey(nextLoadScope);
    const clearedBulkSelection = this.reconcileBulkSelectionBeforeLoad(nextLoadScope);

    if (this.inFlight) {
      if (clearedBulkSelection) {
        this.pushSelectionState();
      }
      if (!forceRefresh && this.inFlightKey === loadKey) {
        return {
          action: "reused_inflight",
          folderPath: normalizedRequest.folderPath,
          generationChanged: false,
          preserveUiState: true,
        };
      }

      this.queuedRequest = normalizedRequest;
      return {
        action: "queued_latest",
        folderPath: normalizedRequest.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    if (!forceRefresh && this.folderLoadKey === loadKey) {
      return {
        action: "noop",
        folderPath: normalizedRequest.folderPath,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    await this.runLoad(normalizedRequest.folderPath, nextLoadScope, loadKey);
    await this.drainQueuedRequest();

    return {
      action: "started",
      folderPath: normalizedRequest.folderPath,
      generationChanged: true,
      preserveUiState: false,
    };
  }

  async refresh(request: RefreshRequest = { reason: "manual" }): Promise<RefreshResult> {
    const targetPath = request.folderPath ?? this.folderPath;

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
    const currentFolderPath = this.normalizeActiveFolderScopePath();
    let selectedFolderPathAfterRename: string | null = null;
    if (event.eventType === "rename" && event.isFolder && event.oldPath) {
      const renamedPath = this.rewritePathAfterRename(currentFolderPath, event.oldPath, event.path);
      if (renamedPath !== currentFolderPath) {
        this.folderPath = renamedPath;
        this.folderLoadKey = this.serializeLoadKey(this.buildLoadScope(renamedPath));
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
    const cancelledDebounce = this.clearSearchDebounce();

    this.clearSearchSnapshotSubscription();
    this.searchSnapshot = null;
    this.queuedRequest = null;
    this.refreshQueued = false;
    this.pendingHydration.clear();
    this.inFlight = null;
    this.inFlightKey = null;
    this.inFlightLoadScope = null;
    this.loading = false;
    this.lastLoadedIncludeSubfolders = null;
    this.selectedPaths = new Set<string>();
    this.bulkAnchorPath = null;
    this.searchQuery = "";
    this.searchExecution = "indexed-unavailable";
    this.searchOrderedPaths = undefined;
    this.clearSearchMatchCounts();
    this.searchStatus = "idle";
    this.searchRequestSeq += 1;
    this.searchSnapshotSeq += 1;
    this.generation += 1;

    return {
      cancelledDebounce,
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

  onSearchSnapshot(searchSnapshot: SearchServiceSnapshot): void {
    this.applySearchSnapshot(searchSnapshot, true);
  }

  private initializeSearchSnapshotState(): void {
    this.clearSearchSnapshotSubscription();
    this.applySearchSnapshot(this.plugin.getSearchSnapshot(), false);
    this.searchSnapshotUnsubscribe = this.plugin.subscribeSearchSnapshots((snapshot) => {
      this.applySearchSnapshot(snapshot, true);
    });
  }

  private applySearchSnapshot(snapshot: SearchServiceSnapshot | null, pushState: boolean): void {
    this.searchSnapshot = snapshot;
    this.searchSnapshotSeq += 1;
    this.searchRequestSeq += 1;
    this.clearSearchMatchCounts();

    if (this.searchQuery.trim().length === 0) {
      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.searchStatus = this.deriveSearchStatus();
      if (pushState) {
        this.pushState();
      }
      return;
    }

    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.searchStatus = this.deriveSearchStatus();

    if (pushState) {
      this.pushState();
    }

    if (snapshot?.mode === "indexed" && snapshot.status === "ready") {
      void this.refreshSearchProjection();
    }
  }

  private clearSearchSnapshotSubscription(): void {
    this.searchSnapshotUnsubscribe?.();
    this.searchSnapshotUnsubscribe = null;
  }

  private openCardContextMenu(detail: {
    notePath?: unknown;
    trigger?: unknown;
    mouseEvent?: unknown;
    position?: unknown;
  }): void {
    if (typeof detail.notePath !== "string") {
      return;
    }

    if (detail.trigger === "button") {
      if (!this.isMenuPosition(detail.position)) {
        return;
      }
    } else if (!this.isMouseEventLike(detail.mouseEvent)) {
      return;
    }

    const menu = new Menu();
    this.addCardContextMenuItems(menu, detail.notePath);

    if (detail.trigger === "button") {
      const position = detail.position;
      if (!this.isMenuPosition(position)) {
        return;
      }
      menu.showAtPosition(position);
    } else {
      const mouseEvent = detail.mouseEvent;
      if (!this.isMouseEventLike(mouseEvent)) {
        return;
      }
      menu.showAtMouseEvent(mouseEvent);
    }

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

  private isMenuPosition(position: unknown): position is { x: number; y: number } {
    if (typeof position !== "object" || position === null) {
      return false;
    }

    if (!("x" in position) || !("y" in position)) {
      return false;
    }

    const x = (position as { x?: unknown }).x;
    const y = (position as { y?: unknown }).y;
    return typeof x === "number" && typeof y === "number";
  }

  private addCardContextMenuItems(menu: Menu, notePath: string): void {
    const strings = this.strings.view.contextMenu;
    menu.addItem((item) => {
      item
        .setTitle(strings.openInCurrentWindow)
        .setIcon("folder-open")
        .onClick(() => {
          void this.routeCardMenuAction("current-area", notePath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(strings.openInNewTab)
        .setIcon("file-plus")
        .onClick(() => {
          void this.routeCardMenuAction("new-tab", notePath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(strings.openToTheRight)
        .setIcon("separator-vertical")
        .onClick(() => {
          void this.routeCardMenuAction("split-right", notePath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(strings.openInNewWindow)
        .setIcon("picture-in-picture-2")
        .onClick(() => {
          void this.routeCardMenuAction("new-window", notePath);
        });
    });

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle(strings.makeCopy)
        .setIcon("copy")
        .onClick(() => {
          void this.routeCardMenuAction("make-copy", notePath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(strings.moveFileTo)
        .setIcon("folder-input")
        .onClick(() => {
          void this.routeCardMenuAction("move", notePath);
        });
    });

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (file instanceof TFile) {
      const fileKind = resolveCardFileKind(file);
      if (fileKind !== null && isMarkdownCardKind(fileKind)) {
        menu.addItem((item) => {
          item
            .setTitle(strings.copyNoteContent)
            .setIcon("documents")
            .onClick(() => {
              void this.routeCardMenuAction("copy-note-content", notePath);
            });
        });
      }
    }

    menu.addSeparator();

    menu.addItem((item) => {
      item
        .setTitle(strings.rename)
        .setIcon("pencil")
        .onClick(() => {
          void this.routeCardMenuAction("rename", notePath);
        });
    });

    menu.addItem((item) => {
      item
        .setTitle(strings.delete)
        .setIcon("trash")
        .onClick(() => {
          void this.routeCardMenuAction("delete", notePath);
        });
    });
  }

  private async routeCardMenuAction(action: CardMenuAction, notePath: string): Promise<void> {
    if (action === "copy-note-content") {
      await this.copyCardNote(notePath);
      return;
    }

    if (action === "make-copy") {
      await this.makeCardFileCopy(notePath);
      return;
    }

    if (action === "move") {
      this.moveCardNote(notePath);
      return;
    }

    if (action === "rename") {
      this.renameCardFile(notePath);
      return;
    }

    if (action === "delete") {
      await this.deleteCardFile(notePath);
      return;
    }

    this.openCardWithDestination(notePath, action);
  }

  private async copyCardNote(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    await copyNoteToClipboard(this.app, file, this.strings.noteOps);
  }

  private async makeCardFileCopy(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const result = await duplicateFile(this.app, file);
    if (!result.ok) {
      new Notice(this.strings.app.failedToCopyFile(result.error));
    }
  }

  private moveCardNote(notePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    this.openMoveFolderPicker(file);
  }

  private renameCardFile(notePath: string): void {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const modal = new RenameFileModal(
      this.app,
      { initialName: file.basename, strings: this.strings.view.rename },
      async (nextName: string) => {
        await this.submitRename(notePath, nextName);
      },
    );
    modal.open();
  }

  private async submitRename(notePath: string, nextName: string): Promise<void> {
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      new Notice(this.strings.app.fileNameCannotBeEmpty);
      return;
    }

    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    const nextPath = this.buildSiblingPath(file.parent?.path ?? "", this.buildRenamedFileName(file, trimmedName));
    try {
      await this.app.fileManager.renameFile(file, nextPath);
    } catch (error) {
      new Notice(this.strings.app.failedToRenameFile(String(error)));
    }
  }

  private async deleteCardFile(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return;
    }

    try {
      const confirmed = await this.app.fileManager.promptForDeletion(file);
      if (!confirmed) {
        return;
      }

      const liveFile = this.app.vault.getAbstractFileByPath(notePath);
      if (!(liveFile instanceof TFile)) {
        return;
      }

      const result = await deleteFileUsingObsidianPreference(this.app, liveFile);
      if (!result.ok) {
        new Notice(this.strings.app.failedToDeleteFile(result.error));
      }
    } catch (error) {
      new Notice(this.strings.app.failedToDeleteFile(String(error)));
    }
  }

  private openMoveFolderPicker(file: TFile): void {
    const modal = new FolderPickerModal(this.app, (targetFolder: TFolder) => {
      void this.onMoveTargetChosen(file.path, targetFolder);
    }, this.strings.folderPicker.selectFolderTitle);
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

    const result = await moveFile(this.app, file, targetFolder, this.strings.noteOps);
    if (!result.ok) {
      new Notice(this.strings.app.failedToMoveFile(result.error));
    }
  }

  private buildSiblingPath(parentPath: string, fileName: string): string {
    if (parentPath.length === 0) {
      return fileName;
    }

    return `${parentPath}/${fileName}`;
  }

  private buildRenamedFileName(file: TFile, inputName: string): string {
    const trimmedName = inputName.trim();
    if (file.extension.length === 0) {
      return trimmedName;
    }

    const extensionSuffix = `.${file.extension}`;
    if (trimmedName.toLowerCase().endsWith(extensionSuffix.toLowerCase())) {
      return trimmedName;
    }

    return `${trimmedName}${extensionSuffix}`;
  }

  private reconcileBulkSelectionBeforeLoad(nextLoadScope: FolderLoadKey): boolean {
    if (!this.shouldClearBulkSelectionForScopeChange(nextLoadScope)) {
      return false;
    }

    this.selectedPaths = new Set<string>();
    this.bulkAnchorPath = null;
    return true;
  }

  private shouldClearBulkSelectionForScopeChange(nextLoadScope: FolderLoadKey): boolean {
    if (this.inFlightLoadScope) {
      if (this.inFlightLoadScope.folderPath !== nextLoadScope.folderPath) {
        return true;
      }
      return this.inFlightLoadScope.includeSubfolders !== nextLoadScope.includeSubfolders;
    }

    const currentFolderPath = this.normalizeActiveFolderScopePath();
    if (currentFolderPath !== nextLoadScope.folderPath) {
      return true;
    }

    return (
      this.lastLoadedIncludeSubfolders !== null &&
      this.lastLoadedIncludeSubfolders !== nextLoadScope.includeSubfolders
    );
  }

  private createProgrammaticSelectionRequest(
    folderPath: string,
    forceRefresh: boolean,
  ): FolderSelectionRequest {
    this.requestSeq += 1;
    return {
      requestId: this.requestSeq,
      folderPath: normalizeFolderScopePath(folderPath),
      source: "programmatic",
      requestedAtMs: Date.now(),
      forceRefresh,
    };
  }
  private buildLoadScope(folderPath: string): FolderLoadKey {
    const settings = this.plugin.getSettings();
    return {
      folderPath: normalizeFolderScopePath(folderPath),
      includeSubfolders: settings.includeSubfolders,
      sortField: settings.sort.field,
      sortDirection: settings.sort.direction,
    };
  }

  private serializeLoadKey(loadKey: FolderLoadKey): string {
    return `${loadKey.folderPath}::${loadKey.includeSubfolders}::${loadKey.sortField}::${loadKey.sortDirection}`;
  }

  private async runLoad(
    folderPath: string,
    loadScope: FolderLoadKey,
    loadKey: string,
  ): Promise<void> {
    const task = this.loadFolder(folderPath, loadScope, loadKey);
    this.inFlight = task;
    this.inFlightKey = loadKey;
    this.inFlightLoadScope = loadScope;

    try {
      await task;
    } finally {
      if (this.inFlight === task) {
        this.inFlight = null;
        this.inFlightKey = null;
        this.inFlightLoadScope = null;
      }
    }
  }

  private async loadFolder(
    folderPath: string,
    loadScope: FolderLoadKey,
    loadKey: string,
  ): Promise<void> {
    this.folderPath = folderPath;
    this.loading = true;
    this.generation += 1;
    this.pendingHydration.clear();
    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.clearSearchMatchCounts();
    this.clearSearchDebounce();
    this.searchRequestSeq += 1;
    this.searchStatus = this.deriveSearchStatus();
    this.pushState();

    const buildGeneration = this.generation;

    try {
      const files = this.collectSupportedFiles(folderPath, loadScope.includeSubfolders);
      const records: NoteCardRecord[] = [];
      for (const file of files) {
        const fileKind = resolveCardFileKind(file);
        if (fileKind === null) {
          continue;
        }

        records.push({
          file,
          fileKind,
          path: file.path,
          title: file.basename,
          ctime: file.stat.ctime,
          mtime: file.stat.mtime,
          excerpt: "",
          previewHtml: "",
          previewMode: "empty",
          hydrated: false,
        });
      }

      if (buildGeneration !== this.generation) {
        return;
      }

      records.sort((left, right) =>
        this.compareCards(left, right, loadScope.sortField, loadScope.sortDirection),
      );
      this.baseCards = records;
      this.folderLoadKey = loadKey;
      this.lastLoadedIncludeSubfolders = loadScope.includeSubfolders;
      const startupPaths = this.deriveVisibleCardsFrom(records)
        .slice(0, FolderCardView.STARTUP_PREVIEW_CARD_COUNT)
        .map((card) => card.path);
      await this.hydrateStartupCardPaths(startupPaths, buildGeneration);
    } finally {
      if (buildGeneration === this.generation) {
        this.loading = false;
        this.pushState();
        void this.refreshSearchProjection();
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
    if (!event.isFolder) {
      const oldPathKind =
        typeof event.oldPath === "string" && event.oldPath.length > 0
          ? resolveCardFileKindFromPath(event.oldPath)
          : null;
      if (event.fileKind === null && oldPathKind === null) {
        return false;
      }
    }

    const includeSubfolders = this.plugin.getSettings().includeSubfolders;
    const pathInScope = this.isPathInScope(event.path, includeSubfolders);
    const oldPathInScope =
      typeof event.oldPath === "string" && event.oldPath.length > 0
        ? this.isPathInScope(event.oldPath, includeSubfolders)
        : false;

    return pathInScope || oldPathInScope;
  }

  private normalizeActiveFolderScopePath(): string {
    const normalizedFolderPath = normalizeFolderScopePath(this.folderPath);
    if (normalizedFolderPath !== this.folderPath) {
      this.folderPath = normalizedFolderPath;
    }

    return normalizedFolderPath;
  }

  private isPathInScope(path: string, includeSubfolders: boolean): boolean {
    const currentFolderPath = this.normalizeActiveFolderScopePath();
    if (currentFolderPath === "") {
      return includeSubfolders || !path.includes("/");
    }

    if (path === currentFolderPath) {
      return true;
    }

    const prefix = `${currentFolderPath}/`;
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
    currentPath: string,
    oldPath: string,
    newPath: string,
  ): string {
    if (currentPath === "") {
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

  private collectSupportedFiles(folderPath: string, includeSubfolders: boolean): TFile[] {
    const root = folderPath === ""
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(folderPath);

    if (!(root instanceof TFolder)) {
      return [];
    }

    if (!includeSubfolders) {
      const directFiles: TFile[] = [];
      for (const child of root.children) {
        if (child instanceof TFile && isSupportedCardFile(child)) {
          directFiles.push(child);
        }
      }

      return directFiles;
    }

    // recursive
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

        if (child instanceof TFile && isSupportedCardFile(child)) {
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
    let difference: number;
    if (field === "name") {
      difference = left.title.localeCompare(right.title);
    } else {
      const leftValue = field === "ctime" ? left.ctime : left.mtime;
      const rightValue = field === "ctime" ? right.ctime : right.mtime;
      difference = leftValue - rightValue;
    }

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
  private reinsertCardAtSortedPosition(index: number): void {
    const [card] = this.baseCards.splice(index, 1);
    if (!card) {
      return;
    }

    const insertIndex = this.findSortedInsertIndex(card);
    this.baseCards.splice(insertIndex, 0, card);
  }

  private applyIncrementalMutation(event: VaultMutationEvent): IncrementalMutationResult {

    if (event.isFolder) {
      // Folder-level events (other than rename path-rewrite already handled above)
      // are deferred to full reload for safety.
      return { handled: false, action: "skipped_folder_event" };
    }

    const oldPathKind =
      typeof event.oldPath === "string" && event.oldPath.length > 0
        ? resolveCardFileKindFromPath(event.oldPath)
        : null;

    if (event.fileKind === null && oldPathKind === null) {
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
      const bulkResult = pruneRemovedPath(
        {
          selectedPaths: this.selectedPaths,
          anchorPath: this.bulkAnchorPath,
        },
        targetPath,
      );
      this.selectedPaths = bulkResult.selectedPaths;
      this.bulkAnchorPath = bulkResult.anchorPath;
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

      const fileKind = resolveCardFileKind(file);
      if (fileKind === null) {
        return { handled: true, action: "skipped_not_found" };
      }

      const newCard: NoteCardRecord = {
        file,
        fileKind,
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
      const newPathKind = event.fileKind;

      if (oldIndex !== -1) {
        if (!newInScope || newPathKind === null) {
          // File moved out of scope — remove it
          const removedCard = this.baseCards[oldIndex];
          if (removedCard) {
            this.pendingHydration.delete(removedCard.path);
          }
          this.baseCards.splice(oldIndex, 1);
          if (event.oldPath) {
            const bulkResult = pruneRemovedPath(
              {
                selectedPaths: this.selectedPaths,
                anchorPath: this.bulkAnchorPath,
              },
              event.oldPath,
            );
            this.selectedPaths = bulkResult.selectedPaths;
            this.bulkAnchorPath = bulkResult.anchorPath;
          }
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

        const oldCardPath = card.path;
        const hadPendingHydration = this.pendingHydration.delete(oldCardPath);

        card.file = file;
        card.fileKind = newPathKind;
        card.path = file.path;
        card.title = file.basename;

        if (hadPendingHydration) {
          this.pendingHydration.add(file.path);
        }

        if (event.oldPath) {
          const bulkResult = migrateRenamedPath(
            {
              selectedPaths: this.selectedPaths,
              anchorPath: this.bulkAnchorPath,
            },
            event.oldPath,
            file.path,
          );
          this.selectedPaths = bulkResult.selectedPaths;
          this.bulkAnchorPath = bulkResult.anchorPath;
        }

        this.reinsertCardAtSortedPosition(oldIndex);
        return { handled: true, action: "updated" };
      }

      // Old path not in cards — file may have moved into scope
      if (newInScope && newPathKind !== null) {
        const alreadyExists = this.baseCards.some((c) => c.path === event.path);
        if (!alreadyExists) {
          const file = this.app.vault.getAbstractFileByPath(event.path);
          if (!(file instanceof TFile)) {
            return { handled: false, action: "deferred_full_reload" };
          }

          const newCard: NoteCardRecord = {
            file,
            fileKind: newPathKind,
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

    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(this.visibleCards.length, end);
    const targets = this.visibleCards
      .slice(safeStart, safeEnd)
      .map((card) => card.path);

    await this.hydrateCardPaths(targets, this.generation, {
      pushState: true,
      batchSize: FolderCardView.HYDRATION_BATCH_SIZE,
    });
  }

  private async hydrateCardPaths(
    paths: string[],
    generation: number,
    options: {
      pushState: boolean;
      batchSize?: number;
    },
  ): Promise<void> {
    if (paths.length === 0 || generation !== this.generation) {
      return;
    }

    const targets: string[] = [];
    for (const path of paths) {
      const card = this.baseCards.find((candidate) => candidate.path === path);
      if (!card || card.hydrated || this.pendingHydration.has(path)) {
        continue;
      }

      this.pendingHydration.add(path);
      targets.push(path);
    }

    if (targets.length === 0) {
      return;
    }

    const batchSize = Math.max(1, options.batchSize ?? targets.length);

    try {
      for (let batchStart = 0; batchStart < targets.length; batchStart += batchSize) {
        if (generation !== this.generation) {
          return;
        }

        const batch = targets.slice(batchStart, batchStart + batchSize);
        await Promise.all(batch.map((path) => this.hydrateCard(path, generation)));

        if (generation !== this.generation) {
          return;
        }

        batch.forEach((path) => this.pendingHydration.delete(path));
      }
    } finally {
      if (generation === this.generation) {
        targets.forEach((path) => this.pendingHydration.delete(path));
      }
    }

    if (options.pushState && generation === this.generation) {
      this.pushState();
    }
  }

  private async hydrateStartupCardPaths(paths: string[], generation: number): Promise<void> {
    if (paths.length === 0 || generation !== this.generation) {
      return;
    }

    const hydration = this.hydrateCardPaths(paths, generation, {
      pushState: false,
      batchSize: FolderCardView.HYDRATION_BATCH_SIZE,
    });
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const waitBudget = new Promise<"timeout">((resolve) => {
      timeoutId = setTimeout(() => {
        resolve("timeout");
      }, FolderCardView.STARTUP_PREVIEW_WAIT_MS);
    });

    const result = await Promise.race([
      hydration.then(() => "hydrated" as const),
      waitBudget,
    ]);

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    if (result === "timeout") {
      void hydration.then(
        () => {
          if (generation === this.generation) {
            this.pushState();
          }
        },
        (error: unknown) => {
          console.warn("[Card Workspace] Startup preview hydration failed.", error);
        },
      );
    }
  }

  private hydrateVisibleCardsOnOpen(): void {
    if (this.loading || this.visibleCards.length === 0) {
      return;
    }

    const end = Math.min(
      this.visibleCards.length,
      FolderCardView.STARTUP_PREVIEW_CARD_COUNT,
    );
    void this.hydrateRange(0, end);
  }

  private async hydrateCard(cardPath: string, generation: number): Promise<void> {
    const card = this.baseCards.find((c) => c.path === cardPath);
    if (!card) {
      return;
    }

    if (!isMarkdownCardKind(card.fileKind)) {
      if (generation !== this.generation) {
        return;
      }

      card.excerpt = "";
      card.previewHtml = `<p class="fce-preview-placeholder">${getCardPlaceholderText(card.fileKind, this.strings.fileKind)}</p>`;
      card.previewMode = "placeholder";
      card.hydrated = true;
      return;
    }

    try {
      const markdown = await this.app.vault.cachedRead(card.file);
      if (generation !== this.generation) {
        return;
      }

      const settings = this.plugin.getSettings();
      const preview = buildLightPreview(
        markdown,
        DEFAULT_PREVIEW_MAX_VISIBLE_CHARS,
        settings.previewLines,
      );
      card.previewHtml = preview.html;
      card.previewMode = preview.mode;
      card.hydrated = true;
    } catch {
      if (generation !== this.generation) {
        return;
      }

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
    const nextField: SortField =
      detail.field === "ctime" || detail.field === "name" ? detail.field : "mtime";
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
    this.baseCards.sort((left, right) => this.compareCards(left, right, nextField, nextDirection));
    this.folderLoadKey = this.serializeLoadKey(this.buildLoadScope(this.folderPath));


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

    return [rootNode, ...subfolders.map((sf) => buildNode(sf, 0))];
  }

  private deriveAvailableTags(): string[] {
    const metadataCache = (this.app as unknown as { metadataCache?: unknown }).metadataCache;
    const hasGetFileCache =
      typeof metadataCache === "object" &&
      metadataCache !== null &&
      "getFileCache" in metadataCache &&
      typeof (metadataCache as { getFileCache?: unknown }).getFileCache === "function";

    if (!hasGetFileCache) {
      return [];
    }

    return collectAllTags(
      this.app,
      this.baseCards.map((card) => card.file),
    );
  }

  private deriveVisibleCards(): NoteCardRecord[] {
    return this.deriveVisibleCardsFrom(this.baseCards);
  }

  private deriveVisibleCardsFrom(cards: NoteCardRecord[]): NoteCardRecord[] {
    const settings = this.plugin.getSettings();
    const context: PipelineContext = {
      app: this.app,
      settings,
      search: this.buildPipelineSearchInput(),
      pinnedPaths: settings.pinnedPaths,
    };

    return runPipeline(cards, DEFAULT_PIPELINE_STEPS, context);
  }

  private buildPipelineSearchInput(): PipelineSearchInput {
    if (this.searchExecution !== "indexed-ready") {
      return {
        query: this.searchQuery,
        execution: this.searchExecution,
      };
    }

    return {
      query: this.searchQuery,
      execution: this.searchExecution,
      orderedPaths: this.searchOrderedPaths ?? [],
    };
  }

  private getSearchStatus(): SearchStatus {
    return this.searchStatus;
  }

  private clearSearchDebounce(): boolean {
    if (!this.searchDebounceTimer) {
      return false;
    }

    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = null;
    return true;
  }

  private scheduleDebouncedSearchProjection(): void {
    this.clearSearchDebounce();
    this.searchDebounceTimer = setTimeout(() => {
      this.searchDebounceTimer = null;
      void this.refreshSearchProjection();
    }, FolderCardView.SEARCH_DEBOUNCE_MS);
  }

  private deriveSearchStatus(): SearchStatus {
    const query = this.searchQuery.trim();
    if (query.length === 0) {
      return this.deriveEmptyQuerySearchStatus();
    }

    return this.deriveIndexedSearchStatus(false);
  }

  private deriveIndexedSearchStatus(emptyQuery: boolean): SearchStatus {
    const snapshot = this.searchSnapshot;
    if (!snapshot) {
      return emptyQuery ? "idle" : "unavailable";
    }

    if (!snapshot.initialized || snapshot.disposed) {
      return emptyQuery ? "idle" : "unavailable";
    }

    if (snapshot.status === "error") {
      return "error";
    }

    if (snapshot.status === "building") {
      if (snapshot.health.outcome === "rebuild-required") {
        return this.isStorageUnavailable(snapshot)
          ? "storage-unavailable"
          : "rebuild-required";
      }

      return "building";
    }

    return "ready";
  }

  private deriveEmptyQuerySearchStatus(): SearchStatus {
    return this.deriveIndexedSearchStatus(true);
  }

  private onSearchQueryChange(detail: { query?: unknown }): void {
    const nextQuery = typeof detail.query === "string" ? detail.query : "";
    if (nextQuery === this.searchQuery) {
      return;
    }

    this.searchQuery = nextQuery;
    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.clearSearchMatchCounts();
    this.searchRequestSeq += 1;
    this.searchStatus = this.deriveSearchStatus();
    this.pushState();

    if (this.searchQuery.trim().length > 0) {
      this.scheduleDebouncedSearchProjection();
      return;
    }

    this.clearSearchDebounce();
  }

  private resetSearchQuery(): void {
    this.clearSearchDebounce();
    this.searchRequestSeq += 1;
    this.clearSearchMatchCounts();

    if (this.searchQuery.length === 0 && this.searchOrderedPaths === undefined) {
      this.searchStatus = this.deriveSearchStatus();
      this.pushState();
      return;
    }

    this.searchQuery = "";
    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.searchStatus = this.deriveSearchStatus();
    this.pushState();
  }

  private async refreshSearchProjection(): Promise<void> {
    const query = this.searchQuery.trim();
    if (query.length === 0) {
      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.clearSearchMatchCounts();
      this.searchStatus = this.deriveSearchStatus();
      this.pushState();
      return;
    }

    const service = this.plugin.getSearchService();
    if (!service) {
      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.clearSearchMatchCounts();
      this.searchStatus = this.deriveSearchStatus();
      this.pushState();
      return;
    }

    const requestSeq = this.searchRequestSeq + 1;
    this.searchRequestSeq = requestSeq;
    const requestGeneration = this.generation;
    const requestFolderPath = this.folderPath;
    const requestSnapshotSeq = this.searchSnapshotSeq;

    try {
      const result = await service.query({
        query,
        scope: {
          folderPath: this.folderPath,
          includeSubfolders: this.plugin.getSettings().includeSubfolders,
        },
        candidatePaths: this.baseCards.map((card) => card.path),
      });

      if (!this.isSearchRequestCurrent(requestSeq, requestGeneration, requestFolderPath, requestSnapshotSeq, query)) {
        return;
      }

      this.searchExecution = result.execution;
      if (result.execution === "indexed-ready") {
        this.searchOrderedPaths = result.orderedPaths ?? [];
        this.searchMatchCountsByPath = { ...(result.matchCountsByPath ?? {}) };
      } else {
        this.searchOrderedPaths = undefined;
        this.clearSearchMatchCounts();
      }
      this.searchStatus = this.toRuntimeSearchStatus(result);
      this.pushState();
    } catch {
      if (!this.isSearchRequestCurrent(requestSeq, requestGeneration, requestFolderPath, requestSnapshotSeq, query)) {
        return;
      }

      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.clearSearchMatchCounts();
      this.searchStatus = this.deriveSearchStatus();
      this.pushState();
    }
  }

  private isSearchRequestCurrent(
    requestSeq: number,
    requestGeneration: number,
    requestFolderPath: string | null,
    requestSnapshotSeq: number,
    requestQuery: string,
  ): boolean {
    if (requestSeq !== this.searchRequestSeq) {
      return false;
    }

    if (requestGeneration !== this.generation) {
      return false;
    }

    if (requestFolderPath !== this.folderPath) {
      return false;
    }

    if (requestSnapshotSeq !== this.searchSnapshotSeq) {
      return false;
    }

    return requestQuery === this.searchQuery.trim();
  }

  private toRuntimeSearchStatus(result: SearchQueryResult): SearchStatus {
    switch (result.execution) {
      case "indexed-ready":
        return "ready";
      case "indexed-building":
        return "building";
      case "indexed-rebuild-required":
        return "rebuild-required";
      case "indexed-storage-unavailable":
        return "storage-unavailable";
      case "indexed-error":
        return "error";
      case "indexed-unavailable":
      default:
        return "unavailable";
    }
  }

  private derivePendingSearchExecution(): SearchQueryExecutionState {
    const snapshot = this.searchSnapshot;
    if (!snapshot || !snapshot.initialized || snapshot.disposed) {
      return "indexed-unavailable";
    }

    if (snapshot.status === "error") {
      return "indexed-error";
    }

    if (snapshot.status === "building") {
      if (snapshot.health.outcome === "rebuild-required") {
        return this.isStorageUnavailable(snapshot)
          ? "indexed-storage-unavailable"
          : "indexed-rebuild-required";
      }

      return "indexed-building";
    }

    return "indexed-unavailable";
  }

  private isStorageUnavailable(snapshot: SearchServiceSnapshot): boolean {
    return (
      snapshot.health.persistence === "storage-unavailable"
      || snapshot.health.rebuildReason === "storage-unavailable"
    );
  }

  private getOrderedVisiblePaths(): string[] {
    return this.visibleCards.map((card) => card.path);
  }

  private clearSearchMatchCounts(): void {
    this.searchMatchCountsByPath = {};
  }

  private reconcileBulkSelectionToVisibleCards(): void {
    const result = reconcileToVisiblePaths(
      {
        selectedPaths: this.selectedPaths,
        anchorPath: this.bulkAnchorPath,
      },
      this.getOrderedVisiblePaths(),
    );

    this.selectedPaths = result.selectedPaths;
    this.bulkAnchorPath = result.anchorPath;
  }

  private applyBulkSelectionFromResult(result: {
    selectedPaths: Set<string>;
    anchorPath: string | null;
    changed: boolean;
  }): void {
    this.selectedPaths = result.selectedPaths;
    this.bulkAnchorPath = result.anchorPath;

    if (result.changed) {
      this.pushSelectionState();
    }
  }

  private toggleBulkMode(): void {
    this.bulkMode = !this.bulkMode;

    if (!this.bulkMode) {
      this.selectedPaths = new Set<string>();
      this.bulkAnchorPath = null;
    }

    this.pushSelectionState();
  }

  private bulkSelectAll(): void {
    if (!this.bulkMode) {
      return;
    }

    const result = selectAll(
      {
        selectedPaths: this.selectedPaths,
        anchorPath: this.bulkAnchorPath,
      },
      this.getOrderedVisiblePaths(),
    );
    this.applyBulkSelectionFromResult(result);
  }

  private bulkClearSelection(): void {
    if (!this.bulkMode) {
      return;
    }

    const result = clearSelection({
      selectedPaths: this.selectedPaths,
      anchorPath: this.bulkAnchorPath,
    });
    this.applyBulkSelectionFromResult(result);
  }

  private bulkMoveSelected(): void {
    if (!this.bulkMode || this.selectedPaths.size === 0) {
      return;
    }

    const modal = new FolderPickerModal(this.app, (targetFolder: TFolder) => {
      void this.onBulkMoveTargetChosen(targetFolder);
    }, this.strings.folderPicker.selectFolderTitle);
    modal.open();
  }

  private async onBulkMoveTargetChosen(targetFolder: TFolder | null): Promise<void> {
    const moveStrings = this.strings.view.move;
    if (!(targetFolder instanceof TFolder)) {
      return;
    }

    const selectedPathsInOrder = Array.from(this.selectedPaths);
    const filesToMove: TFile[] = [];

    for (const selectedPath of selectedPathsInOrder) {
      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (file instanceof TFile) {
        filesToMove.push(file);
      }
    }

    if (filesToMove.length === 0) {
      this.selectedPaths = new Set<string>();
      this.bulkAnchorPath = null;
      this.pushSelectionState();
      new Notice(moveStrings.noSelectedNotes);
      return;
    }

    const filesAlreadyInTarget = filesToMove.filter((file) => {
      return (file.parent?.path ?? "") === targetFolder.path;
    });
    const movableFiles = filesToMove.filter((file) => {
      return (file.parent?.path ?? "") !== targetFolder.path;
    });

    if (movableFiles.length === 0) {
      const alreadyTargetPathsInOrder = selectedPathsInOrder.filter((selectedPath) => {
        return filesAlreadyInTarget.some((file) => file.path === selectedPath);
      });
      this.selectedPaths = new Set<string>(alreadyTargetPathsInOrder);
      this.bulkAnchorPath = alreadyTargetPathsInOrder[0] ?? null;
      this.pushSelectionState();
      new Notice(moveStrings.allAlreadyInTargetFolder);
      return;
    }

    const summary = await batchMoveFiles(this.app, movableFiles, targetFolder, this.strings.noteOps);
    const failedPathsInOrder = selectedPathsInOrder.filter((selectedPath) => {
      return (
        filesAlreadyInTarget.some((file) => file.path === selectedPath) ||
        summary.failed.some((failed) => failed.path === selectedPath)
      );
    });

    this.selectedPaths = new Set<string>(failedPathsInOrder);
    this.bulkAnchorPath = failedPathsInOrder[0] ?? null;
    this.pushSelectionState();

    const succeededCount = summary.succeeded.length;
    const failedCount = summary.failed.length + filesAlreadyInTarget.length;

    if (failedCount === 0) {
      new Notice(moveStrings.moved(succeededCount));
      return;
    }

    if (succeededCount === 0) {
      new Notice(moveStrings.failed(failedCount));
      return;
    }

    new Notice(moveStrings.partial(succeededCount, failedCount));
  }

  private async bulkDeleteSelected(): Promise<void> {
    if (!this.bulkMode || this.selectedPaths.size === 0) {
      return;
    }

    await this.executeBulkDestructiveAction({
      noLiveFilesMessage: this.strings.view.bulkDelete.noLiveFilesMessage,
      confirmTitle: this.strings.view.bulkDelete.confirmTitle,
      confirmButtonText: this.strings.view.bulkDelete.confirmButtonText,
      confirmMessageBuilder: (count) => this.strings.view.bulkDelete.confirmMessage(count),
      successMessageBuilder: (count) => this.strings.view.bulkDelete.successMessage(count),
      failureMessageBuilder: (count) => this.strings.view.bulkDelete.failureMessage(count),
      partialMessageBuilder: (success, failed) => this.strings.view.bulkDelete.partialMessage(success, failed),
      runBatch: (files) => batchDeleteFilesUsingObsidianPreference(this.app, files),
    });
  }

  private resolveSelectedLiveFilesInOrder(): { selectedPathsInOrder: string[]; filesInOrder: TFile[] } {
    const selectedPathsInOrder = Array.from(this.selectedPaths);
    const filesInOrder: TFile[] = [];

    for (const selectedPath of selectedPathsInOrder) {
      const file = this.app.vault.getAbstractFileByPath(selectedPath);
      if (file instanceof TFile) {
        filesInOrder.push(file);
      }
    }

    return { selectedPathsInOrder, filesInOrder };
  }

  private reconcileSelectionToOrderedPaths(pathsInOrder: string[]): void {
    this.selectedPaths = new Set<string>(pathsInOrder);
    this.bulkAnchorPath = pathsInOrder[0] ?? null;
    this.pushSelectionState();
  }

  private requestDestructiveConfirmation(options: {
    title: string;
    message: string;
    confirmButtonText: string;
  }): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new BulkActionConfirmModal(this.app, {
        ...options,
        cancelButtonText: this.strings.view.bulkConfirm.cancel,
      }, resolve);
      modal.open();
    });
  }

  private async executeBulkDestructiveAction(options: {
    noLiveFilesMessage: string;
    confirmTitle: string;
    confirmButtonText: string;
    confirmMessageBuilder: (count: number) => string;
    successMessageBuilder: (count: number) => string;
    failureMessageBuilder: (count: number) => string;
    partialMessageBuilder: (success: number, failed: number) => string;
    runBatch: (files: TFile[]) => Promise<{ succeeded: Array<{ file: TFile }>; failed: Array<{ path: string }> }>;
  }): Promise<void> {
    const { selectedPathsInOrder, filesInOrder } = this.resolveSelectedLiveFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);

    if (filesInOrder.length === 0) {
      this.reconcileSelectionToOrderedPaths([]);
      new Notice(options.noLiveFilesMessage);
      return;
    }

    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }

    const confirmed = await this.requestDestructiveConfirmation({
      title: options.confirmTitle,
      message: options.confirmMessageBuilder(filesInOrder.length),
      confirmButtonText: options.confirmButtonText,
    });
    if (!confirmed) {
      return;
    }

    const summary = await options.runBatch(filesInOrder);
    const failedPathSet = new Set(summary.failed.map((failed) => failed.path));
    const failedPathsInOrder = livePathsInOrder.filter((path) => failedPathSet.has(path));

    this.reconcileSelectionToOrderedPaths(failedPathsInOrder);

    const succeededCount = summary.succeeded.length;
    const failedCount = summary.failed.length;

    if (failedCount === 0) {
      new Notice(options.successMessageBuilder(succeededCount));
      return;
    }

    if (succeededCount === 0) {
      new Notice(options.failureMessageBuilder(failedCount));
      return;
    }

    new Notice(options.partialMessageBuilder(succeededCount, failedCount));
  }

  private bulkMergeSelected(): void {
    if (!this.bulkMode || this.selectedPaths.size < 2) {
      return;
    }

    const selectedPathSet = new Set(this.selectedPaths);
    const selectedPathsInVisibleOrder = this.visibleCards
      .map((card) => card.path)
      .filter((path) => selectedPathSet.has(path));
    const filesInFrozenOrder: TFile[] = [];

    for (const path of selectedPathsInVisibleOrder) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        filesInFrozenOrder.push(file);
      }
    }

    const livePathsInFrozenOrder = filesInFrozenOrder.map((file) => file.path);
    if (livePathsInFrozenOrder.length !== this.selectedPaths.size) {
      this.reconcileSelectionToOrderedPaths(livePathsInFrozenOrder);
    }

    if (filesInFrozenOrder.length < 2) {
      new Notice(this.strings.view.merge.selectAtLeastTwoNotes);
      return;
    }

    const firstParentPath = filesInFrozenOrder[0]?.parent?.path ?? "";
    const initialTargetFolder = this.app.vault.getAbstractFileByPath(firstParentPath);
    const targetFolder = initialTargetFolder instanceof TFolder ? initialTargetFolder : this.app.vault.getRoot();

    const modal = new BulkMergeModal(
      this.app,
      {
        files: filesInFrozenOrder,
        initialTargetFolder: targetFolder,
        initialMergedTitle: this.strings.view.merge.defaultMergedTitle,
        strings: this.strings.view.merge,
        folderPickerTitle: this.strings.folderPicker.selectFolderTitle,
      },
      async (result) => {
        return this.executeBulkMerge(result);
      },
    );
    modal.open();
  }

  private async executeBulkMerge(result: MergeModalSubmitResult): Promise<boolean> {
    const mergeResult = await mergeNotes(
      this.app,
      result.files,
      result.targetFolder,
      result.mergedTitle,
      result.separator,
      this.strings.noteOps,
    );

    if (!mergeResult.ok) {
      new Notice(this.strings.view.merge.failedToMergeNotes(mergeResult.error));
      return false;
    }

    new Notice(this.strings.view.merge.mergedInto(mergeResult.sourceCount, mergeResult.mergedFile.basename));

    if (result.cleanupMode === "keep") {
      this.reconcileSelectionToOrderedPaths([]);
      return true;
    }

    const trashSummary = await batchTrashFiles(this.app, result.files);
    const failedPathSet = new Set(trashSummary.failed.map((failed) => failed.path));
    const failedPathsInOrder = result.files
      .map((file) => file.path)
      .filter((path) => failedPathSet.has(path));

    this.reconcileSelectionToOrderedPaths(failedPathsInOrder);

    const trashedCount = trashSummary.succeeded.length;
    const failedCount = trashSummary.failed.length;

    if (failedCount === 0) {
      new Notice(this.strings.view.merge.trashedSources(trashedCount));
      return true;
    }

    if (trashedCount === 0) {
      new Notice(this.strings.view.merge.failedToTrashSources(failedCount));
      return true;
    }

    new Notice(this.strings.view.merge.trashedSourcesPartial(trashedCount, failedCount));
    return true;
  }

  private getDisplayFolderPath(): string {
    if (this.folderPath === "") {
      return "/";
    }

    return this.folderPath;
  }

  private buildBulkRuntimePanelState(): BulkRuntimePanelState {
    const selectedPaths = Array.from(this.selectedPaths);
    const selectedCount = selectedPaths.length;
    const hasSelection = selectedCount > 0;

    return {
      bulkMode: this.bulkMode,
      selectedPaths,
      selectedCount,
      bulkAnchorPath: this.bulkAnchorPath,
      canBulkSelectAll: this.visibleCards.length > 0,
      canBulkClearSelection: hasSelection,
      canBulkMoveSelected: hasSelection,
      canBulkDeleteSelected: hasSelection,
      canBulkMergeSelected: selectedCount > 1,
    };
  }

  private buildPanelModelState(): PanelModelState {
    const settings = this.plugin.getSettings();
    const bulkRuntimeState = this.buildBulkRuntimePanelState();

    return {
      strings: this.strings,
      cards: this.visibleCards,
      searchMatchCountsByPath: { ...this.searchMatchCountsByPath },
      emptyStateMessage: this.buildEmptyStateMessage(),
      folderPath: this.getDisplayFolderPath(),
      selectedPath: this.selectedPath,
      ...bulkRuntimeState,
      loading: this.loading,
      generation: this.generation,
      searchQuery: this.searchQuery,
      searchStatus: this.getSearchStatus(),
      searchIndexReadiness: this.searchSnapshot?.health?.readiness,
      searchIndexPersistence: this.searchSnapshot?.health?.persistence,
      searchIndexRebuildReason: this.searchSnapshot?.health?.rebuildReason ?? null,
      sortField: settings.sort.field,
      sortDirection: settings.sort.direction,
      availableTags: this.deriveAvailableTags(),
      activeFilterTags: settings.filter.tags,
      pinnedPaths: settings.pinnedPaths,
      cardCornerRadius: settings.cardCornerRadius,
      previewLines: settings.previewLines,
      folderTree: [],
      includeSubfolders: settings.includeSubfolders,
      tooltipSide: this.getTooltipSide(),
    };
  }

  private pushSelectionState(): void {
    this.reconcileBulkSelectionToVisibleCards();

    const settings = this.plugin.getSettings();
    const bulkRuntimeState = this.buildBulkRuntimePanelState();

    this.panelModel.mutate((state) => {
      state.cards = this.visibleCards;
      state.searchMatchCountsByPath = { ...this.searchMatchCountsByPath };
      state.emptyStateMessage = this.buildEmptyStateMessage();
      state.folderPath = this.getDisplayFolderPath();
      state.selectedPath = this.selectedPath;
      state.bulkMode = bulkRuntimeState.bulkMode;
      state.selectedPaths = bulkRuntimeState.selectedPaths;
      state.selectedCount = bulkRuntimeState.selectedCount;
      state.bulkAnchorPath = bulkRuntimeState.bulkAnchorPath;
      state.canBulkSelectAll = bulkRuntimeState.canBulkSelectAll;
      state.canBulkClearSelection = bulkRuntimeState.canBulkClearSelection;
      state.canBulkMoveSelected = bulkRuntimeState.canBulkMoveSelected;
      state.canBulkDeleteSelected = bulkRuntimeState.canBulkDeleteSelected;
      state.canBulkMergeSelected = bulkRuntimeState.canBulkMergeSelected;
      state.loading = this.loading;
      state.generation = this.generation;
      state.searchQuery = this.searchQuery;
      state.searchStatus = this.getSearchStatus();
      state.searchIndexReadiness = this.searchSnapshot?.health?.readiness;
      state.searchIndexPersistence = this.searchSnapshot?.health?.persistence;
      state.searchIndexRebuildReason = this.searchSnapshot?.health?.rebuildReason ?? null;
      state.sortField = settings.sort.field;
      state.sortDirection = settings.sort.direction;
      state.activeFilterTags = settings.filter.tags;
      state.pinnedPaths = settings.pinnedPaths;
      state.cardCornerRadius = settings.cardCornerRadius;
      state.previewLines = settings.previewLines;
      state.includeSubfolders = settings.includeSubfolders;
    });
  }

  private pushState(): void {
    this.visibleCards = this.deriveVisibleCards();
    this.reconcileBulkSelectionToVisibleCards();

    const settings = this.plugin.getSettings();
    const bulkRuntimeState = this.buildBulkRuntimePanelState();

    this.panelModel.mutate((state) => {
      state.cards = this.visibleCards;
      state.searchMatchCountsByPath = { ...this.searchMatchCountsByPath };
      state.emptyStateMessage = this.buildEmptyStateMessage();
      state.folderPath = this.getDisplayFolderPath();
      state.selectedPath = this.selectedPath;
      state.bulkMode = bulkRuntimeState.bulkMode;
      state.selectedPaths = bulkRuntimeState.selectedPaths;
      state.selectedCount = bulkRuntimeState.selectedCount;
      state.bulkAnchorPath = bulkRuntimeState.bulkAnchorPath;
      state.canBulkSelectAll = bulkRuntimeState.canBulkSelectAll;
      state.canBulkClearSelection = bulkRuntimeState.canBulkClearSelection;
      state.canBulkMoveSelected = bulkRuntimeState.canBulkMoveSelected;
      state.canBulkDeleteSelected = bulkRuntimeState.canBulkDeleteSelected;
      state.canBulkMergeSelected = bulkRuntimeState.canBulkMergeSelected;
      state.loading = this.loading;
      state.generation = this.generation;
      state.searchQuery = this.searchQuery;
      state.searchStatus = this.getSearchStatus();
      state.searchIndexReadiness = this.searchSnapshot?.health?.readiness;
      state.searchIndexPersistence = this.searchSnapshot?.health?.persistence;
      state.searchIndexRebuildReason = this.searchSnapshot?.health?.rebuildReason ?? null;
      state.sortField = settings.sort.field;
      state.sortDirection = settings.sort.direction;
      state.availableTags = this.deriveAvailableTags();
      state.activeFilterTags = settings.filter.tags;
      state.pinnedPaths = settings.pinnedPaths;
      state.cardCornerRadius = settings.cardCornerRadius;
      state.previewLines = settings.previewLines;
      state.includeSubfolders = settings.includeSubfolders;
    });
  }

  private async onFilterChange(detail: { tags?: unknown }): Promise<void> {
    const rawTags = Array.isArray(detail.tags) ? detail.tags : [];
    const normalizedTag = rawTags
      .filter((tag): tag is string => typeof tag === "string")
      .map((tag) => tag.trim().replace(/^#/, "").toLowerCase())
      .find((tag) => tag.length > 0);
    const nextTags = normalizedTag ? [normalizedTag] : [];
    const currentTags = this.plugin.getSettings().filter.tags;

    if (
      currentTags.length === nextTags.length &&
      currentTags.every((tag, index) => tag === nextTags[index])
    ) {
      return;
    }

    await this.plugin.saveSettings({
      filter: {
        tags: nextTags,
      },
    });
  }

  private async onIncludeSubfoldersChange(detail: { value?: unknown }): Promise<void> {
    if (typeof detail.value !== "boolean") {
      return;
    }

    if (this.plugin.getSettings().includeSubfolders === detail.value) {
      return;
    }

    await this.plugin.saveSettings({
      includeSubfolders: detail.value,
    });
  }

  private async onPinToggle(detail: { path?: unknown; pinned?: unknown }): Promise<void> {
    const path = typeof detail.path === "string" ? detail.path : "";
    if (path.length === 0) {
      return;
    }

    const currentPinnedPaths = this.plugin.getSettings().pinnedPaths;
    const currentlyPinned = currentPinnedPaths.includes(path);
    const shouldPin = typeof detail.pinned === "boolean" ? detail.pinned : !currentlyPinned;

    if (shouldPin === currentlyPinned) {
      return;
    }

    const nextPinnedPaths = shouldPin
      ? [...currentPinnedPaths, path]
      : currentPinnedPaths.filter((pinnedPath) => pinnedPath !== path);

    await this.plugin.saveSettings({
      pinnedPaths: nextPinnedPaths,
    });
  }

  private onBulkSelectCard(detail: { path?: unknown; shiftKey?: unknown }): void {
    const path = typeof detail.path === "string" ? detail.path : "";
    if (path.length === 0) {
      return;
    }

    if (!this.bulkMode) {
      void this.plugin.openNoteFromCard(path);
      return;
    }

    const orderedVisiblePaths = this.getOrderedVisiblePaths();
    if (!orderedVisiblePaths.includes(path)) {
      return;
    }

    const selectionState = {
      selectedPaths: this.selectedPaths,
      anchorPath: this.bulkAnchorPath,
    };

    const result = detail.shiftKey === true
      ? rangeSelect(selectionState, this.bulkAnchorPath, path, orderedVisiblePaths)
      : toggleSelection(selectionState, path);

    this.applyBulkSelectionFromResult(result);
  }

  private onCardHoverLink(detail: CardHoverLinkPayload): void {
    this.app.workspace.trigger("hover-link", {
      event: detail.mouseEvent,
      source: "card-workspace",
      hoverParent: this,
      targetEl: detail.targetEl,
      linktext: detail.path,
    });
  }
}
