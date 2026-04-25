import type { TFile } from "obsidian";
import type { SortDirection, SortField } from "../settings";
import type { CardFileKind } from "./file-kind";

export type { SearchStatus } from "../search/types";

export const ALL_NOTES_PATH = "__all__";

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
 * - `orderedPaths: null` => service did not provide indexed ordering; `pipeline.ts` must fallback-filter.
 * - `orderedPaths: []` => indexed search is ready and query produced zero matches.
 *
 * Score details remain internal to search runtime contracts and must not be surfaced on card records.
 */
export interface PipelineSearchInput {
  query: string;
  orderedPaths: string[] | null;
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

export type FolderSelectionSource = "explorer-click" | "programmatic" | "panel-picker";

export interface FolderSelectionRequest {
  requestId: number;
  folderPath: string;
  source: FolderSelectionSource;
  requestedAtMs: number;
  forceRefresh?: boolean;
}

export interface FolderLoadKey {
  folderPath: string;
  includeSubfolders: boolean;
  sortField: SortField;
  sortDirection: SortDirection;
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
  canBulkDeleteSelected: boolean;
  canBulkMergeSelected: boolean;
}

export interface FolderLoadSnapshot {
  folderPath: string | null;
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

export type VaultMutationEventType = "create" | "modify" | "delete" | "rename";

export interface VaultMutationEvent {
  eventType: VaultMutationEventType;
  path: string;
  oldPath: string | null;
  isFolder: boolean;
  fileKind: CardFileKind | null;
}

export type SelectionAction =
  | "noop"
  | "started"
  | "queued_latest"
  | "reused_inflight"
  | "rejected_invalid";

export interface SelectionResult {
  action: SelectionAction;
  folderPath: string;
  generationChanged: boolean;
  preserveUiState: boolean;
}

export type RefreshReason = "vault-change" | "settings-change" | "manual";

export interface RefreshRequest {
  reason: RefreshReason;
  folderPath?: string;
  forceRefresh?: boolean;
}

export type RefreshAction =
  | "started"
  | "queued_latest"
  | "skipped_no_folder"
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
  | "skipped_no_folder"
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
}
