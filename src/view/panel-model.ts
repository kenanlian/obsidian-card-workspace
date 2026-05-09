import type { SortDirection, SortField } from "../settings";
import type {
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

export interface PanelModelState {
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
  activeFilterTags: string[];
  pinnedPaths: string[];
  previewLines: number;
  folderTree: FolderTreeNode[];
  includeSubfolders: boolean;
  isAllNotesScope: boolean;
  tooltipSide: "left" | "right";
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
