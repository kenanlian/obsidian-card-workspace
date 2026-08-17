import type { TFile } from "obsidian";
import type { SearchQueryExecutionState } from "../search";
import type { SortDirection, SortField } from "../settings";
import type { CardFileKind } from "./file-kind";
import type { CardScope } from "./scope";

export type {
  SearchIndexPersistenceHealth,
  SearchIndexReadinessState,
  SearchIndexRebuildReason,
  SearchStatus,
} from "../search/types";


/**
 * Search ownership model for Phase 3 architecture hardening.
 *
 * - `main.ts` owns plugin lifecycle and service wiring.
 * - `FolderCardView.ts` owns per-view runtime coordination and query changes.
 * - `panel-model.ts` bridges view-owned state into Svelte props only.
 * - `Toolbar.svelte` emits query/reset intent only.
 * - `pipeline.ts` is the single visible-card filtering path.
 */
export interface SearchOwnershipContract {
  readonly main: "plugin-lifecycle-and-service-wiring";
  readonly folderCardView: "per-view-runtime-coordination-and-query-changes";
  readonly panelModel: "state-bridge-only";
  readonly toolbar: "intent-emitter-only";
  readonly pipeline: "visible-card-filtering-only";
}

/**
 * Runtime-only search inputs passed into visible-card projection.
 *
 * Empty queries stay outside search filtering entirely.
 * For non-empty queries:
 * - `execution: "indexed-ready"` means `orderedPaths` is authoritative, including `[]` for ready-zero.
 * - Any other execution state means indexed filtering did not run and the query stays in a blocked empty-projection state.
 *
 * Score details remain internal to search runtime contracts and must not be surfaced on card records.
 */
export interface PipelineSearchInput {
  query: string;
  execution: SearchQueryExecutionState;
  orderedPaths?: string[];
}

/**
 * A single membership rule for a card box.
 *
 * - `folder`: folder scope path (`""` = vault root).
 * - `includeSubfolders`: whether the folder scope descends recursively.
 * - `tags`: normalized tags applied with AND semantics (same as browse tag filter).
 *
 * A path matches a rule when it is inside the folder scope AND matches every tag.
 * Rules within a box combine with OR semantics.
 */
export interface Rule {
  folder: string;
  includeSubfolders: boolean;
  tags: string[];
}

export interface CardBoxSortSpec {
  field: SortField;
  direction: SortDirection;
}

/**
 * A topic-oriented collection container.
 *
 * Membership = rule hits (folder + tags) ∪ manualPaths − excludedPaths.
 * Invariant: `manualPaths ∩ excludedPaths = ∅`.
 */
export interface CardBoxDefinition {
  id: string;
  name: string;
  rules: Rule[];
  manualPaths: string[];
  excludedPaths: string[];
  pinnedPaths: string[];
  sort: CardBoxSortSpec;
}

export type FavoriteKind = "folder" | "file" | "tag" | "box";

/**
 * A navigation shortcut. `ref` is kind-dependent:
 * - `folder`: normalized folder path (`""` = vault root)
 * - `file`:   vault-relative file path
 * - `tag`:    tag normalized by `normalizeTagPath` (no leading `#`)
 * - `box`:    `CardBoxDefinition.id`
 */
export interface FavoriteEntry {
  kind: FavoriteKind;
  ref: string;
}

export interface NoteCardRecord {
  file: TFile;
  fileKind: CardFileKind;
  path: string;
  title: string;
  ctime: number;
  mtime: number;
  excerpt: string;
  previewHtml: string;
  previewMode: "text" | "code" | "empty" | "placeholder";
  hydrated: boolean;
}

export interface CardHoverLinkPayload {
  path: string;
  targetEl: HTMLElement;
  mouseEvent: MouseEvent;
}

export type FolderSelectionSource = "programmatic" | "panel-picker";

export interface FolderSelectionRequest {
  requestId: number;
  scope: CardScope;
  source: FolderSelectionSource;
  requestedAtMs: number;
  forceRefresh?: boolean;
}

export interface CardLoadKey {
  scope: CardScope;
  sort: CardBoxSortSpec;
}

export interface BulkRuntimeState {
  bulkMode: boolean;
  selectedPaths: Set<string>;
  bulkAnchorPath: string | null;
}

export interface BulkRuntimePanelState {
  bulkMode: boolean;
  selectedPaths: string[];
  selectedCount: number;
  bulkAnchorPath: string | null;
  canBulkSelectAll: boolean;
  canBulkClearSelection: boolean;
  canBulkMoveSelected: boolean;
  canBulkAddTagSelected: boolean;
  canBulkRemoveTagSelected: boolean;
  canBulkDeleteSelected: boolean;
  canBulkMergeSelected: boolean;
}

export interface FolderLoadSnapshot {
  scope: CardScope | null;
  loadKey: string | null;
  generation: number;
  cards: NoteCardRecord[];
  selectedPath: string | null;
  loading: boolean;
  bulkMode: boolean;
  selectedPaths: Set<string>;
  bulkAnchorPath: string | null;
}

export interface RefreshQueueState {
  inFlightKey: string | null;
  inFlight: boolean;
  queuedRequest: FolderSelectionRequest | null;
  refreshQueued: boolean;
}

export type { VaultMutationEvent, VaultMutationEventType } from "../services/vault-events";

export type SelectionAction =
  | "noop"
  | "started"
  | "queued_latest"
  | "reused_inflight"
  | "rejected_invalid";

export interface SelectionResult {
  action: SelectionAction;
  scope: CardScope;
  generationChanged: boolean;
  preserveUiState: boolean;
}

export type RefreshReason = "vault-change" | "settings-change" | "manual";

export interface RefreshRequest {
  reason: RefreshReason;
  forceRefresh?: boolean;
}

export type RefreshAction =
  | "started"
  | "queued_latest"
  | "skipped_invalid_folder";

export interface RefreshResult {
  action: RefreshAction;
  inFlightKey: string | null;
}

export type VaultMutationQueueAction = "ignored" | "enqueued" | "deferred_while_inflight";

export type IncrementalAction =
  | "inserted"
  | "removed"
  | "updated"
  | "hydration_reset"
  | "skipped_not_found"
  | "skipped_folder_event"
  | "deferred_full_reload";

export interface IncrementalMutationResult {
  handled: boolean;
  action: IncrementalAction;
}

export interface VaultMutationResult {
  shouldRefresh: boolean;
  queueAction: VaultMutationQueueAction;
  selectedFolderPathAfterRename: string | null;
  incrementalResult: IncrementalMutationResult | null;
}

export interface CleanupResult {
  cancelledDebounce: boolean;
  clearedQueuedRequest: boolean;
  clearedPendingHydration: boolean;
}

export interface FolderTreeNode {
  name: string;                       // Leaf folder name (e.g., "Q1")
  path: string;                       // Full vault path (e.g., "Projects/2024/Q1") — "/" for vault root
  children: FolderTreeNode[];         // Sorted alphabetically by name
  depth: number;                      // 0 for root, 1 for top-level folders, etc.
  directCount: number;                // Supported card files directly in this folder
  recursiveCount: number;             // directCount plus every descendant folder's recursiveCount
  recursiveFolderCount: number;       // Every descendant folder, at any depth
}

export type FolderManagementAction = "create-child-folder";

export interface FolderActionPayload {
  action: FolderManagementAction;
  path: string;
}

export type NavSectionId = "favorites" | "folders" | "tags" | "boxes";

/**
 * Tree expansion lives in `NavigationPane.svelte` component state, so the host
 * receives it — and the commands to change it — as a bridge on the payload.
 * Tag fields are only meaningful for `section: "tags"`, `scope: "item"`.
 */
export interface NavMenuBridge {
  hasExpandedFolders: boolean;
  hasExpandedTags: boolean;
  toggleAllFolders: () => void;
  toggleAllTags: () => void;
  tagHasChildren: boolean;
  tagExpanded: boolean;
  toggleTagExpansion: () => void;
}

export interface NavContextMenuPayload {
  section: NavSectionId;
  scope: "header" | "item";
  /** Folder UI path (`"/"` for root), normalized tag, or box id. Absent when `scope` is `"header"`. */
  itemId?: string;
  /** Present only for `section: "favorites"`, `scope: "item"`. */
  favorite?: FavoriteEntry;
  bridge: NavMenuBridge;
  mouseEvent: MouseEvent;
}
