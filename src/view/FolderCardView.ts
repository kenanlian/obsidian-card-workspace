import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  TFile,
  TFolder,
  type WorkspaceLeaf,
} from "obsidian";
import { mount, unmount } from "svelte";
import { FolderPickerModal } from "../FolderPickerModal";
import { CARD_WORKSPACE_ICON, PLAIN_FOLDER_ICON } from "../icons";
import type { UiStrings } from "../i18n";
import { buildLightPreview, DEFAULT_PREVIEW_MAX_VISIBLE_CHARS } from "./markdown-utils";
import {
  collectAllTags,
  collectTagCounts,
  collectVaultTagIndex,
  getFileTags,
} from "./metadata-utils";
import {
  addTagToFile,
  batchAddTagToFiles,
  batchDeleteFilesUsingObsidianPreference,
  batchMoveFiles,
  batchRemoveTagsFromFiles,
  batchTrashFiles,
  copyContentToClipboard,
  copyPathToClipboard,
  copyTitleAndContentToClipboard,
  copyTitleToClipboard,
  deleteFileUsingObsidianPreference,
  duplicateFile,
  mergeNotes,
  moveFile,
  normalizeTagForFrontmatter,
  removeTagFromFile,
  resolveUniquePath,
  trashAbstractFileUsingObsidianPreference,
} from "./note-ops";
import { canResolveSystemPath, getSystemPath, showInSystemExplorer } from "./desktop-shell";
import { getMenuDom, type MenuDomLike } from "./menu-dom";
import {
  buildNavContextMenu,
  resolveNavMenuDangerLabel,
  type NavMenuDeps,
} from "./nav-context-menu";
import {
  isFavorite,
  isFavoriteKind,
  moveFavorite,
  pruneFavoriteBoxes,
  toggleFavorite,
} from "./favorites";
import { normalizeTagPath } from "./tag-tree";
import { AsyncEpoch, type EpochToken } from "./async-epoch";
import { runPipeline, stepsForScope } from "./pipeline";
import {
  createBoxScope,
  createFolderScope,
  isBoxScope,
  isFolderScope,
  normalizeScopePath,
  scopeDisplayPath,
  scopesEqual,
  serializeScopeKey,
  validateScope,
  type CardScope,
} from "./scope";
import {
  collectSupportedFiles as collectFolderScopeFiles,
  isPathInFolderScope,
  rewritePathAfterRename,
} from "./scope-files";
import type { ViewUpdateIntent } from "./update-intent";
import { isBoxMember } from "./card-box-membership";
import {
  addManualPaths,
  addRuleToBox,
  createCardBox,
  deleteCardBox,
  duplicateCardBox,
  findCardBox,
  getBoxMembershipSignature,
  removeMemberFromBox,
  renameCardBox,
  restoreExcludedPaths,
  translateBrowseScopeToRule,
  upsertCardBox,
} from "./card-boxes";
import { BoxConfigModal } from "./modals/BoxConfigModal";
import { BoxNameModal } from "./modals/BoxNameModal";
import { BulkActionConfirmModal } from "./modals/BulkActionConfirmModal";
import {
  BulkMergeModal,
  type MergeModalSubmitResult,
} from "./modals/BulkMergeModal";
import {
  BulkRemoveTagsModal,
  type BulkRemovableTagOption,
} from "./modals/BulkRemoveTagsModal";
import { CreateFolderModal } from "./modals/CreateFolderModal";
import { RenameFileModal } from "./modals/RenameFileModal";
import { TagInputModal, type TagMutationMode } from "./modals/TagInputModal";
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
import { CARD_PANE_MIN_WIDTH } from "../settings";
import type {
  OpenDestination,
  PartialPluginSettings,
  SortDirection,
  SortField,
} from "../settings";
import type {
  CardBoxDefinition,
  CardHoverLinkPayload,
  FavoriteEntry,
  FavoriteKind,
  FolderActionPayload,
  NavContextMenuPayload,
  Rule,
} from "./types";
import {
  getCardFileIcon,
  getCardPlaceholderText,
  isMarkdownCardKind,
  resolveCardFileKind,
  resolveCardFileKindFromPath,
  isSupportedCardFile,
} from "./file-kind";
import {
  PANEL_GROUPS,
  createPanelModel,
  type BoxSummary,
  type FavoriteRowModel,
  type PanelGroup,
  type PanelModel,
  type PanelModelState,
} from "./panel-model";
import type {
  BulkRuntimePanelState,
  CleanupResult,
  CardLoadKey,
  FolderSelectionRequest,
  FolderTreeNode,
  IncrementalMutationResult,
  NoteCardRecord,
  RefreshReason,
  RefreshRequest,
  RefreshResult,
  SearchStatus,
  SelectionResult,
  VaultMutationEvent,
  VaultMutationResult,
  PipelineSearchInput,
} from "./types";
import type { SearchQueryExecutionState, SearchQueryResult, SearchServiceSnapshot } from "../search";
import type CardWorkspacePlugin from "../main";

export const FOLDER_CARD_VIEW = "folder-card-view";
const TAG_ADD_ICON = "card-workspace-tag-plus";
const TAG_REMOVE_ICON = "card-workspace-tag-minus";
/** JSON Canvas requires the two top-level arrays; Obsidian rewrites the file on first save. */
const NEW_CANVAS_CONTENT = '{"nodes":[],"edges":[]}';
const NEW_BASE_CONTENT = "views:\n  - type: table\n    name: Table\n";
/** Mirrors `TFile.basename`: `Foo.excalidraw.md` keeps the `.excalidraw` half. */
const CARD_FILE_EXTENSIONS = [".md", ".canvas", ".base"];

function stripCardFileExtension(fileName: string): string {
  for (const extension of CARD_FILE_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return fileName.slice(0, -extension.length);
    }
  }
  return fileName;
}


type CardMenuAction =
  | OpenDestination
  | "make-copy"
  | "move"
  | "rename"
  | "delete"
  | "add-tag"
  | "remove-tag"
  | "copy-title"
  | "copy-content"
  | "copy-title-and-content";

export class FolderCardView extends ItemView {
  private plugin: CardWorkspacePlugin;
  private component: ReturnType<typeof mount> | null = null;
  private hostEl: HTMLElement | null = null;
  private readonly panelModel: PanelModel;

  /** The runtime source of truth for what feeds the card stream. */
  private cardScope: CardScope = createFolderScope("", true);
  private folderLoadKey: string | null = null;
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
  private shellWidth = 0;
  private singlePaneView: "nav" | "cards" = "cards";
  private searchFocusToken = 0;

  /** Independent guards for load, selection, search, and derived-cache freshness. */
  private readonly loadEpoch = new AsyncEpoch();
  private readonly selectionEpoch = new AsyncEpoch();
  private readonly searchRequestEpoch = new AsyncEpoch();
  private readonly searchSnapshotEpoch = new AsyncEpoch();
  private readonly vaultContentEpoch = new AsyncEpoch();
  private readonly navCountEpoch = new AsyncEpoch();

  private pendingHydration = new Set<string>();
  private searchSnapshot: SearchServiceSnapshot | null = null;
  private searchSnapshotUnsubscribe: (() => void) | null = null;
  private searchDebounceTimer: ReturnType<Window["setTimeout"]> | null = null;
  private folderTreeDebounceTimer: ReturnType<Window["setTimeout"]> | null = null;
  private boxCardCountCache = new Map<string, { signature: string; count: number }>();
  private navCountRefreshHandle: ReturnType<Window["setTimeout"]> | null = null;
  private scopeTagCache: {
    key: string;
    value: { availableTags: string[]; tagCounts: Record<string, number> };
  } | null = null;
  private vaultTagCountsCache: { seq: number; counts: Record<string, number> } | null = null;
  private folderTreeCountsByPath = new Map<string, { direct: number; recursive: number }>();
  /** Cached so layout-only nav publications do not walk the vault. */
  private folderTree: FolderTreeNode[] = [];

  private static readonly HYDRATION_BATCH_SIZE = 5;
  private static readonly STARTUP_PREVIEW_CARD_COUNT = 6;
  private static readonly STARTUP_PREVIEW_WAIT_MS = 120;
  private static readonly SEARCH_DEBOUNCE_MS = 120;
  private static readonly FOLDER_TREE_DEBOUNCE_MS = 250;
  private static readonly NAV_COUNT_REFRESH_DEBOUNCE_MS = 250;
  private static readonly FOLDER_DUPLICATE_CONFIRM_THRESHOLD = 50;

  private inFlight: Promise<unknown> | null = null;
  private inFlightKey: string | null = null;
  private inFlightLoadScope: CardLoadKey | null = null;
  private queuedRequest: FolderSelectionRequest | null = null;
  private refreshQueued = false;

  constructor(leaf: WorkspaceLeaf, plugin: CardWorkspacePlugin) {
    super(leaf);
    this.plugin = plugin;
    this.panelModel = createPanelModel({
      strings: this.strings,
      scope: this.buildScopeGroup(),
      cards: this.buildCardsGroup(),
      search: this.buildSearchGroup(),
      projection: this.buildProjectionGroup(),
      bulk: this.buildBulkGroup(),
      nav: this.buildNavGroup(),
      appearance: this.buildAppearanceGroup(),
    });
  }

  getViewType(): string {
    return FOLDER_CARD_VIEW;
  }

  getDisplayText(): string {
    return this.strings.view.displayName;
  }

  getIcon(): string {
    return CARD_WORKSPACE_ICON;
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

  // ---------------------------------------------------------------------------
  // Card box mode
  // ---------------------------------------------------------------------------

  private getScopeBox(): CardBoxDefinition | null {
    if (!isBoxScope(this.cardScope)) {
      return null;
    }
    return findCardBox(this.plugin.getSettings().boxes ?? [], this.cardScope.boxId);
  }

  async moveScopeToFolder(path: string): Promise<SelectionResult> {
    const request = this.createProgrammaticSelectionRequest(
      createFolderScope(path, this.plugin.getSettings().includeSubfolders),
      false,
    );
    return this.handleScopeSelection(request);
  }

  async enterBoxScope(boxId: string): Promise<void> {
    const request = this.createProgrammaticSelectionRequest(createBoxScope(boxId), false);
    const result = await this.handleScopeSelection(request);
    if (result.action === "rejected_invalid") {
      return;
    }
    this.returnToCardsViewIfSinglePane();
  }

  async exitBoxScope(): Promise<void> {
    const result = await this.moveScopeToFolder(this.plugin.getSettings().lastFolderPath);
    if (result.action === "rejected_invalid") {
      return;
    }
    this.returnToCardsViewIfSinglePane();
  }

  private async persistScopeProjection(): Promise<void> {
    const scope = this.cardScope;
    const settings = this.plugin.getSettings();
    if (isFolderScope(scope)) {
      if (settings.lastFolderPath === scope.path && settings.activeBoxId === null) {
        return;
      }
      await this.plugin.saveSettings({ lastFolderPath: scope.path, activeBoxId: null });
      return;
    }
    if (settings.activeBoxId === scope.boxId) {
      return;
    }
    await this.plugin.saveSettings({ activeBoxId: scope.boxId });
  }

  /**
   * Member count for a box, cached per membership signature.
   *
   * Counting scans every rule's folder scope, so the cache keeps nav publishing
   * cheap; it is cleared on vault mutations and on box persistence.
   */
  private countBoxCards(box: CardBoxDefinition): number {
    const signature = getBoxMembershipSignature(box);
    const cached = this.boxCardCountCache.get(box.id);
    if (cached && cached.signature === signature) {
      return cached.count;
    }

    const count = this.collectBoxFiles(box).length;
    this.boxCardCountCache.set(box.id, { signature, count });
    return count;
  }

  /**
   * Resolve the candidate member files for a box: the union of each rule's
   * folder scope plus manual paths, filtered down to actual box members.
   * Membership is metadata-based and never gated by search index readiness.
   */
  private collectBoxFiles(box: CardBoxDefinition): TFile[] {
    const candidatePaths = new Set<string>();

    for (const rule of box.rules) {
      for (const file of this.collectSupportedFiles(rule.folder, rule.includeSubfolders)) {
        candidatePaths.add(file.path);
      }
    }
    for (const path of box.manualPaths) {
      candidatePaths.add(path);
    }

    const files: TFile[] = [];
    for (const path of candidatePaths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (
        file instanceof TFile &&
        isSupportedCardFile(file) &&
        isBoxMember(this.app, path, box)
      ) {
        files.push(file);
      }
    }

    return files;
  }

  private async persistBoxes(boxes: CardBoxDefinition[]): Promise<void> {
    const favorites = pruneFavoriteBoxes(
      this.plugin.getSettings().favorites ?? [],
      boxes.map((box) => box.id),
    );
    await this.plugin.saveSettings({ boxes, favorites });
  }

  private async updateActiveBox(
    mutate: (box: CardBoxDefinition) => CardBoxDefinition,
  ): Promise<void> {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();
    if (box === null) {
      return;
    }
    const nextBox = mutate(box);
    if (nextBox === box) {
      return;
    }
    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
  }

  private buildBoxPanelFields(): {
    activeBoxId: string | null;
    activeBoxName: string | null;
    boxSummaries: BoxSummary[];
    boxExcludedCount: number;
  } {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();
    return {
      activeBoxId: isBoxScope(this.cardScope) ? this.cardScope.boxId : null,
      activeBoxName: box ? box.name : null,
      boxSummaries: (settings.boxes ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        cardCount: this.countBoxCards(entry),
      })),
      boxExcludedCount: box ? box.excludedPaths.length : 0,
    };
  }

  /**
   * Every favorite row counts vault-wide, because activating one always leaves the
   * current scope. File rows are the exception: a note is always exactly one note.
   */
  private buildFavoriteRowModels(precomputed: {
    boxSummaries: BoxSummary[];
  }): FavoriteRowModel[] {
    const settings = this.plugin.getSettings();
    const favorites = settings.favorites ?? [];
    if (favorites.length === 0) {
      return [];
    }

    const showCounts = settings.showNavItemCounts;
    const hasTagFavorite = favorites.some((entry) => entry.kind === "tag");
    const boxSummaries = precomputed.boxSummaries;
    const activeBoxId = isBoxScope(this.cardScope) ? this.cardScope.boxId : null;
    const isBoxMode = isBoxScope(this.cardScope);
    const activeFolderPath = scopeDisplayPath(this.cardScope);
    const activeTags = new Set(settings.filter.tags.map((tag) => normalizeTagPath(tag)));

    return favorites.map((entry) => this.buildFavoriteRowModel(entry, {
      showCounts,
      // Only pay for the vault-wide tag walk when a row will actually show one.
      vaultTagCounts: showCounts && hasTagFavorite ? this.getVaultTagCounts() : {},
      includeSubfolders: settings.includeSubfolders,
      boxSummaries,
      activeBoxId,
      isBoxMode,
      activeFolderPath,
      activeTags,
    }));
  }

  /** Mirrors the folder section so the same folder never shows two different numbers. */
  private getFavoriteFolderCount(folderPath: string, includeSubfolders: boolean): number {
    const counts = this.folderTreeCountsByPath.get(normalizeScopePath(folderPath));
    if (!counts) {
      return 0;
    }
    return includeSubfolders ? counts.recursive : counts.direct;
  }

  private buildFavoriteRowModel(
    entry: FavoriteEntry,
    context: {
      showCounts: boolean;
      vaultTagCounts: Record<string, number>;
      includeSubfolders: boolean;
      boxSummaries: BoxSummary[];
      activeBoxId: string | null;
      isBoxMode: boolean;
      activeFolderPath: string;
      activeTags: Set<string>;
    },
  ): FavoriteRowModel {
    const { kind, ref } = entry;

    if (kind === "folder") {
      return {
        kind,
        ref,
        label: ref === "" ? this.strings.toolbar.folderMenu.rootFolder : ref.slice(ref.lastIndexOf("/") + 1),
        icon: ref === "" ? "house" : PLAIN_FOLDER_ICON,
        count: context.showCounts ? this.getFavoriteFolderCount(ref, context.includeSubfolders) : 0,
        selected: !context.isBoxMode && ref === context.activeFolderPath,
        missing: this.resolveFolderFromUiPath(ref) === null,
      };
    }

    if (kind === "file") {
      return {
        kind,
        ref,
        label: stripCardFileExtension(ref.slice(ref.lastIndexOf("/") + 1)),
        icon: getCardFileIcon(resolveCardFileKindFromPath(ref) ?? "markdown"),
        count: 0,
        selected: ref === this.selectedPath,
        missing: !(this.app.vault.getAbstractFileByPath(ref) instanceof TFile),
      };
    }

    if (kind === "tag") {
      // Never marked missing: activation browses the whole vault for this tag,
      // so the current folder's tag set says nothing about it. Tags that stop
      // existing vault-wide are pruned from favorites instead.
      return {
        kind,
        ref,
        label: ref,
        icon: "tag",
        count: context.vaultTagCounts[normalizeTagPath(ref)] ?? 0,
        selected: context.activeTags.has(ref),
        missing: false,
      };
    }

    const summary = context.boxSummaries.find((box) => box.id === ref) ?? null;
    return {
      kind,
      ref,
      label: summary?.name ?? ref,
      icon: "box",
      count: context.showCounts ? (summary?.cardCount ?? 0) : 0,
      selected: ref === context.activeBoxId,
      missing: summary === null,
    };
  }

  private getBrowseScope(): { folder: string; includeSubfolders: boolean; tags: string[] } {
    const settings = this.plugin.getSettings();
    return {
      folder: scopeDisplayPath(this.cardScope),
      includeSubfolders: isFolderScope(this.cardScope)
        ? this.cardScope.includeSubfolders
        : settings.includeSubfolders,
      tags: [...settings.filter.tags],
    };
  }

  private describeRule(rule: Rule): string {
    const strings = this.strings.box;
    let label = rule.folder === "" ? strings.ruleRootLabel : rule.folder;
    if (rule.includeSubfolders) {
      label += ` (${strings.ruleSubfolderSuffix})`;
    }
    if (rule.tags.length > 0) {
      label += strings.ruleTagsSeparator + rule.tags.map((tag) => `#${tag}`).join(", ");
    }
    return label;
  }

  handleBoxCommand(detail: { command?: unknown; boxId?: unknown }): void {
    const command = typeof detail.command === "string" ? detail.command : "";
    const boxId = typeof detail.boxId === "string" ? detail.boxId : null;

    switch (command) {
      case "switch":
        if (boxId) {
          void this.enterBoxScope(boxId);
        }
        return;
      case "exit":
        void this.exitBoxScope();
        return;
      case "create":
        this.openCreateBoxModal();
        return;
      case "rename":
        this.openRenameBoxModal(boxId ?? this.getScopeBox()?.id ?? null);
        return;
      case "duplicate":
        this.duplicateBoxById(boxId ?? this.getScopeBox()?.id ?? null);
        return;
      case "delete":
        this.openDeleteBoxConfirm(boxId ?? this.getScopeBox()?.id ?? null);
        return;
      case "save-scope-as-box":
        this.openSaveScopeAsBoxModal();
        return;
      case "add-scope-to-box":
        this.addScopeToBox(boxId);
        return;
      case "configure":
        this.openBoxConfig(boxId ?? this.getScopeBox()?.id ?? null);
        return;
      default:
        return;
    }
  }

  private openCreateBoxModal(): void {
    const strings = this.strings.box;
    new BoxNameModal(this.app, {
      strings: this.strings,
      title: strings.nameModalCreateTitle,
      initialName: "",
      submitLabel: strings.create,
      onSubmit: async (name) => {
        const settings = this.plugin.getSettings();
        const box = createCardBox(name, settings.boxes);
        await this.persistBoxes(upsertCardBox(settings.boxes, box));
        await this.enterBoxScope(box.id);
      },
    }).open();
  }

  private openRenameBoxModal(boxId: string | null): void {
    const settings = this.plugin.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    const strings = this.strings.box;
    new BoxNameModal(this.app, {
      strings: this.strings,
      title: strings.nameModalRenameTitle,
      initialName: box.name,
      submitLabel: strings.save,
      onSubmit: async (name) => {
        const current = this.plugin.getSettings();
        await this.persistBoxes(renameCardBox(current.boxes, box.id, name));
      },
    }).open();
  }

  private duplicateBoxById(boxId: string | null): void {
    if (boxId === null) {
      return;
    }
    const settings = this.plugin.getSettings();
    void this.persistBoxes(duplicateCardBox(settings.boxes, boxId));
  }

  private openDeleteBoxConfirm(boxId: string | null): void {
    const settings = this.plugin.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    const strings = this.strings.box;
    const modal = new Modal(this.app);
    modal.setTitle(strings.deleteConfirmTitle);
    modal.contentEl.createEl("p", { text: strings.deleteConfirmBody(box.name) });
    new Setting(modal.contentEl)
      .addButton((button) => {
        button.setButtonText(strings.cancel).onClick(() => {
          modal.close();
        });
      })
      .addButton((button) => {
        button
          .setWarning()
          .setButtonText(strings.deleteConfirm)
          .onClick(async () => {
            const current = this.plugin.getSettings();
            const nextBoxes = deleteCardBox(current.boxes, box.id);
            if (isBoxScope(this.cardScope) && this.cardScope.boxId === box.id) {
              await this.moveScopeToFolder(current.lastFolderPath);
            }
            await this.persistBoxes(nextBoxes);
            modal.close();
          });
      });
    modal.open();
  }

  private openSaveScopeAsBoxModal(): void {
    const strings = this.strings.box;
    const rule = translateBrowseScopeToRule(this.getBrowseScope());
    const hitCount = this.baseCards.length;
    new BoxNameModal(this.app, {
      strings: this.strings,
      title: strings.saveScopeTitle,
      initialName: this.deriveDefaultBoxNameFromScope(),
      submitLabel: strings.create,
      previewText: strings.hitCountPreview(hitCount),
      onSubmit: async (name) => {
        const settings = this.plugin.getSettings();
        const box = createCardBox(name, settings.boxes, { rules: [rule] });
        await this.persistBoxes(upsertCardBox(settings.boxes, box));
        await this.enterBoxScope(box.id);
      },
    }).open();
  }

  private deriveDefaultBoxNameFromScope(): string {
    const scope = this.getBrowseScope();
    if (scope.folder !== "") {
      const segments = scope.folder.split("/");
      return segments[segments.length - 1] ?? scope.folder;
    }
    if (scope.tags.length > 0) {
      return `#${scope.tags[0]}`;
    }
    return "";
  }

  private canAddScopeToBox(): boolean {
    return !isBoxScope(this.cardScope) && this.plugin.getSettings().boxes.length > 0;
  }

  private appendScopeTargetBoxItems(menu: Menu): void {
    for (const box of this.plugin.getSettings().boxes) {
      menu.addItem((item) => {
        item
          .setTitle(box.name)
          .setIcon("box")
          .onClick(() => {
            this.addScopeToBox(box.id);
          });
      });
    }
  }

  /** Flat target picker for entry points that cannot host a submenu. */
  private openAddScopeToBoxPicker(mouseEvent: unknown): void {
    if (!this.canAddScopeToBox() || !this.isMouseEventLike(mouseEvent)) {
      return;
    }

    const menu = new Menu();
    this.appendScopeTargetBoxItems(menu);
    menu.showAtMouseEvent(mouseEvent);
  }

  private appendAddScopeToBoxMenu(menu: Menu): void {
    if (!this.canAddScopeToBox()) {
      return;
    }

    menu.addItem((item) => {
      item.setTitle(this.strings.box.addScopeToBox).setIcon("package-check");
      const submenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      if (submenu && typeof submenu.addItem === "function") {
        this.appendScopeTargetBoxItems(submenu);
        return;
      }

      item.onClick((event) => {
        this.openAddScopeToBoxPicker(event);
      });
    });
  }

  private addScopeToBox(boxId: string | null): void {
    const settings = this.plugin.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    const rule = translateBrowseScopeToRule(this.getBrowseScope());
    void this.persistBoxes(upsertCardBox(settings.boxes, addRuleToBox(box, rule)));
  }

  private openBoxConfig(boxId: string | null): void {
    const settings = this.plugin.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }
    new BoxConfigModal(this.app, {
      box,
      strings: this.strings,
      describeRule: (rule) => this.describeRule(rule),
      isRuleFolderMissing: (rule) => this.resolveFolderFromUiPath(rule.folder) === null,
      describeMemberPath: (path) => stripCardFileExtension(path.slice(path.lastIndexOf("/") + 1)),
      onConfirm: async (nextBox) => {
        const current = this.plugin.getSettings();
        await this.persistBoxes(upsertCardBox(current.boxes, nextBox));
      },
    }).open();
  }

  /** Add one or more cards to a box (via context menu / bulk). */
  private async addPathsToBox(boxId: string, paths: string[]): Promise<void> {
    const settings = this.plugin.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null || paths.length === 0) {
      return;
    }
    const nextBox = addManualPaths(box, paths);
    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
    new Notice(this.strings.box.addedToBox(paths.length, box.name));
  }

  private openCreateBoxModalWithPaths(paths: string[]): void {
    const strings = this.strings.box;
    new BoxNameModal(this.app, {
      strings: this.strings,
      title: strings.nameModalCreateTitle,
      initialName: "",
      submitLabel: strings.create,
      onSubmit: async (name) => {
        const settings = this.plugin.getSettings();
        const box = createCardBox(name, settings.boxes, { manualPaths: paths });
        await this.persistBoxes(upsertCardBox(settings.boxes, box));
        new Notice(strings.addedToBox(paths.length, box.name));
      },
    }).open();
  }

  /** Remove a single card entirely from the active box (manual delete or exclude). */
  private async removeMemberFromActiveBox(path: string): Promise<void> {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();
    if (box === null) {
      return;
    }
    const nextBox = removeMemberFromBox(this.app, box, path);
    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
    new Notice(this.strings.box.removedFromBox(box.name));
  }

  private appendAddToBoxMenu(menu: Menu, paths: string[]): void {
    if (paths.length === 0) {
      return;
    }
    const strings = this.strings.box;
    const settings = this.plugin.getSettings();
    menu.addItem((item) => {
      item.setTitle(strings.addToBox).setIcon("box");
      const boxes = settings.boxes ?? [];
      const submenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      if (submenu && typeof submenu.addItem === "function") {
        for (const summary of boxes) {
          submenu.addItem((sub) => {
            sub.setTitle(summary.name).setIcon("box").onClick(() => {
              void this.addPathsToBox(summary.id, paths);
            });
          });
        }
        if (boxes.length > 0) {
          submenu.addSeparator();
        }
        submenu.addItem((sub) => {
          sub.setTitle(strings.addToNewBox).setIcon("plus").onClick(() => {
            this.openCreateBoxModalWithPaths(paths);
          });
        });
        return;
      }

      // Fallback when submenus are unavailable: create a new box directly.
      item.onClick(() => {
        this.openCreateBoxModalWithPaths(paths);
      });
    });
  }

  async onOpen(): Promise<void> {
    const FolderCardPanel = (await import("./FolderCardPanel.svelte")).default;
    this.initializeSearchSnapshotState();
    this.publishGroups(...PANEL_GROUPS);

    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = mount(FolderCardPanel, {
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
          void this.selectFolderFromNav(detail.path);
        },
        onFolderAction: (detail: FolderActionPayload) => {
          this.handleFolderActionRequest(detail);
        },
        onBoxCommand: (detail: { command?: unknown; boxId?: unknown }) => {
          this.handleBoxCommand(detail);
        },
        onNavContextMenu: (detail: NavContextMenuPayload) => {
          this.openNavContextMenu(detail);
        },
        onFavoriteActivate: (detail: { favorite?: unknown }) => {
          this.handleFavoriteActivate(detail);
        },
        onNavPaneResize: (width: number) => {
          void this.onNavPaneResize(width);
        },
        onShellResize: (width: number) => {
          this.onShellResize(width);
        },
        onToggleNavPane: () => {
          void this.onToggleNavPane();
        },
        onToggleNavSection: (section: unknown) => {
          void this.onToggleNavSection(section);
        },
      },
    });

    this.refreshFolderTreeState();
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

    if (action === "new-note") {
      void this.plugin.createNoteInCurrentFolder().catch((error: unknown) => {
        new Notice(this.getFolderManagementStrings().createFileFailed(String(error)));
      });
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

    if (action === "bulk-add-tag-selected") {
      this.bulkAddTagSelected();
      return;
    }

    if (action === "bulk-remove-tag-selected") {
      this.bulkRemoveTagSelected();
      return;
    }

    if (action === "bulk-delete-selected") {
      void this.bulkDeleteSelected();
      return;
    }

    if (action === "bulk-merge-selected") {
      this.bulkMergeSelected();
      return;
    }

    if (action === "bulk-add-to-box") {
      this.bulkAddToBox();
      return;
    }

    if (action === "bulk-remove-from-box") {
      void this.bulkRemoveFromBox();
    }
  }

  private bulkAddToBox(): void {
    const selectedPaths = this.getOrderedVisiblePaths().filter((path) =>
      this.selectedPaths.has(path),
    );
    if (selectedPaths.length === 0) {
      return;
    }

    const settings = this.plugin.getSettings();
    if (settings.boxes.length === 0) {
      this.openCreateBoxModalWithPaths(selectedPaths);
      return;
    }

    const strings = this.strings.box;
    const modal = new Modal(this.app);
    modal.setTitle(strings.bulkAddToBoxTitle);
    for (const box of settings.boxes) {
      new Setting(modal.contentEl).setName(box.name).addButton((button) => {
        button.setButtonText(strings.addToBox).onClick(() => {
          void this.addPathsToBox(box.id, selectedPaths);
          modal.close();
        });
      });
    }
    new Setting(modal.contentEl).addButton((button) => {
      button
        .setCta()
        .setButtonText(strings.addToNewBox)
        .onClick(() => {
          modal.close();
          this.openCreateBoxModalWithPaths(selectedPaths);
        });
    });
    modal.open();
  }

  private async bulkRemoveFromBox(): Promise<void> {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();
    if (box === null) {
      return;
    }

    const selectedPaths = this.getOrderedVisiblePaths().filter((path) =>
      this.selectedPaths.has(path),
    );
    if (selectedPaths.length === 0) {
      return;
    }

    let nextBox = box;
    for (const path of selectedPaths) {
      nextBox = removeMemberFromBox(this.app, nextBox, path);
    }
    if (nextBox === box) {
      return;
    }

    await this.persistBoxes(upsertCardBox(settings.boxes, nextBox));
    new Notice(this.strings.box.removedFromBoxCount(selectedPaths.length, box.name));
  }

  private handleFolderActionRequest(detail: FolderActionPayload): void {
    if (typeof detail.path !== "string") {
      return;
    }

    if (detail.action === "create-child-folder") {
      void this.createFromFolderTree(detail.path, "folder");
    }
  }

  async setFolder(folder: TFolder): Promise<SelectionResult> {
    const scope = createFolderScope(folder.path, this.plugin.getSettings().includeSubfolders);
    return this.handleScopeSelection(this.createProgrammaticSelectionRequest(scope, false));
  }

  async handleScopeSelection(request: FolderSelectionRequest): Promise<SelectionResult> {
    if (!validateScope(this.app, request.scope, this.plugin.getSettings().boxes ?? [])) {
      return {
        action: "rejected_invalid",
        scope: request.scope,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const forceRefresh = request.forceRefresh ?? false;
    const nextLoadScope = this.buildLoadKey(request.scope);
    const loadKey = this.serializeLoadKey(nextLoadScope);
    const clearedBulkSelection = this.reconcileBulkSelectionBeforeLoad(nextLoadScope);

    if (this.inFlight) {
      if (clearedBulkSelection) {
        this.publishGroups("cards", "bulk");
      }
      if (!forceRefresh && this.inFlightKey === loadKey) {
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

    if (!forceRefresh && this.folderLoadKey === loadKey) {
      return {
        action: "noop",
        scope: request.scope,
        generationChanged: false,
        preserveUiState: true,
      };
    }

    const scopeBeforeRequest = this.cardScope;
    const committed = await this.runLoad(nextLoadScope, loadKey);
    await this.drainQueuedRequest();
    // Only a real committed migration claims the global persistence projection.
    if (committed && !scopesEqual(scopeBeforeRequest, this.cardScope)) {
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

    const selectionRequest = this.createProgrammaticSelectionRequest(
      isFolderScope(this.cardScope)
        ? createFolderScope(this.cardScope.path, this.plugin.getSettings().includeSubfolders)
        : this.cardScope,
      request.forceRefresh ?? true,
    );

    const selectionResult = await this.handleScopeSelection(selectionRequest);
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

  /**
   * Applies the weakest update that still reflects a change. Only `"reload"`
   * re-collects files; the weaker tiers keep scroll position and loaded previews.
   */
  async applyUpdateIntent(intent: ViewUpdateIntent, reason: RefreshReason): Promise<void> {
    switch (intent) {
      case "reload":
        await this.refresh({ reason, forceRefresh: true });
        return;
      case "rehydrate":
        for (const card of this.baseCards) {
          card.hydrated = false;
          card.previewHtml = "";
          card.previewMode = "empty";
        }
        this.pendingHydration.clear();
        this.reprojectCards();
        this.publishForIntent(intent);
        this.hydrateVisibleCardsOnOpen();
        return;
      case "reproject":
        this.reprojectCards();
        this.publishForIntent(intent);
        return;
      case "patch":
        this.publishForIntent(intent);
        return;
    }
  }

  /** Re-sorts the loaded cards in place and republishes; never re-collects files. */
  private reprojectCards(): void {
    const projection = this.buildProjectionGroup();
    this.baseCards.sort((left, right) =>
      this.compareCards(left, right, projection.sortField, projection.sortDirection),
    );
    this.folderLoadKey = this.serializeLoadKey(this.buildLoadKey(this.cardScope));
    this.projectVisibleCards();
  }

  handleVaultMutation(event: VaultMutationEvent): VaultMutationResult {
    this.vaultContentEpoch.bump();
    this.scheduleNavCountRefresh();
    if (event.isFolder) {
      this.refreshFolderTreeState();
    } else if (event.eventType !== "modify") {
      this.scheduleFolderTreeRefresh();
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
      const incrementalResult = this.applyIncrementalMutation(event);
      if (incrementalResult.handled) {
        this.projectVisibleCards();
        this.publishGroups("cards", "projection", "bulk", "scope");
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

  private applyScopeRename(event: VaultMutationEvent): string | null {
    if (
      event.eventType !== "rename" ||
      !event.isFolder ||
      !event.oldPath ||
      !isFolderScope(this.cardScope)
    ) {
      return null;
    }

    const renamedPath = rewritePathAfterRename(this.cardScope.path, event.oldPath, event.path);
    if (renamedPath === this.cardScope.path) {
      return null;
    }

    this.cardScope = createFolderScope(renamedPath, this.cardScope.includeSubfolders);
    this.folderLoadKey = this.serializeLoadKey(this.buildLoadKey(this.cardScope));
    return renamedPath;
  }

  /** Re-push nav-derived state after the plugin reconciled boxes/favorites outside the view. */
  refreshNavState(): void {
    this.invalidateNavCounts();
    this.publishGroups("nav", "scope");
  }

  /** Card box counts and vault-wide tag counts both walk the vault, so they expire together. */
  private invalidateNavCounts(): void {
    this.boxCardCountCache.clear();
    this.navCountEpoch.bump();
  }

  /**
   * Nav counts feed badges and tooltips only, so a burst of vault events can
   * coalesce into one recount instead of one per event.
   */
  private scheduleNavCountRefresh(): void {
    const view = this.getViewWindow();
    if (this.navCountRefreshHandle !== null) {
      view.clearTimeout(this.navCountRefreshHandle);
    }
    this.navCountRefreshHandle = view.setTimeout(() => {
      this.navCountRefreshHandle = null;
      this.invalidateNavCounts();
      this.publishGroups("nav");
    }, FolderCardView.NAV_COUNT_REFRESH_DEBOUNCE_MS);
  }

  private clearNavCountRefreshDebounce(): void {
    if (this.navCountRefreshHandle === null) {
      return;
    }
    this.getViewWindow().clearTimeout(this.navCountRefreshHandle);
    this.navCountRefreshHandle = null;
  }

  cleanupLifecycle(): CleanupResult {
    const hadQueuedRequest = this.queuedRequest !== null || this.refreshQueued;
    const hadPendingHydration = this.pendingHydration.size > 0;
    const cancelledDebounce = this.clearSearchDebounce();

    this.clearFolderTreeDebounce();
    this.clearNavCountRefreshDebounce();
    this.clearSearchSnapshotSubscription();
    this.searchSnapshot = null;
    this.queuedRequest = null;
    this.refreshQueued = false;
    this.pendingHydration.clear();
    this.inFlight = null;
    this.inFlightKey = null;
    this.inFlightLoadScope = null;
    this.loading = false;
    this.selectedPaths = new Set<string>();
    this.bulkAnchorPath = null;
    this.searchQuery = "";
    this.searchExecution = "indexed-unavailable";
    this.searchOrderedPaths = undefined;
    this.clearSearchMatchCounts();
    this.searchStatus = "idle";
    this.searchRequestEpoch.bump();
    this.searchSnapshotEpoch.bump();
    this.loadEpoch.bump();

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
    this.publishGroups("cards", "bulk");
  }

  getCurrentFolderPath(): string | null {
    return isFolderScope(this.cardScope) ? this.cardScope.path : null;
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
    this.searchSnapshotEpoch.bump();
    this.searchRequestEpoch.bump();
    this.clearSearchMatchCounts();

    if (this.searchQuery.trim().length === 0) {
      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.searchStatus = this.deriveSearchStatus();
      if (pushState) {
        this.projectVisibleCards();
        this.publishGroups("search", "cards", "bulk", "scope");
      }
      return;
    }

    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.searchStatus = this.deriveSearchStatus();

    if (pushState) {
      this.projectVisibleCards();
      this.publishGroups("search", "cards", "bulk", "scope");
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

    const menuDom = getMenuDom(menu);
    if (menuDom) {
      this.decorateCardContextMenu(menuDom, this.strings.view.contextMenu.delete);
    }
  }

  private decorateCardContextMenu(menuDom: MenuDomLike, deleteLabel: string | null): void {
    menuDom.classList.add("fce-card-context-menu");
    if (deleteLabel !== null) {
      this.markMenuItemAsDanger(menuDom, deleteLabel);
    }
  }

  private markMenuItemAsDanger(menuDom: MenuDomLike, label: string): void {
    if (typeof menuDom.querySelectorAll !== "function") {
      return;
    }

    for (const item of menuDom.querySelectorAll(".menu-item")) {
      const titleElement = item.querySelector(".menu-item-title");
      if (titleElement?.textContent?.trim() !== label) {
        continue;
      }

      item.classList.add("fce-menu-item-danger");
    }
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

  private appendCardFavoriteMenuItem(menu: Menu, notePath: string): void {
    const navMenu = this.strings.view.navMenu;
    const favorited = isFavorite(this.plugin.getSettings().favorites ?? [], "file", notePath);
    menu.addItem((item) => {
      item
        .setTitle(favorited ? navMenu.unfavorite : navMenu.favorite)
        .setIcon(favorited ? "star-off" : "star")
        .onClick(() => {
          void this.toggleFavoriteEntry("file", notePath);
        });
    });
  }

  private addCardContextMenuItems(menu: Menu, notePath: string): void {
    const strings = this.strings.view.contextMenu;
    const liveMarkdownFile = this.resolveLiveMarkdownFile(notePath);
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

    menu.addSeparator();
    this.appendAddToBoxMenu(menu, [notePath]);
    this.appendCardFavoriteMenuItem(menu, notePath);
    if (isBoxScope(this.cardScope)) {
      menu.addItem((item) => {
        item
          .setTitle(this.strings.box.removeFromBox)
          .setIcon("gallery-thumbnails")
          .onClick(() => {
            void this.removeMemberFromActiveBox(notePath);
          });
      });
    }

    if (liveMarkdownFile) {
      menu.addItem((item) => {
        item
          .setTitle(strings.copyTitle)
          .setIcon("clipboard")
          .onClick(() => {
            void this.routeCardMenuAction("copy-title", notePath);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(strings.copyContent)
          .setIcon("clipboard-list")
          .onClick(() => {
            void this.routeCardMenuAction("copy-content", notePath);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(strings.copyTitleAndContent)
          .setIcon("clipboard-plus")
          .onClick(() => {
            void this.routeCardMenuAction("copy-title-and-content", notePath);
          });
      });
    }

    if (liveMarkdownFile) {
      menu.addSeparator();

      menu.addItem((item) => {
        item
          .setTitle(strings.addTag)
          .setIcon(TAG_ADD_ICON)
          .onClick(() => {
            void this.routeCardMenuAction("add-tag", notePath);
          });
      });

      menu.addItem((item) => {
        item
          .setTitle(strings.removeTag)
          .setIcon(TAG_REMOVE_ICON)
          .onClick(() => {
            void this.routeCardMenuAction("remove-tag", notePath);
          });
      });
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

  private openNavContextMenu(payload: NavContextMenuPayload): void {
    if (!this.isMouseEventLike(payload.mouseEvent)) {
      return;
    }

    const deps = this.buildNavMenuDeps();
    const menu = new Menu();
    if (!buildNavContextMenu(menu, payload, deps)) {
      return;
    }

    menu.showAtMouseEvent(payload.mouseEvent);

    const menuDom = getMenuDom(menu);
    if (menuDom) {
      this.decorateCardContextMenu(menuDom, resolveNavMenuDangerLabel(payload, deps));
    }
  }

  private buildNavMenuDeps(): NavMenuDeps {
    const settings = this.plugin.getSettings();
    return {
      strings: this.strings,
      isBoxMode: isBoxScope(this.cardScope),
      includeSubfolders: settings.includeSubfolders,
      activeFilterTags: settings.filter.tags,
      canResolveSystemPath: canResolveSystemPath(this.app),
      favorites: settings.favorites ?? [],
      boxes: settings.boxes ?? [],
      activeBoxId: isBoxScope(this.cardScope) ? this.cardScope.boxId : null,
      boxExcludedCount: (boxId) => this.getBoxExcludedCount(boxId),
      sectionCollapsed: {
        favorites: settings.favoritesSectionCollapsed,
        folders: settings.folderSectionCollapsed,
        tags: settings.tagSectionCollapsed,
        boxes: settings.boxSectionCollapsed,
      },
      actions: {
        createNote: (folderUiPath) => {
          void this.createFromFolderTree(folderUiPath, "note");
        },
        createFolder: (folderUiPath) => {
          void this.createFromFolderTree(folderUiPath, "folder");
        },
        createCanvas: (folderUiPath) => {
          void this.createFromFolderTree(folderUiPath, "canvas");
        },
        createBase: (folderUiPath) => {
          void this.createFromFolderTree(folderUiPath, "base");
        },
        duplicateFolder: (folderUiPath) => {
          void this.duplicateFolder(folderUiPath);
        },
        moveFolder: (folderUiPath) => {
          this.openMoveFolderPickerForFolder(folderUiPath);
        },
        renameFolder: (folderUiPath) => {
          this.openRenameFolderModal(folderUiPath);
        },
        deleteFolder: (folderUiPath) => {
          void this.deleteFolder(folderUiPath);
        },
        findInFolder: (folderUiPath) => {
          void this.findInFolder(folderUiPath);
        },
        copyPath: (ref, mode) => {
          void this.copyFavoritePath(ref, mode);
        },
        revealInSystemExplorer: (ref) => {
          void this.revealInSystemExplorer(ref);
        },
        toggleIncludeSubfolders: () => {
          void this.onIncludeSubfoldersChange({ value: !settings.includeSubfolders });
        },
        toggleSection: (section) => {
          void this.onToggleNavSection(section);
        },
        addTagToFilter: (tag) => {
          void this.addTagToFilter(tag);
        },
        removeTagFromFilter: (tag) => {
          void this.removeTagFromFilter(tag);
        },
        filterByOnlyTag: (tag) => {
          void this.filterByOnlyTag(tag);
        },
        clearTagFilter: () => {
          void this.clearTagFilter();
        },
        createNoteWithTag: (tag) => {
          void this.createNoteWithTag(tag);
        },
        copyTag: (tag) => {
          void this.copyTag(tag);
        },
        boxCommand: (command, boxId) => {
          this.handleBoxCommand({ command, boxId });
        },
        appendAddScopeSubmenu: (menu) => {
          this.appendAddScopeToBoxMenu(menu);
        },
        restoreBoxExcluded: (boxId) => {
          void this.restoreBoxExcluded(boxId);
        },
        toggleFavorite: (kind, ref) => {
          void this.toggleFavoriteEntry(kind, ref);
        },
        moveFavorite: (kind, ref, delta) => {
          void this.moveFavoriteEntry(kind, ref, delta);
        },
        clearFavorites: () => {
          void this.clearFavorites();
        },
        cardMenu: (menu, notePath) => {
          this.addCardContextMenuItems(menu, notePath);
        },
      },
    };
  }

  private async routeCardMenuAction(action: CardMenuAction, notePath: string): Promise<void> {
    if (action === "copy-title") {
      await this.copyCardTitle(notePath);
      return;
    }

    if (action === "copy-content") {
      await this.copyCardContent(notePath);
      return;
    }

    if (action === "copy-title-and-content") {
      await this.copyCardTitleAndContent(notePath);
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

    if (action === "add-tag") {
      this.openSingleTagModal(notePath, "add");
      return;
    }

    if (action === "remove-tag") {
      this.openSingleTagModal(notePath, "remove");
      return;
    }

    if (action === "delete") {
      await this.deleteCardFile(notePath);
      return;
    }

    this.openCardWithDestination(notePath, action);
  }

  private async copyCardTitle(notePath: string): Promise<void> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    await copyTitleToClipboard(this.app, file, this.strings.noteOps);
  }

  private async copyCardContent(notePath: string): Promise<void> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    await copyContentToClipboard(this.app, file, this.strings.noteOps);
  }

  private async copyCardTitleAndContent(notePath: string): Promise<void> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    await copyTitleAndContentToClipboard(this.app, file, this.strings.noteOps);
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
        return true;
      },
    );
    modal.open();
  }

  private resolveLiveMarkdownFile(notePath: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!(file instanceof TFile)) {
      return null;
    }

    const fileKind = resolveCardFileKind(file);
    if (fileKind === null || !isMarkdownCardKind(fileKind)) {
      return null;
    }

    return file;
  }

  private openSingleTagModal(notePath: string, mode: TagMutationMode): void {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return;
    }

    if (mode === "add") {
      const modal = new TagInputModal(
        this.app,
        { mode, strings: this.strings.view.tagInput },
        async (tag) => this.submitSingleTagAction(notePath, mode, tag),
      );
      modal.open();
      return;
    }

    const tagOptions = this.buildBulkRemovableTagOptions([file]);
    if (tagOptions.length === 0) {
      new Notice(this.strings.view.singleRemoveTag.noRemovableTags);
      return;
    }

    const modal = new BulkRemoveTagsModal(
      this.app,
      {
        titleText: this.strings.view.bulkRemoveTag.modalTitle,
        emptyMessage: this.strings.view.singleRemoveTag.noRemovableTags,
        selectionSummary: (count) => this.strings.view.bulkRemoveTag.selectedTagCount(count),
        cancelText: this.strings.view.tagInput.cancel,
        submitText: this.strings.view.bulkRemoveTag.removeSelectedTags,
        submittingText: this.strings.view.bulkRemoveTag.removingSelectedTags,
        tagOptions,
      },
      async (tags) => this.executeSingleRemoveTags(notePath, tags),
    );
    modal.open();
  }
  private async submitSingleTagAction(notePath: string, mode: TagMutationMode, tag: string): Promise<boolean> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return true;
    }

    const result = mode === "add"
      ? await addTagToFile(this.app, file, tag)
      : await removeTagFromFile(this.app, file, tag);
    if (!result.ok) {
      const message = mode === "add"
        ? this.strings.view.singleTagActions.failedToAdd(result.error)
        : this.strings.view.singleTagActions.failedToRemove(result.error);
      new Notice(message);
      return false;
    }

    if (mode === "remove" && "changed" in result && !result.changed) {
      new Notice(this.strings.view.singleTagActions.absent(tag, file.basename));
      return false;
    }

    if (mode === "remove" && "changed" in result && result.changed) {
      await this.clearStaleTagFilterIfNeeded([tag]);
    }

    const message = mode === "add"
      ? this.strings.view.singleTagActions.added(tag, file.basename)
      : this.strings.view.singleTagActions.removed(tag, file.basename);
    new Notice(message);
    return true;
  }

  private async executeSingleRemoveTags(notePath: string, tags: string[]): Promise<boolean> {
    const file = this.resolveLiveMarkdownFile(notePath);
    if (!file) {
      return true;
    }

    const collapsedTags = this.collapseBulkRemovableTags(tags);
    if (collapsedTags.length === 0) {
      new Notice(this.strings.view.singleRemoveTag.noRemovableTags);
      return false;
    }

    if (collapsedTags.length === 1) {
      return this.submitSingleTagAction(notePath, "remove", collapsedTags[0]);
    }

    const summary = await batchRemoveTagsFromFiles(this.app, [file], collapsedTags);
    if (summary.changed.length > 0) {
      await this.clearStaleTagFilterIfNeeded(collapsedTags);
    }

    const strings = this.strings.view.bulkRemoveTag;
    if (summary.failed.length === 0 && summary.noop.length === 0) {
      new Notice(strings.removed(summary.changed.length, collapsedTags.length));
      return true;
    }

    if (summary.changed.length === 0 && summary.failed.length === 0) {
      new Notice(strings.noop(summary.noop.length, collapsedTags.length));
      return false;
    }

    new Notice(strings.failed(summary.failed.length, collapsedTags.length));
    return false;
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
    const scopePath = normalizeScopePath(parentPath);
    if (scopePath.length === 0) {
      return fileName;
    }

    return `${scopePath}/${fileName}`;
  }

  private getFolderManagementStrings(): UiStrings["view"]["folderManagement"] {
    return this.strings.view.folderManagement;
  }

  private refreshFolderTreeState(): void {
    this.folderTree = this.buildFolderTree();
    this.cacheFolderTreeCounts(this.folderTree);
    this.publishGroups("nav");
  }

  /**
   * The tree walk already counts every folder, so favorites can reuse those
   * numbers instead of paying for a second vault walk.
   */
  private cacheFolderTreeCounts(tree: FolderTreeNode[]): void {
    this.folderTreeCountsByPath.clear();
    const visit = (node: FolderTreeNode): void => {
      this.folderTreeCountsByPath.set(normalizeScopePath(node.path), {
        direct: node.directCount,
        recursive: node.recursiveCount,
      });
      for (const child of node.children) {
        visit(child);
      }
    };
    for (const node of tree) {
      visit(node);
    }
  }

  private resolveFolderFromUiPath(folderPath: string): TFolder | null {
    const normalizedPath = normalizeScopePath(folderPath);
    const folder = normalizedPath === ""
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(normalizedPath);
    return folder instanceof TFolder ? folder : null;
  }

  private openCreateChildFolderModal(parentFolderPath: string): void {
    const parentFolder = this.resolveFolderFromUiPath(parentFolderPath);
    if (!(parentFolder instanceof TFolder)) {
      new Notice(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    const strings = this.getFolderManagementStrings();
    const modal = new CreateFolderModal(
      this.app,
      strings,
      {
        title: strings.createChildTitle,
        submitLabel: strings.create,
        submittingLabel: strings.creating,
      },
      async (nextName: string) => {
        return this.createChildFolder(parentFolderPath, nextName);
      },
    );
    modal.open();
  }

  private async createChildFolder(parentFolderPath: string, nextName: string): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      new Notice(strings.emptyName);
      return false;
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      new Notice(strings.invalidName);
      return false;
    }

    const parentFolder = this.resolveFolderFromUiPath(parentFolderPath);
    if (!(parentFolder instanceof TFolder)) {
      new Notice(strings.folderNotFound);
      return false;
    }

    try {
      await this.app.vault.createFolder(this.buildSiblingPath(parentFolder.path, trimmedName));
      this.refreshFolderTreeState();
      return true;
    } catch (error) {
      new Notice(strings.createFailed(String(error)));
      return false;
    }
  }

  private openMoveFolderPickerForFolder(folderPath: string): void {
    const folder = this.resolveFolderFromUiPath(folderPath);
    if (!(folder instanceof TFolder)) {
      new Notice(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    const modal = new FolderPickerModal(this.app, (targetFolder: TFolder) => {
      void this.onFolderMoveTargetChosen(folderPath, targetFolder);
    }, this.strings.folderPicker.selectFolderTitle);
    modal.open();
  }

  private async onFolderMoveTargetChosen(folderPath: string, targetFolder: TFolder | null): Promise<void> {
    const strings = this.getFolderManagementStrings();
    if (!(targetFolder instanceof TFolder)) {
      return;
    }

    const folder = this.resolveFolderFromUiPath(folderPath);
    if (!(folder instanceof TFolder)) {
      new Notice(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    if ((folder.parent?.path ?? "") === targetFolder.path) {
      new Notice(strings.sameTarget);
      return;
    }

    if (targetFolder.path === folder.path || targetFolder.path.startsWith(`${folder.path}/`)) {
      new Notice(strings.invalidMoveTarget);
      return;
    }

    await this.renameFolderTo(folder, this.buildSiblingPath(targetFolder.path, folder.name));
  }

  /** Shared move/rename primitive: both entry points get the same scope repair. */
  private async renameFolderTo(
    folder: TFolder,
    nextPath: string,
    failureMessage?: (reason: string) => string,
  ): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    const previousPath = folder.path;
    try {
      await this.app.fileManager.renameFile(folder, nextPath);
      this.refreshFolderTreeState();
      await this.refreshFolderScopeAfterFolderRename(previousPath, nextPath);
      return true;
    } catch (error) {
      new Notice((failureMessage ?? strings.moveFailed)(String(error)));
      return false;
    }
  }

  private openRenameFolderModal(folderUiPath: string): void {
    const strings = this.getFolderManagementStrings();
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      new Notice(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    const modal = new CreateFolderModal(
      this.app,
      strings,
      {
        title: strings.renameTitle,
        submitLabel: strings.rename,
        submittingLabel: strings.renaming,
        initialName: folder.name,
      },
      async (nextName: string) => {
        return this.renameFolder(folderUiPath, nextName);
      },
    );
    modal.open();
  }

  private async renameFolder(folderUiPath: string, nextName: string): Promise<boolean> {
    const strings = this.getFolderManagementStrings();
    const trimmedName = nextName.trim();
    if (trimmedName.length === 0) {
      new Notice(strings.emptyName);
      return false;
    }

    if (trimmedName.includes("/") || trimmedName.includes("\\")) {
      new Notice(strings.invalidName);
      return false;
    }

    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      new Notice(strings.folderNotFound);
      return false;
    }

    if (trimmedName === folder.name) {
      new Notice(strings.unchangedName);
      return false;
    }

    return this.renameFolderTo(
      folder,
      this.buildSiblingPath(folder.parent?.path ?? "", trimmedName),
      strings.renameFailed,
    );
  }

  private countFilesInFolder(folder: TFolder): number {
    let total = 0;
    for (const child of folder.children) {
      if (child instanceof TFolder) {
        total += this.countFilesInFolder(child);
        continue;
      }
      total += 1;
    }
    return total;
  }

  private async duplicateFolder(folderUiPath: string): Promise<void> {
    const strings = this.getFolderManagementStrings();
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      new Notice(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    const fileCount = this.countFilesInFolder(folder);
    if (fileCount > FolderCardView.FOLDER_DUPLICATE_CONFIRM_THRESHOLD) {
      const confirmed = await this.requestDestructiveConfirmation({
        title: strings.duplicateConfirmTitle,
        message: strings.duplicateConfirmBody(fileCount),
        confirmButtonText: strings.duplicateConfirm,
      });
      if (!confirmed) {
        return;
      }
    }

    const targetPath = resolveUniquePath(this.app, `${folder.name} copy`, folder.parent?.path ?? "");
    try {
      await this.app.vault.copy(folder, targetPath);
      this.refreshFolderTreeState();
    } catch (error) {
      new Notice(strings.duplicateFailed(String(error)));
    }
  }

  private async findInFolder(folderUiPath: string): Promise<void> {
    await this.selectFolderFromNav(folderUiPath);
    this.resetSearchQuery();
    this.searchFocusToken += 1;
    this.publishGroups("search");
  }

  /** Folder-tree create actions always land in browse mode on the target folder, never inside an open card box. */
  private async createFromFolderTree(
    folderUiPath: string,
    kind: "note" | "folder" | "canvas" | "base",
  ): Promise<void> {
    if (isBoxScope(this.cardScope)) {
      await this.selectFolderFromNav(folderUiPath);
    }

    if (kind === "note") {
      await this.createNoteIn(folderUiPath);
      return;
    }
    if (kind === "canvas") {
      await this.createCanvasIn(folderUiPath);
      return;
    }
    if (kind === "base") {
      await this.createBaseIn(folderUiPath);
      return;
    }
    this.openCreateChildFolderModal(folderUiPath);
  }

  private async createNoteIn(folderUiPath: string, tags: string[] = []): Promise<void> {
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      new Notice(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    try {
      await this.plugin.createNoteInFolder(folder.path, tags);
    } catch (error) {
      new Notice(this.getFolderManagementStrings().createFileFailed(String(error)));
    }
  }

  private async createCanvasIn(folderUiPath: string): Promise<void> {
    await this.createSupportedFileIn(folderUiPath, "canvas", NEW_CANVAS_CONTENT);
  }

  private async createBaseIn(folderUiPath: string): Promise<void> {
    await this.createSupportedFileIn(folderUiPath, "base", NEW_BASE_CONTENT);
  }

  private async createSupportedFileIn(
    folderUiPath: string,
    extension: "canvas" | "base",
    content: string,
  ): Promise<void> {
    const folder = this.resolveFolderFromUiPath(folderUiPath);
    if (!(folder instanceof TFolder)) {
      new Notice(this.getFolderManagementStrings().folderNotFound);
      return;
    }

    const fileName = `${this.strings.app.untitledNoteBaseName}.${extension}`;
    const targetPath = resolveUniquePath(this.app, fileName, folder.path);
    try {
      const created = await this.app.vault.create(targetPath, content);
      await this.plugin.openNoteFromCard(created.path, "new-tab");
    } catch (error) {
      new Notice(this.getFolderManagementStrings().createFileFailed(String(error)));
    }
  }

  private async copyFavoritePath(ref: string, mode: "vault" | "system"): Promise<void> {
    if (mode === "vault") {
      await copyPathToClipboard(ref === "" ? "/" : ref, this.strings.noteOps);
      return;
    }

    const systemPath = getSystemPath(this.app, ref);
    if (systemPath === null) {
      new Notice(this.strings.desktopShell.unavailable);
      return;
    }

    await copyPathToClipboard(systemPath, this.strings.noteOps);
  }

  private async revealInSystemExplorer(ref: string): Promise<void> {
    const result = await showInSystemExplorer(this.app, ref, this.strings.desktopShell);
    if (!result.ok) {
      new Notice(result.error);
    }
  }

  private async applyTagFilter(nextTags: string[]): Promise<void> {
    await this.plugin.saveSettings({ filter: { tags: nextTags } });
  }

  private async addTagToFilter(tag: string): Promise<void> {
    const current = this.plugin.getSettings().filter.tags;
    if (current.some((existing) => normalizeTagPath(existing) === tag)) {
      return;
    }
    await this.applyTagFilter([...current, tag]);
  }

  private async removeTagFromFilter(tag: string): Promise<void> {
    const current = this.plugin.getSettings().filter.tags;
    const nextTags = current.filter((existing) => normalizeTagPath(existing) !== tag);
    if (nextTags.length === current.length) {
      return;
    }
    await this.applyTagFilter(nextTags);
  }

  private async filterByOnlyTag(tag: string): Promise<void> {
    await this.applyTagFilter([tag]);
  }

  private async clearTagFilter(): Promise<void> {
    if (this.plugin.getSettings().filter.tags.length === 0) {
      return;
    }
    await this.applyTagFilter([]);
  }

  private async copyTag(tag: string): Promise<void> {
    await copyPathToClipboard(`#${tag}`, this.strings.noteOps);
  }

  private async createNoteWithTag(tag: string): Promise<void> {
    await this.createNoteIn(this.getDisplayFolderPath(), [tag]);
  }

  private getBoxExcludedCount(boxId: string): number {
    return findCardBox(this.plugin.getSettings().boxes, boxId)?.excludedPaths.length ?? 0;
  }

  private async restoreBoxExcluded(boxId: string): Promise<void> {
    const settings = this.plugin.getSettings();
    const box = findCardBox(settings.boxes, boxId);
    if (box === null) {
      return;
    }

    await this.persistBoxes(upsertCardBox(settings.boxes, restoreExcludedPaths(box)));
  }

  // ---------------------------------------------------------------------------
  // Favorites
  // ---------------------------------------------------------------------------

  private async persistFavorites(favorites: FavoriteEntry[]): Promise<void> {
    await this.plugin.saveSettings({ favorites });
  }

  private async toggleFavoriteEntry(kind: FavoriteKind, ref: string): Promise<void> {
    const favorites = this.plugin.getSettings().favorites ?? [];
    const next = toggleFavorite(favorites, kind, ref);
    if (next === favorites) {
      return;
    }
    await this.persistFavorites(next);
  }

  private async moveFavoriteEntry(kind: FavoriteKind, ref: string, delta: -1 | 1): Promise<void> {
    const favorites = this.plugin.getSettings().favorites ?? [];
    const next = moveFavorite(favorites, kind, ref, delta);
    if (next === favorites) {
      return;
    }
    await this.persistFavorites(next);
  }

  private async clearFavorites(): Promise<void> {
    const favorites = this.plugin.getSettings().favorites ?? [];
    if (favorites.length === 0) {
      return;
    }

    const strings = this.strings.view.navMenu;
    const confirmed = await this.requestDestructiveConfirmation({
      title: strings.clearFavoritesConfirmTitle,
      message: strings.clearFavoritesConfirmBody(favorites.length),
      confirmButtonText: strings.clearFavoritesConfirm,
    });
    if (!confirmed) {
      return;
    }

    await this.persistFavorites([]);
  }

  private handleFavoriteActivate(detail: { favorite?: unknown }): void {
    const favorite = detail.favorite;
    if (typeof favorite !== "object" || favorite === null) {
      return;
    }

    const { kind, ref } = favorite as { kind?: unknown; ref?: unknown };
    if (!isFavoriteKind(kind) || typeof ref !== "string") {
      return;
    }

    if (kind === "folder") {
      void this.selectFolderFromNav(ref);
      return;
    }

    if (kind === "file") {
      void this.plugin.openNoteFromCard(ref);
      return;
    }

    if (kind === "tag") {
      void this.activateFavoriteTag(ref);
      return;
    }

    const activeBoxId = isBoxScope(this.cardScope) ? this.cardScope.boxId : null;
    this.handleBoxCommand({ command: ref === activeBoxId ? "exit" : "switch", boxId: ref });
  }

  /** A favorited tag means "show every note with this tag": vault root + that one tag. */
  private async activateFavoriteTag(tag: string): Promise<void> {
    await this.selectFolderFromNav("");
    await this.applyTagFilter([tag]);
  }

  private async deleteFolder(folderPath: string): Promise<void> {
    const strings = this.getFolderManagementStrings();
    const folder = this.resolveFolderFromUiPath(folderPath);
    if (!(folder instanceof TFolder)) {
      new Notice(strings.folderNotFound);
      return;
    }

    if (folder.path === "") {
      return;
    }

    try {
      const confirmed = await this.app.fileManager.promptForDeletion(folder);
      if (!confirmed) {
        return;
      }

      const liveFolder = this.resolveFolderFromUiPath(folderPath);
      if (!(liveFolder instanceof TFolder)) {
        new Notice(strings.folderNotFound);
        return;
      }

      const nextFolderPath = this.getFallbackFolderPathAfterFolderDeletion(liveFolder.path);
      await trashAbstractFileUsingObsidianPreference(this.app, liveFolder);
      this.refreshFolderTreeState();
      if (nextFolderPath !== null) {
        await this.moveScopeToFolder(nextFolderPath);
      }
    } catch (error) {
      new Notice(strings.deleteFailed(String(error)));
    }
  }

  private async refreshFolderScopeAfterFolderRename(previousPath: string, nextPath: string): Promise<void> {
    if (!isFolderScope(this.cardScope)) {
      return;
    }
    const rewrittenPath = rewritePathAfterRename(this.cardScope.path, previousPath, nextPath);
    if (rewrittenPath === this.cardScope.path) {
      return;
    }
    this.cardScope = createFolderScope(rewrittenPath, this.cardScope.includeSubfolders);
    this.folderLoadKey = this.serializeLoadKey(this.buildLoadKey(this.cardScope));
    await this.refresh({ reason: "manual", forceRefresh: true });
  }

  private getFallbackFolderPathAfterFolderDeletion(deletedPath: string): string | null {
    if (!isFolderScope(this.cardScope)) {
      return null;
    }
    const currentFolderPath = this.cardScope.path;
    if (currentFolderPath !== deletedPath && !currentFolderPath.startsWith(`${deletedPath}/`)) {
      return null;
    }

    return "";
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

  private reconcileBulkSelectionBeforeLoad(nextLoadScope: CardLoadKey): boolean {
    if (!this.shouldClearBulkSelectionForScopeChange(nextLoadScope)) {
      return false;
    }

    this.selectedPaths = new Set<string>();
    this.bulkAnchorPath = null;
    return true;
  }

  private shouldClearBulkSelectionForScopeChange(nextLoadScope: CardLoadKey): boolean {
    if (this.inFlightLoadScope) {
      return !scopesEqual(this.inFlightLoadScope.scope, nextLoadScope.scope);
    }
    return !scopesEqual(this.cardScope, nextLoadScope.scope);
  }

  private createProgrammaticSelectionRequest(
    scope: CardScope,
    forceRefresh: boolean,
  ): FolderSelectionRequest {
    const token = this.selectionEpoch.bump();
    return {
      requestId: token.value,
      scope,
      source: "programmatic",
      requestedAtMs: Date.now(),
      forceRefresh,
    };
  }
  private buildLoadKey(scope: CardScope): CardLoadKey {
    if (scope.kind === "box") {
      const box = findCardBox(this.plugin.getSettings().boxes ?? [], scope.boxId);
      return { scope, sort: box?.sort ?? this.plugin.getSettings().sort };
    }
    return { scope, sort: this.plugin.getSettings().sort };
  }

  private serializeLoadKey(loadKey: CardLoadKey): string {
    if (loadKey.scope.kind === "box") {
      const box = findCardBox(this.plugin.getSettings().boxes ?? [], loadKey.scope.boxId);
      return serializeScopeKey(
        loadKey.scope,
        loadKey.sort,
        box ? getBoxMembershipSignature(box) : "",
      );
    }
    return serializeScopeKey(loadKey.scope, loadKey.sort);
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
    this.cardScope = loadScope.scope;
    this.loading = true;
    const loadToken = this.loadEpoch.bump();
    this.pendingHydration.clear();
    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.clearSearchMatchCounts();
    this.clearSearchDebounce();
    this.searchRequestEpoch.bump();
    this.searchStatus = this.deriveSearchStatus();
    this.projectVisibleCards();
    this.publishGroups(...PANEL_GROUPS);

    try {
      const files = this.collectScopeFiles(loadScope.scope);
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

      if (!this.loadEpoch.isCurrent(loadToken)) {
        return false;
      }

      records.sort((left, right) =>
        this.compareCards(left, right, loadScope.sort.field, loadScope.sort.direction),
      );
      this.baseCards = records;
      this.folderLoadKey = loadKey;
      const startupPaths = this.deriveVisibleCardsFrom(records)
        .slice(0, FolderCardView.STARTUP_PREVIEW_CARD_COUNT)
        .map((card) => card.path);
      await this.hydrateStartupCardPaths(startupPaths, loadToken);
      return true;
    } finally {
      if (this.loadEpoch.isCurrent(loadToken)) {
        this.loading = false;
        this.projectVisibleCards();
        this.publishGroups(...PANEL_GROUPS);
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
    await this.handleScopeSelection(queued);
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

    const pathInScope = this.isPathInActiveScope(event.path);
    const oldPathInScope =
      typeof event.oldPath === "string" && event.oldPath.length > 0
        ? this.isPathInActiveScope(event.oldPath)
        : false;

    return pathInScope || oldPathInScope;
  }

  /**
   * Membership test against whatever currently feeds `baseCards`: card box
   * membership in box mode, browse folder scope otherwise.
   */
  private isPathInActiveScope(path: string): boolean {
    if (this.cardScope.kind === "box") {
      const box = findCardBox(this.plugin.getSettings().boxes ?? [], this.cardScope.boxId);
      return box ? isBoxMember(this.app, path, box) : false;
    }
    return isPathInFolderScope(path, this.cardScope.path, this.cardScope.includeSubfolders);
  }

  private collectScopeFiles(scope: CardScope): TFile[] {
    switch (scope.kind) {
      case "folder":
        return this.collectSupportedFiles(scope.path, scope.includeSubfolders);
      case "box": {
        const box = findCardBox(this.plugin.getSettings().boxes ?? [], scope.boxId);
        return box ? this.collectBoxFiles(box) : [];
      }
      default: {
        const exhaustive: never = scope;
        return exhaustive;
      }
    }
  }

  private collectSupportedFiles(folderPath: string, includeSubfolders: boolean): TFile[] {
    return collectFolderScopeFiles(this.app, folderPath, includeSubfolders);
  }

  private isPathInScope(path: string, includeSubfolders: boolean): boolean {
    return isPathInFolderScope(path, scopeDisplayPath(this.cardScope), includeSubfolders);
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
    const projection = this.buildProjectionGroup();
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
        projection.sortField,
        projection.sortDirection,
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
      if (!this.isPathInActiveScope(event.path)) {
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
      const hydrationToken = this.loadEpoch.token();
      void this.hydrateCard(newCard.path, hydrationToken).then(() => {
        if (this.loadEpoch.isCurrent(hydrationToken)) {
          this.publishGroups("cards");
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
      const hydrationToken = this.loadEpoch.token();
      void this.hydrateCard(card.path, hydrationToken).then(() => {
        if (this.loadEpoch.isCurrent(hydrationToken)) {
          this.publishGroups("cards");
        }
      });

      return { handled: true, action: "hydration_reset" };
    }

    if (event.eventType === "rename" && !event.isFolder) {
      const oldIndex = event.oldPath
        ? this.baseCards.findIndex((c) => c.path === event.oldPath)
        : -1;

      const newInScope = this.isPathInActiveScope(event.path);
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

          void this.hydrateCard(newCard.path, this.loadEpoch.token()).then(() => {
            this.publishGroups("cards");
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

    await this.hydrateCardPaths(targets, this.loadEpoch.token(), {
      pushState: true,
      batchSize: FolderCardView.HYDRATION_BATCH_SIZE,
    });
  }

  private async hydrateCardPaths(
    paths: string[],
    token: EpochToken,
    options: {
      pushState: boolean;
      batchSize?: number;
    },
  ): Promise<void> {
    if (paths.length === 0 || !this.loadEpoch.isCurrent(token)) {
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
        if (!this.loadEpoch.isCurrent(token)) {
          return;
        }

        const batch = targets.slice(batchStart, batchStart + batchSize);
        await Promise.all(batch.map((path) => this.hydrateCard(path, token)));

        if (!this.loadEpoch.isCurrent(token)) {
          return;
        }

        batch.forEach((path) => this.pendingHydration.delete(path));
      }
    } finally {
      if (this.loadEpoch.isCurrent(token)) {
        targets.forEach((path) => this.pendingHydration.delete(path));
      }
    }

    if (options.pushState && this.loadEpoch.isCurrent(token)) {
      this.publishGroups("cards");
    }
  }

  private async hydrateStartupCardPaths(paths: string[], token: EpochToken): Promise<void> {
    if (paths.length === 0 || !this.loadEpoch.isCurrent(token)) {
      return;
    }

    const hydration = this.hydrateCardPaths(paths, token, {
      pushState: false,
      batchSize: FolderCardView.HYDRATION_BATCH_SIZE,
    });
    const viewWindow = this.getViewWindow();
    let timeoutId: ReturnType<Window["setTimeout"]> | null = null;
    const waitBudget = new Promise<"timeout">((resolve) => {
      timeoutId = viewWindow.setTimeout(() => {
        resolve("timeout");
      }, FolderCardView.STARTUP_PREVIEW_WAIT_MS);
    });

    const result = await Promise.race([
      hydration.then(() => "hydrated" as const),
      waitBudget,
    ]);

    if (timeoutId !== null) {
      viewWindow.clearTimeout(timeoutId);
    }

    if (result === "timeout") {
      void hydration.then(
        () => {
          if (this.loadEpoch.isCurrent(token)) {
            this.publishGroups("cards");
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

  private async hydrateCard(cardPath: string, token: EpochToken): Promise<void> {
    const card = this.baseCards.find((c) => c.path === cardPath);
    if (!card) {
      return;
    }

    if (!isMarkdownCardKind(card.fileKind)) {
      if (!this.loadEpoch.isCurrent(token)) {
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
      if (!this.loadEpoch.isCurrent(token)) {
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
      if (!this.loadEpoch.isCurrent(token)) {
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
    const activeBox = this.getScopeBox();

    if (activeBox) {
      if (
        activeBox.sort.field === nextField &&
        activeBox.sort.direction === nextDirection
      ) {
        return;
      }
      await this.updateActiveBox((box) => ({
        ...box,
        sort: { field: nextField, direction: nextDirection },
      }));
      this.reprojectCards();
      return;
    }

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
  }

  private buildFolderTree(): FolderTreeNode[] {
    const vault = this.app.vault as unknown as { getRoot?: unknown };
    if (typeof vault.getRoot !== "function") {
      return [];
    }

    function countDirectFiles(folder: TFolder): number {
      let total = 0;
      for (const child of folder.children) {
        if (child instanceof TFile && isSupportedCardFile(child)) {
          total += 1;
        }
      }

      return total;
    }

    function buildNode(folder: TFolder, depth: number): FolderTreeNode {
      const subfolders = folder.children
        .filter((c): c is TFolder => c instanceof TFolder)
        .sort((a, b) => a.name.localeCompare(b.name));
      const children = subfolders.map((sf) => buildNode(sf, depth + 1));
      const directCount = countDirectFiles(folder);

      return {
        name: folder.name || "/",
        path: folder.path === "" ? "/" : folder.path,
        children,
        depth,
        directCount,
        recursiveCount: children.reduce((total, child) => total + child.recursiveCount, directCount),
        recursiveFolderCount: children.reduce(
          (total, child) => total + 1 + child.recursiveFolderCount,
          0,
        ),
      };
    }

    const root = this.app.vault.getRoot();
    const subfolders = root.children
      .filter((c): c is TFolder => c instanceof TFolder)
      .sort((a, b) => a.name.localeCompare(b.name));
    const topLevelNodes = subfolders.map((sf) => buildNode(sf, 0));
    const rootDirectCount = countDirectFiles(root);

    const rootNode: FolderTreeNode = {
      name: root.name || "/",
      path: "/",
      children: [],
      depth: 0,
      directCount: rootDirectCount,
      recursiveCount: topLevelNodes.reduce(
        (total, node) => total + node.recursiveCount,
        rootDirectCount,
      ),
      // The root node hoists its subfolders to top level, so its own descendant
      // folder count has to be derived from the hoisted nodes.
      recursiveFolderCount: topLevelNodes.reduce(
        (total, node) => total + 1 + node.recursiveFolderCount,
        0,
      ),
    };

    return [rootNode, ...topLevelNodes];
  }

  /**
   * Key for the scope-derived tag memo. Every input that can change the answer
   * moves one of these: the scope itself (`folderLoadKey` covers folder, box,
   * subfolder inclusion and sort), the loaded card set, and vault content.
   */
  private scopeTagCacheKey(): string {
    return `${this.folderLoadKey}::${this.baseCards.length}::${this.vaultContentEpoch.value}`;
  }

  /**
   * Tags for the current scope. Memoized because card publishing is hot (hydration
   * batches, selection, search) while this walks every loaded card, which at
   * vault-root scope means the whole vault.
   */
  private deriveScopeTags(): { availableTags: string[]; tagCounts: Record<string, number> } {
    const key = this.scopeTagCacheKey();
    const cached = this.scopeTagCache;
    if (cached && cached.key === key) {
      return cached.value;
    }

    const files = this.baseCards.map((card) => card.file);
    const value = {
      availableTags: this.hasMetadataCache() ? collectAllTags(this.app, files) : [],
      tagCounts: collectTagCounts(this.app, files),
    };
    this.scopeTagCache = { key, value };
    return value;
  }

  private hasMetadataCache(): boolean {
    const metadataCache = (this.app as unknown as { metadataCache?: unknown }).metadataCache;
    return (
      typeof metadataCache === "object" &&
      metadataCache !== null &&
      "getFileCache" in metadataCache &&
      typeof (metadataCache as { getFileCache?: unknown }).getFileCache === "function"
    );
  }

  private deriveAvailableTags(): string[] {
    return this.deriveScopeTags().availableTags;
  }

  private deriveTagCounts(): Record<string, number> {
    return this.deriveScopeTags().tagCounts;
  }

  /**
   * Vault-wide tag counts, used by favorites: activating a favorited tag browses
   * the whole vault, so a scope-derived number would contradict the click.
   *
   * The browse scope cannot move these, so they only follow `navCountEpoch`, which
   * lags vault events by one debounce interval — same deal as box card counts.
   */
  private getVaultTagCounts(): Record<string, number> {
    const cached = this.vaultTagCountsCache;
    if (cached && cached.seq === this.navCountEpoch.value) {
      return cached.counts;
    }

    const counts = collectVaultTagIndex(this.app)?.counts ?? {};
    this.vaultTagCountsCache = { seq: this.navCountEpoch.value, counts };
    return counts;
  }

  private deriveVisibleCards(): NoteCardRecord[] {
    return this.deriveVisibleCardsFrom(this.baseCards);
  }

  private projectVisibleCards(): void {
    this.visibleCards = this.deriveVisibleCards();
    this.reconcileBulkSelectionToVisibleCards();
  }

  private deriveVisibleCardsFrom(cards: NoteCardRecord[]): NoteCardRecord[] {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();
    const context: PipelineContext = {
      app: this.app,
      settings,
      search: this.buildPipelineSearchInput(),
      pinnedPaths: box ? box.pinnedPaths : settings.pinnedPaths,
    };

    return runPipeline(cards, stepsForScope(this.cardScope), context);
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
  private getViewWindow(): Pick<Window, "setTimeout" | "clearTimeout"> {
    const ownerWindow = this.hostEl?.ownerDocument?.defaultView;
    if (ownerWindow) {
      return ownerWindow;
    }

    if (typeof activeWindow !== "undefined") {
      return activeWindow;
    }

    return window;
  }

  private clearSearchDebounce(): boolean {
    if (this.searchDebounceTimer === null) {
      return false;
    }

    this.getViewWindow().clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = null;
    return true;
  }

  private scheduleDebouncedSearchProjection(): void {
    this.clearSearchDebounce();
    this.searchDebounceTimer = this.getViewWindow().setTimeout(() => {
      this.searchDebounceTimer = null;
      void this.refreshSearchProjection();
    }, FolderCardView.SEARCH_DEBOUNCE_MS);
  }

  private clearFolderTreeDebounce(): boolean {
    if (this.folderTreeDebounceTimer === null) {
      return false;
    }

    this.getViewWindow().clearTimeout(this.folderTreeDebounceTimer);
    this.folderTreeDebounceTimer = null;
    return true;
  }

  private scheduleFolderTreeRefresh(): void {
    this.clearFolderTreeDebounce();
    this.folderTreeDebounceTimer = this.getViewWindow().setTimeout(() => {
      this.folderTreeDebounceTimer = null;
      this.refreshFolderTreeState();
    }, FolderCardView.FOLDER_TREE_DEBOUNCE_MS);
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
    this.searchRequestEpoch.bump();
    this.searchStatus = this.deriveSearchStatus();
    this.projectVisibleCards();
    this.publishGroups("search", "cards", "bulk", "scope");

    if (this.searchQuery.trim().length > 0) {
      this.scheduleDebouncedSearchProjection();
      return;
    }

    this.clearSearchDebounce();
  }

  private resetSearchQuery(): void {
    this.clearSearchDebounce();
    this.searchRequestEpoch.bump();
    this.clearSearchMatchCounts();

    if (this.searchQuery.length === 0 && this.searchOrderedPaths === undefined) {
      this.searchStatus = this.deriveSearchStatus();
      this.projectVisibleCards();
      this.publishGroups("search", "cards", "bulk", "scope");
      return;
    }

    this.searchQuery = "";
    this.searchExecution = this.derivePendingSearchExecution();
    this.searchOrderedPaths = undefined;
    this.searchStatus = this.deriveSearchStatus();
    this.projectVisibleCards();
    this.publishGroups("search", "cards", "bulk", "scope");
  }

  private async refreshSearchProjection(): Promise<void> {
    const query = this.searchQuery.trim();
    if (query.length === 0) {
      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.clearSearchMatchCounts();
      this.searchStatus = this.deriveSearchStatus();
      this.projectVisibleCards();
      this.publishGroups("search", "cards", "bulk", "scope");
      return;
    }

    const service = this.plugin.getSearchService();
    if (!service) {
      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.clearSearchMatchCounts();
      this.searchStatus = this.deriveSearchStatus();
      this.projectVisibleCards();
      this.publishGroups("search", "cards", "bulk", "scope");
      return;
    }

    const requestToken = this.searchRequestEpoch.bump();
    const loadToken = this.loadEpoch.token();
    const requestScope = this.cardScope;
    const snapshotToken = this.searchSnapshotEpoch.token();

    try {
      const result = await service.query({
        query,
        scope: {
          folderPath: scopeDisplayPath(this.cardScope),
          includeSubfolders: isFolderScope(this.cardScope) ? this.cardScope.includeSubfolders : true,
        },
        candidatePaths: this.baseCards.map((card) => card.path),
      });

      if (!this.isSearchRequestCurrent(requestToken, loadToken, requestScope, snapshotToken, query)) {
        return;
      }

      this.searchExecution = result.execution;
      if (result.execution === "indexed-ready") {
        this.searchOrderedPaths = result.orderedPaths ?? [];
        this.searchMatchCountsByPath = { ...result.matchCountsByPath };
      } else {
        this.searchOrderedPaths = undefined;
        this.clearSearchMatchCounts();
      }
      this.searchStatus = this.toRuntimeSearchStatus(result);
      this.projectVisibleCards();
      this.publishGroups("search", "cards", "bulk", "scope");
    } catch {
      if (!this.isSearchRequestCurrent(requestToken, loadToken, requestScope, snapshotToken, query)) {
        return;
      }

      this.searchExecution = this.derivePendingSearchExecution();
      this.searchOrderedPaths = undefined;
      this.clearSearchMatchCounts();
      this.searchStatus = this.deriveSearchStatus();
      this.projectVisibleCards();
      this.publishGroups("search", "cards", "bulk", "scope");
    }
  }

  private isSearchRequestCurrent(
    requestToken: EpochToken,
    loadToken: EpochToken,
    requestScope: CardScope,
    snapshotToken: EpochToken,
    requestQuery: string,
  ): boolean {
    if (!this.searchRequestEpoch.isCurrent(requestToken)) {
      return false;
    }

    if (!this.loadEpoch.isCurrent(loadToken)) {
      return false;
    }

    if (!scopesEqual(requestScope, this.cardScope)) {
      return false;
    }

    if (!this.searchSnapshotEpoch.isCurrent(snapshotToken)) {
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
      this.publishGroups("bulk", "cards");
    }
  }

  private toggleBulkMode(): void {
    this.bulkMode = !this.bulkMode;

    if (!this.bulkMode) {
      this.selectedPaths = new Set<string>();
      this.bulkAnchorPath = null;
    }

    this.publishGroups("bulk", "cards");
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
      this.publishGroups("bulk", "cards");
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
      this.publishGroups("bulk", "cards");
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
    this.publishGroups("bulk", "cards");

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

  private bulkAddTagSelected(): void {
    if (!this.bulkMode || this.selectedPaths.size === 0) {
      return;
    }

    this.openBulkTagModal("add");
  }

  private bulkRemoveTagSelected(): void {
    if (!this.bulkMode || this.selectedPaths.size === 0) {
      return;
    }

    this.openBulkTagModal("remove");
  }

  private openBulkTagModal(mode: TagMutationMode): void {
    if (mode === "add") {
      const modal = new TagInputModal(
        this.app,
        { mode, strings: this.strings.view.tagInput },
        async (tag) => this.executeBulkTagAction(tag),
      );
      modal.open();
      return;
    }

    const { selectedPathsInOrder, filesInOrder } = this.resolveSelectedLiveMarkdownFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);
    if (filesInOrder.length === 0) {
      this.reconcileSelectionToOrderedPaths([]);
      new Notice(this.strings.view.bulkRemoveTag.noSelectedNotes);
      return;
    }

    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }

    const tagOptions = this.buildBulkRemovableTagOptions(filesInOrder);
    if (tagOptions.length === 0) {
      new Notice(this.strings.view.bulkRemoveTag.noRemovableTags);
      return;
    }

    const modal = new BulkRemoveTagsModal(
      this.app,
      {
        titleText: this.strings.view.bulkRemoveTag.modalTitle,
        emptyMessage: this.strings.view.bulkRemoveTag.noRemovableTags,
        selectionSummary: (count) => this.strings.view.bulkRemoveTag.selectedTagCount(count),
        cancelText: this.strings.view.tagInput.cancel,
        submitText: this.strings.view.bulkRemoveTag.removeSelectedTags,
        submittingText: this.strings.view.bulkRemoveTag.removingSelectedTags,
        tagOptions,
      },
      async (tags) => this.executeBulkRemoveTags(tags),
    );
    modal.open();
  }

  private async executeBulkTagAction(tag: string): Promise<boolean> {
    const strings = this.strings.view.bulkAddTag;
    const { selectedPathsInOrder, filesInOrder } = this.resolveSelectedLiveMarkdownFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);

    if (filesInOrder.length === 0) {
      this.reconcileSelectionToOrderedPaths([]);
      new Notice(strings.noSelectedNotes);
      return true;
    }

    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }

    const summary = await batchAddTagToFiles(this.app, filesInOrder, tag);
    const failedPathSet = new Set(summary.failed.map((failed) => failed.path));
    const failedPathsInOrder = livePathsInOrder.filter((path) => failedPathSet.has(path));

    this.reconcileSelectionToOrderedPaths(failedPathsInOrder);

    const succeededCount = summary.succeeded.length;
    const failedCount = summary.failed.length;
    if (failedCount === 0) {
      new Notice(strings.added(succeededCount, tag));
      return true;
    }

    if (succeededCount === 0) {
      new Notice(strings.failed(failedCount, tag));
      return false;
    }

    new Notice(strings.partial(succeededCount, failedCount, tag));
    return true;
  }

  private async executeBulkRemoveTags(tags: string[]): Promise<boolean> {
    const strings = this.strings.view.bulkRemoveTag;
    const { selectedPathsInOrder, filesInOrder } = this.resolveSelectedLiveMarkdownFilesInOrder();
    const livePathsInOrder = filesInOrder.map((file) => file.path);

    if (filesInOrder.length === 0) {
      this.reconcileSelectionToOrderedPaths([]);
      new Notice(strings.noSelectedNotes);
      return true;
    }

    if (livePathsInOrder.length !== selectedPathsInOrder.length) {
      this.reconcileSelectionToOrderedPaths(livePathsInOrder);
    }

    const collapsedTags = this.collapseBulkRemovableTags(tags);
    if (collapsedTags.length === 0) {
      new Notice(strings.noRemovableTags);
      return false;
    }

    const summary = await batchRemoveTagsFromFiles(this.app, filesInOrder, collapsedTags);
    const failedPathSet = new Set(summary.failed.map((failed) => failed.path));
    const failedPathsInOrder = livePathsInOrder.filter((path) => failedPathSet.has(path));

    this.reconcileSelectionToOrderedPaths(failedPathsInOrder);

    const removedCount = summary.changed.length;
    const noopCount = summary.noop.length;
    const failedCount = summary.failed.length;
    if (removedCount > 0) {
      await this.clearStaleTagFilterIfNeeded(collapsedTags);
    }

    if (failedCount === 0 && noopCount === 0) {
      new Notice(strings.removed(removedCount, collapsedTags.length));
      return true;
    }

    if (removedCount === 0 && failedCount === 0) {
      new Notice(strings.noop(noopCount, collapsedTags.length));
      return false;
    }

    if (removedCount === 0 && noopCount === 0) {
      new Notice(strings.failed(failedCount, collapsedTags.length));
      return false;
    }

    new Notice(strings.partial(removedCount, noopCount, failedCount, collapsedTags.length));
    return true;
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

  private resolveSelectedLiveMarkdownFilesInOrder(): { selectedPathsInOrder: string[]; filesInOrder: TFile[] } {
    const selectedPathsInOrder = Array.from(this.selectedPaths);
    const filesInOrder: TFile[] = [];

    for (const selectedPath of selectedPathsInOrder) {
      const file = this.resolveLiveMarkdownFile(selectedPath);
      if (file) {
        filesInOrder.push(file);
      }
    }

    return { selectedPathsInOrder, filesInOrder };
  }

  private reconcileSelectionToOrderedPaths(pathsInOrder: string[]): void {
    this.selectedPaths = new Set<string>(pathsInOrder);
    this.bulkAnchorPath = pathsInOrder[0] ?? null;
    this.publishGroups("bulk", "cards");
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

  private buildBulkRemovableTagOptions(filesInOrder: TFile[]): BulkRemovableTagOption[] {
    const displayTags = collectAllTags(this.app, filesInOrder);
    const displayByNormalizedTag = new Map<string, string>();
    for (const displayTag of displayTags) {
      displayByNormalizedTag.set(normalizeTagForFrontmatter(displayTag), displayTag);
    }

    const countsByNormalizedTag = new Map<string, number>();
    for (const file of filesInOrder) {
      const fileTags = new Set(getFileTags(this.app, file));
      for (const tag of fileTags) {
        countsByNormalizedTag.set(tag, (countsByNormalizedTag.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(countsByNormalizedTag.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([normalizedTag, selectedFileCount]) => ({
        normalizedTag,
        label: `${displayByNormalizedTag.get(normalizedTag) ?? normalizedTag} (${selectedFileCount})`,
      }));
  }

  private collapseBulkRemovableTags(tags: string[]): string[] {
    const normalizedTags = Array.from(new Set(
      tags
        .map((tag) => normalizeTagForFrontmatter(tag))
        .filter((tag) => tag.length > 0),
    ));
    normalizedTags.sort((left, right) => left.length - right.length || left.localeCompare(right));

    const collapsedTags: string[] = [];
    for (const normalizedTag of normalizedTags) {
      if (collapsedTags.some((candidate) => normalizedTag === candidate || normalizedTag.startsWith(`${candidate}/`))) {
        continue;
      }

      collapsedTags.push(normalizedTag);
    }

    return collapsedTags;
  }

  private async clearStaleTagFilterIfNeeded(removedTags: string[]): Promise<void> {
    const currentFilterTags = this.plugin.getSettings().filter.tags;
    const activeFilterTag = normalizeTagForFrontmatter(currentFilterTags[0] ?? "");
    if (activeFilterTag.length === 0) {
      return;
    }

    const normalizedRemovedTags = this.collapseBulkRemovableTags(removedTags);
    const removedActiveFilter = normalizedRemovedTags.some((removedTag) => {
      return activeFilterTag === removedTag || activeFilterTag.startsWith(`${removedTag}/`);
    });
    const availableTags = new Set(this.deriveAvailableTags().map((tag) => normalizeTagForFrontmatter(tag)));
    if (!removedActiveFilter && availableTags.has(activeFilterTag)) {
      return;
    }

    await this.plugin.saveSettings({
      filter: {
        tags: [],
      },
    });
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
    let hasNonMarkdownSelection = false;

    for (const path of selectedPathsInVisibleOrder) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) {
        continue;
      }

      const fileKind = resolveCardFileKind(file);
      if (fileKind === null || !isMarkdownCardKind(fileKind)) {
        hasNonMarkdownSelection = true;
      }
      filesInFrozenOrder.push(file);
    }

    const livePathsInFrozenOrder = filesInFrozenOrder.map((file) => file.path);
    if (livePathsInFrozenOrder.length !== this.selectedPaths.size) {
      this.reconcileSelectionToOrderedPaths(livePathsInFrozenOrder);
    }

    if (hasNonMarkdownSelection) {
      new Notice(this.strings.view.merge.markdownOnly);
      return;
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
    const path = scopeDisplayPath(this.cardScope);
    if (path === "") {
      return "/";
    }

    return path;
  }

  private buildBulkRuntimePanelState(): BulkRuntimePanelState {
    const selectedPaths = Array.from(this.selectedPaths);
    const selectedCount = selectedPaths.length;
    const hasSelection = selectedCount > 0;
    const selectedMarkdownCount = this.resolveSelectedLiveMarkdownFilesInOrder().filesInOrder.length;

    return {
      bulkMode: this.bulkMode,
      selectedPaths,
      selectedCount,
      bulkAnchorPath: this.bulkAnchorPath,
      canBulkSelectAll: this.visibleCards.length > 0,
      canBulkClearSelection: hasSelection,
      canBulkMoveSelected: hasSelection,
      canBulkAddTagSelected: selectedMarkdownCount > 0,
      canBulkRemoveTagSelected: selectedMarkdownCount > 0,
      canBulkDeleteSelected: hasSelection,
      canBulkMergeSelected: selectedCount > 1 && selectedMarkdownCount === selectedCount,
    };
  }

  private buildScopeGroup(): PanelModelState["scope"] {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();

    return {
      displayPath: this.getDisplayFolderPath(),
      includeSubfolders: settings.includeSubfolders,
      activeBoxId: isBoxScope(this.cardScope) ? this.cardScope.boxId : null,
      activeBoxName: box?.name ?? null,
      boxExcludedCount: box?.excludedPaths.length ?? 0,
      emptyStateMessage: this.buildEmptyStateMessage(),
    };
  }

  private buildCardsGroup(): PanelModelState["cards"] {
    return {
      records: [...this.visibleCards],
      searchMatchCountsByPath: { ...this.searchMatchCountsByPath },
      selectedPath: this.selectedPath,
      loading: this.loading,
      generation: this.loadEpoch.value,
    };
  }

  private buildSearchGroup(): PanelModelState["search"] {
    return {
      query: this.searchQuery,
      status: this.getSearchStatus(),
      readiness: this.searchSnapshot?.health?.readiness,
      persistence: this.searchSnapshot?.health?.persistence,
      rebuildReason: this.searchSnapshot?.health?.rebuildReason ?? null,
      focusToken: this.searchFocusToken,
    };
  }

  private buildProjectionGroup(): PanelModelState["projection"] {
    const settings = this.plugin.getSettings();
    const box = this.getScopeBox();
    return {
      sortField: box?.sort.field ?? settings.sort.field,
      sortDirection: box?.sort.direction ?? settings.sort.direction,
      availableTags: this.deriveAvailableTags(),
      tagCounts: this.deriveTagCounts(),
      activeFilterTags: settings.filter.tags,
      pinnedPaths: box?.pinnedPaths ?? settings.pinnedPaths,
    };
  }

  private buildBulkGroup(): PanelModelState["bulk"] {
    return this.buildBulkRuntimePanelState();
  }

  private buildNavGroup(): PanelModelState["nav"] {
    const settings = this.plugin.getSettings();
    const boxFields = this.buildBoxPanelFields();
    return {
      folderTree: this.folderTree,
      favorites: this.buildFavoriteRowModels({ boxSummaries: boxFields.boxSummaries }),
      boxSummaries: boxFields.boxSummaries,
      paneWidth: settings.navPaneWidth,
      layoutMode: this.getLayoutMode(),
      visible: this.getNavVisible(),
      sectionCollapsed: {
        favorites: settings.favoritesSectionCollapsed,
        folders: settings.folderSectionCollapsed,
        tags: settings.tagSectionCollapsed,
        boxes: settings.boxSectionCollapsed,
      },
      showItemCounts: settings.showNavItemCounts,
      tooltipSide: this.getTooltipSide(),
    };
  }

  private buildAppearanceGroup(): PanelModelState["appearance"] {
    const settings = this.plugin.getSettings();
    return {
      cardCornerRadius: settings.cardCornerRadius,
      previewLines: settings.previewLines,
    };
  }

  /** Runtime events replace only the requested groups and notify listeners once. */
  private publishGroups(...groups: PanelGroup[]): void {
    const uniqueGroups = new Set(groups);
    this.panelModel.batch((state) => {
      for (const group of uniqueGroups) {
        switch (group) {
          case "strings":
            state.strings = this.strings;
            break;
          case "scope":
            state.scope = this.buildScopeGroup();
            break;
          case "cards":
            state.cards = this.buildCardsGroup();
            break;
          case "search":
            state.search = this.buildSearchGroup();
            break;
          case "projection":
            state.projection = this.buildProjectionGroup();
            break;
          case "bulk":
            state.bulk = this.buildBulkGroup();
            break;
          case "nav":
            state.nav = this.buildNavGroup();
            break;
          case "appearance":
            state.appearance = this.buildAppearanceGroup();
            break;
        }
      }
    });
  }

  /** Settings changes translate their four update tiers into explicit groups. */
  private publishForIntent(intent: ViewUpdateIntent): void {
    switch (intent) {
      case "patch":
        this.publishGroups("nav", "appearance", "strings", "scope");
        return;
      case "reproject":
      case "rehydrate":
        this.publishGroups("cards", "projection", "bulk", "scope");
        return;
      case "reload":
        this.publishGroups(...PANEL_GROUPS);
        return;
    }
  }

  private async onFilterChange(detail: { tags?: unknown }): Promise<void> {
    this.returnToCardsViewIfSinglePane();
    if (isBoxScope(this.cardScope)) {
      return;
    }
    const rawTags = Array.isArray(detail.tags) ? detail.tags : [];
    const nextTags: string[] = [];
    for (const tag of rawTags) {
      if (typeof tag !== "string") {
        continue;
      }
      const normalized = tag.trim().replace(/^#/, "").toLowerCase();
      if (normalized.length > 0 && !nextTags.includes(normalized)) {
        nextTags.push(normalized);
      }
    }
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

  private async selectFolderFromNav(path: string): Promise<void> {
    this.returnToCardsViewIfSinglePane();

    const targetFolderPath = normalizeScopePath(path);
    const inBoxMode = isBoxScope(this.cardScope);
    // Leaving a card box counts as a scope change: tag filters never applied
    // inside a box, so browse mode should resume from a clean state.
    const scopeChanged = inBoxMode || targetFolderPath !== scopeDisplayPath(this.cardScope);
    const hasTagFilter = this.plugin.getSettings().filter.tags.length > 0;

    const patch: PartialPluginSettings = {};
    if (scopeChanged && hasTagFilter) {
      patch.filter = { tags: [] };
    }
    if (Object.keys(patch).length > 0) {
      await this.plugin.saveSettings(patch);
    }

    await this.plugin.selectFolderByPath(path, "panel-picker");
  }

  private async onNavPaneResize(width: number): Promise<void> {
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return;
    }

    const normalizedWidth = Math.round(width);
    if (this.plugin.getSettings().navPaneWidth === normalizedWidth) {
      return;
    }

    await this.plugin.saveSettings({ navPaneWidth: normalizedWidth });
  }

  private getLayoutMode(): "dual" | "single" {
    if (this.shellWidth <= 0) {
      return "dual";
    }

    return this.shellWidth < this.plugin.getSettings().navPaneWidth + CARD_PANE_MIN_WIDTH
      ? "single"
      : "dual";
  }

  private getNavVisible(): boolean {
    if (this.getLayoutMode() === "single") {
      return this.singlePaneView === "nav";
    }

    return !this.plugin.getSettings().navPaneCollapsed;
  }

  private onShellResize(width: number): void {
    if (typeof width !== "number" || !Number.isFinite(width)) {
      return;
    }

    const nextWidth = Math.round(width);
    if (nextWidth === this.shellWidth) {
      return;
    }

    const previousMode = this.getLayoutMode();
    this.shellWidth = nextWidth;

    // The toolbar lives in the card pane, so a narrowing fallback must land on cards.
    if (previousMode === "dual" && this.getLayoutMode() === "single") {
      this.singlePaneView = "cards";
    }

    this.publishGroups("nav");
  }

  private returnToCardsViewIfSinglePane(): void {
    if (this.getLayoutMode() !== "single" || this.singlePaneView === "cards") {
      return;
    }

    this.singlePaneView = "cards";
    this.publishGroups("nav");
  }

  private async onToggleNavPane(): Promise<void> {
    // Single-pane swapping stays transient so widening the panel restores both panes.
    if (this.getLayoutMode() === "single") {
      this.singlePaneView = this.singlePaneView === "nav" ? "cards" : "nav";
      this.publishGroups("nav");
      return;
    }

    const current = this.plugin.getSettings().navPaneCollapsed;
    await this.plugin.saveSettings({ navPaneCollapsed: !current });
  }

  private async onToggleNavSection(section: unknown): Promise<void> {
    const settings = this.plugin.getSettings();
    if (section === "favorites") {
      await this.plugin.saveSettings({
        favoritesSectionCollapsed: !settings.favoritesSectionCollapsed,
      });
      return;
    }
    if (section === "folders") {
      await this.plugin.saveSettings({ folderSectionCollapsed: !settings.folderSectionCollapsed });
      return;
    }
    if (section === "tags") {
      await this.plugin.saveSettings({ tagSectionCollapsed: !settings.tagSectionCollapsed });
      return;
    }
    if (section === "boxes") {
      await this.plugin.saveSettings({ boxSectionCollapsed: !settings.boxSectionCollapsed });
      return;
    }
  }

  private async onIncludeSubfoldersChange(detail: { value?: unknown }): Promise<void> {
    this.returnToCardsViewIfSinglePane();
    if (isBoxScope(this.cardScope)) {
      return;
    }
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

    const activeBox = this.getScopeBox();
    const currentPinnedPaths = activeBox ? activeBox.pinnedPaths : this.plugin.getSettings().pinnedPaths;
    const currentlyPinned = currentPinnedPaths.includes(path);
    const shouldPin = typeof detail.pinned === "boolean" ? detail.pinned : !currentlyPinned;

    if (shouldPin === currentlyPinned) {
      return;
    }

    const nextPinnedPaths = shouldPin
      ? [...currentPinnedPaths, path]
      : currentPinnedPaths.filter((pinnedPath) => pinnedPath !== path);

    if (activeBox) {
      await this.updateActiveBox((box) => ({ ...box, pinnedPaths: nextPinnedPaths }));
      return;
    }

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
