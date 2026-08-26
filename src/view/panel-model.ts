import type { CardCornerRadius, SortDirection, SortField } from "../settings";
import type { UiStrings } from "../i18n";
import type {
  NavigationFocusRequest,
  NavigationProjection,
  NavigationRevealRequest,
  NavigationSemanticState,
} from "./navigation-model";
import type {
  BulkRuntimePanelState,
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
  semanticState: NavigationSemanticState;
  missing: boolean;
}

export interface PanelScopeState {
  displayPath: string;
  includeSubfolders: boolean;
  activeBoxId: string | null;
  activeBoxName: string | null;
  boxExcludedCount: number;
  emptyStateMessage: string;
}

export interface PanelCardsState {
  records: NoteCardRecord[];
  searchMatchCountsByPath: Record<string, number>;
  selectedPath: string | null;
  loading: boolean;
  generation: number;
  sequenceRevision: number;
  hydrationRevision: number;
}

export interface PanelSearchState {
  query: string;
  status: SearchStatus;
  readiness?: SearchIndexReadinessState;
  persistence?: SearchIndexPersistenceHealth;
  rebuildReason?: SearchIndexRebuildReason | null;
  /** Monotonic nonce; each increment asks the toolbar to open and focus its search input. */
  focusToken: number;
}

export interface PanelProjectionState {
  sortField: SortField;
  sortDirection: SortDirection;
  availableTags: string[];
  tagCounts: Record<string, number>;
  activeFilterTags: string[];
  pinnedPaths: string[];
}

export interface PanelNavState {
  folderTree: FolderTreeNode[];
  favorites: FavoriteRowModel[];
  boxSummaries: BoxSummary[];
  paneWidth: number;
  layoutMode: "dual" | "single";
  visible: boolean;
  sectionCollapsed: {
    favorites: boolean;
    folders: boolean;
    tags: boolean;
    boxes: boolean;
  };
  showItemCounts: boolean;
  tooltipSide: "left" | "right";
  projection: NavigationProjection;
  query: string;
  focusId: string | null;
  focusRequest: NavigationFocusRequest | null;
  revealRequest: NavigationRevealRequest | null;
}

export interface PanelAppearanceState {
  cardCornerRadius: CardCornerRadius;
  previewLines: number;
}

export interface PanelModelState {
  strings: UiStrings;
  scope: PanelScopeState;
  cards: PanelCardsState;
  search: PanelSearchState;
  projection: PanelProjectionState;
  bulk: BulkRuntimePanelState;
  nav: PanelNavState;
  appearance: PanelAppearanceState;
}

export type PanelGroup = keyof PanelModelState;

export const PANEL_GROUPS: readonly PanelGroup[] = [
  "strings",
  "scope",
  "cards",
  "search",
  "projection",
  "bulk",
  "nav",
  "appearance",
];

/** Groups are replaced wholesale; deeply readonly values prevent in-place changes. */
type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T extends object
      ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
      : T;

export type PanelStateDraft = {
  [K in PanelGroup]: DeepReadonly<PanelModelState[K]>;
};

export interface PanelModel {
  getState(): PanelModelState;
  subscribe(listener: (state: PanelModelState) => void): () => void;
  /** Replaces assigned groups and notifies once; untouched groups retain their references. */
  mutate(mutateState: (state: PanelStateDraft) => void): void;
  /** As with mutate, but nested calls notify only when the outermost batch exits. */
  batch(mutateState: (state: PanelStateDraft) => void): void;
}

export function createPanelModel(initialState: PanelModelState): PanelModel {
  let state = initialState;
  let batchDepth = 0;
  let pendingNotification = false;
  const listeners = new Set<(state: PanelModelState) => void>();

  const notify = (): void => {
    for (const listener of listeners) {
      listener(state);
    }
  };

  const applyMutation = (mutateState: (state: PanelStateDraft) => void): void => {
    const assigned = new Map<PanelGroup, unknown>();
    const draft = {} as PanelStateDraft;

    for (const group of PANEL_GROUPS) {
      Object.defineProperty(draft, group, {
        enumerable: true,
        get: () => assigned.has(group) ? assigned.get(group) : state[group],
        set: (value: unknown) => {
          assigned.set(group, value);
        },
      });
    }

    mutateState(draft);

    if (assigned.size === 0) {
      return;
    }

    const nextState = { ...state };
    Object.assign(nextState, Object.fromEntries(assigned));
    state = nextState;

    if (batchDepth > 0) {
      pendingNotification = true;
      return;
    }

    notify();
  };

  const model: PanelModel = {
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
    mutate(mutateState: (state: PanelStateDraft) => void): void {
      applyMutation(mutateState);
    },
    batch(mutateState: (state: PanelStateDraft) => void): void {
      batchDepth += 1;
      try {
        applyMutation(mutateState);
      } finally {
        batchDepth -= 1;
        if (batchDepth === 0 && pendingNotification) {
          pendingNotification = false;
          notify();
        }
      }
    },
  };

  return model;
}
