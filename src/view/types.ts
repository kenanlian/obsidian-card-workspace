import type { TFile } from "obsidian";
import type { SortDirection, SortField } from "../settings";

export interface NoteCardRecord {
  file: TFile;
  path: string;
  title: string;
  ctime: number;
  mtime: number;
  excerpt: string;
  previewHtml: string;
  previewMode: "text" | "code" | "empty";
  hydrated: boolean;
}

export type FolderSelectionSource = "explorer-click" | "programmatic";

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

export interface FolderLoadSnapshot {
  folderPath: string | null;
  loadKey: string | null;
  generation: number;
  cards: NoteCardRecord[];
  selectedPath: string | null;
  loading: boolean;
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
  isMarkdown: boolean;
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

export interface VaultMutationResult {
  shouldRefresh: boolean;
  queueAction: VaultMutationQueueAction;
  selectedFolderPathAfterRename: string | null;
}

export interface CleanupResult {
  cancelledDebounce: boolean;
  clearedQueuedRequest: boolean;
  clearedPendingHydration: boolean;
}
