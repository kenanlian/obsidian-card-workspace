import type { CardScope } from "./scope";
import type { NoteCardRecord } from "./types";

/** Covers hydration- and metadata-derived fields, not previews alone. */
export type CardPreviewFields = Pick<
  NoteCardRecord,
  "excerpt" | "previewHtml" | "previewMode" | "hydrated" | "taskSummary"
>;

export interface CardPreviewUpdate {
  readonly path: string;
  readonly patch: Partial<CardPreviewFields>;
}

/** Shared mutable state exposed to controllers without exposing the view. */
export interface ViewStateStore {
  getScope(): CardScope;
  setScope(scope: CardScope): void;
  getBaseCards(): readonly NoteCardRecord[];
  getBaseCard(path: string): NoteCardRecord | undefined;
  replaceBaseCards(cards: NoteCardRecord[]): void;
  getVisibleCards(): readonly NoteCardRecord[];
  replaceVisibleCards(cards: NoteCardRecord[]): void;
  patchCardPreviews(updates: readonly CardPreviewUpdate[]): void;
  getVisibleSequenceRevision(): number;
  getHydrationRevision(): number;
  advanceHydrationRevision(): number;
  getSelectedPath(): string | null;
  setSelectedPath(path: string | null): void;
}

export function createViewStateStore(initialScope: CardScope): ViewStateStore {
  let scope = initialScope;
  let baseCards: NoteCardRecord[] = [];
  let visibleCards: NoteCardRecord[] = [];
  let baseIndexByPath = new Map<string, number>();
  let visibleIndexByPath = new Map<string, number>();
  let visibleSequenceRevision = 0;
  let hydrationRevision = 0;
  let selectedPath: string | null = null;

  const buildIndex = (cards: readonly NoteCardRecord[]): Map<string, number> =>
    new Map(cards.map((card, index) => [card.path, index]));

  return {
    getScope: () => scope,
    setScope(nextScope) {
      scope = nextScope;
    },
    getBaseCards: () => baseCards,
    getBaseCard(path) {
      const index = baseIndexByPath.get(path);
      return index === undefined ? undefined : baseCards[index];
    },
    replaceBaseCards(cards) {
      baseCards = cards;
      baseIndexByPath = buildIndex(cards);
    },
    getVisibleCards: () => visibleCards,
    replaceVisibleCards(cards) {
      const pathsChanged = cards.length !== visibleCards.length || cards.some(
        (card, index) => card.path !== visibleCards[index]?.path,
      );
      visibleCards = cards;
      visibleIndexByPath = buildIndex(cards);
      if (pathsChanged) {
        visibleSequenceRevision += 1;
      }
    },
    patchCardPreviews(updates) {
      if (updates.length === 0) {
        return;
      }

      const mergedByPath = new Map<string, Partial<CardPreviewFields>>();
      for (const update of updates) {
        mergedByPath.set(update.path, {
          ...mergedByPath.get(update.path),
          ...update.patch,
        });
      }

      let nextBase: NoteCardRecord[] | null = null;
      let nextVisible: NoteCardRecord[] | null = null;
      for (const [path, patch] of mergedByPath) {
        const baseIndex = baseIndexByPath.get(path);
        const visibleIndex = visibleIndexByPath.get(path);
        const current = baseIndex === undefined
          ? visibleIndex === undefined ? undefined : visibleCards[visibleIndex]
          : baseCards[baseIndex];
        if (!current) {
          continue;
        }

        const replacement = { ...current, ...patch };
        if (baseIndex !== undefined) {
          nextBase ??= [...baseCards];
          nextBase[baseIndex] = replacement;
        }
        if (visibleIndex !== undefined) {
          nextVisible ??= [...visibleCards];
          nextVisible[visibleIndex] = replacement;
        }
      }

      if (nextBase) {
        baseCards = nextBase;
      }
      if (nextVisible) {
        visibleCards = nextVisible;
      }
    },
    getVisibleSequenceRevision: () => visibleSequenceRevision,
    getHydrationRevision: () => hydrationRevision,
    advanceHydrationRevision() {
      hydrationRevision += 1;
      return hydrationRevision;
    },
    getSelectedPath: () => selectedPath,
    setSelectedPath(path) {
      selectedPath = path;
    },
  };
}
