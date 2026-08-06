import type { CardCornerRadius, SortDirection, SortField } from "../settings";
import type { UiStrings } from "../i18n";
import type {
  FavoriteKind,
  FolderTreeNode,
  NoteCardRecord,
  SearchIndexPersistenceHealth,
  SearchIndexReadinessState,
  SearchIndexRebuildReason,
  SearchStatus,
} from "./types";

export interface OpenNotePayload {
  path: string;
}

export interface BoxSummary {
  id: string;
  name: string;
  cardCount: number;
}

export interface FavoriteRowModel {
  kind: FavoriteKind;
  ref: string;
  label: string;
  icon: string;
  count: number;
  selected: boolean;
  missing: boolean;
}

export interface PanelModelState {
  strings: UiStrings;
  cards: NoteCardRecord[];
  searchMatchCountsByPath: Record<string, number>;
  emptyStateMessage: string;
  folderPath: string;
  selectedPath: string | null;
  loading: boolean;
  generation: number;
  searchQuery: string;
  searchStatus: SearchStatus;
  searchIndexReadiness?: SearchIndexReadinessState;
  searchIndexPersistence?: SearchIndexPersistenceHealth;
  searchIndexRebuildReason?: SearchIndexRebuildReason | null;
  sortField: SortField;
  sortDirection: SortDirection;
  availableTags: string[];
  tagCounts: Record<string, number>;
  activeFilterTags: string[];
  pinnedPaths: string[];
  cardCornerRadius: CardCornerRadius;
  previewLines: number;
  folderTree: FolderTreeNode[];
  includeSubfolders: boolean;
  tooltipSide: "left" | "right";
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
  activeBoxId: string | null;
  activeBoxName: string | null;
  boxSummaries: BoxSummary[];
  boxExcludedCount: number;
  navPaneWidth: number;
  layoutMode: "dual" | "single";
  navVisible: boolean;
  folderSectionCollapsed: boolean;
  tagSectionCollapsed: boolean;
  boxSectionCollapsed: boolean;
  favorites: FavoriteRowModel[];
  favoritesSectionCollapsed: boolean;
  /** Monotonic nonce; each increment asks the toolbar to open and focus its search input. */
  searchFocusToken: number;
  showNavItemCounts: boolean;
}

export interface PanelModel {
  getState(): PanelModelState;
  subscribe(listener: (state: PanelModelState) => void): () => void;
  mutate(mutateState: (state: PanelModelState) => void): void;
}

export function createPanelModel(initialState: PanelModelState): PanelModel {
  let state = initialState;
  const listeners = new Set<(state: PanelModelState) => void>();

  return {
    getState(): PanelModelState {
      return state;
    },
    subscribe(listener: (state: PanelModelState) => void): () => void {
      listeners.add(listener);
      listener(state);

      return () => {
        listeners.delete(listener);
      };
    },
    mutate(mutateState: (state: PanelModelState) => void): void {
      const nextState: PanelModelState = { ...state };
      mutateState(nextState);
      state = nextState;

      for (const listener of listeners) {
        listener(state);
      }
    },
  };
}
