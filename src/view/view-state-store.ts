import type { CardScope } from "./scope";
import type { NoteCardRecord } from "./types";

/** Shared mutable state exposed to controllers without exposing the view. */
export interface ViewStateStore {
  getScope(): CardScope;
  setScope(scope: CardScope): void;
  getBaseCards(): readonly NoteCardRecord[];
  replaceBaseCards(cards: NoteCardRecord[]): void;
  getVisibleCards(): readonly NoteCardRecord[];
  replaceVisibleCards(cards: NoteCardRecord[]): void;
  /** Applies a patch to the shared record object; unknown paths are ignored. */
  patchCard(path: string, patch: Partial<NoteCardRecord>): void;
  getSelectedPath(): string | null;
  setSelectedPath(path: string | null): void;
}

export function createViewStateStore(initialScope: CardScope): ViewStateStore {
  let scope = initialScope;
  let baseCards: NoteCardRecord[] = [];
  let visibleCards: NoteCardRecord[] = [];
  let selectedPath: string | null = null;

  return {
    getScope: () => scope,
    setScope(nextScope) {
      scope = nextScope;
    },
    getBaseCards: () => baseCards,
    replaceBaseCards(cards) {
      baseCards = cards;
    },
    getVisibleCards: () => visibleCards,
    replaceVisibleCards(cards) {
      visibleCards = cards;
    },
    patchCard(path, patch) {
      const record =
        baseCards.find((card) => card.path === path) ??
        visibleCards.find((card) => card.path === path);
      if (record) {
        Object.assign(record, patch);
      }
    },
    getSelectedPath: () => selectedPath,
    setSelectedPath(path) {
      selectedPath = path;
    },
  };
}
