import { TFile, type App } from "obsidian";

import type { SortDirection, SortField } from "../../settings";
import { migrateRenamedPath, pruneRemovedPath } from "../bulk-selection";
import { findSortedInsertIndex } from "../card-sort";
import { resolveCardFileKind, resolveCardFileKindFromPath } from "../file-kind";
import type { IncrementalMutationResult, NoteCardRecord, VaultMutationEvent } from "../types";

export interface BulkSelectionState {
  selectedPaths: Set<string>;
  anchorPath: string | null;
}

export interface IncrementalMutationDeps {
  app: App;
  sort: { field: SortField; direction: SortDirection };
  pendingHydration: {
    has: (path: string) => boolean;
    delete: (path: string) => boolean;
  };
  getBulkSelection: () => BulkSelectionState;
  setBulkSelection: (state: BulkSelectionState) => void;
  isPathInActiveScope: (path: string) => boolean;
}

export interface IncrementalMutationOutcome {
  result: IncrementalMutationResult;
  /** `null` means no collection change; `[]` means the collection became empty. */
  nextCards: NoteCardRecord[] | null;
  /** Paths the caller schedules only after installing `nextCards`. */
  hydrationPaths: readonly string[];
}

function createRecord(file: TFile, fileKind: NoteCardRecord["fileKind"]): NoteCardRecord {
  return {
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
}

export function applyIncrementalMutation(
  event: VaultMutationEvent,
  baseCards: readonly NoteCardRecord[],
  deps: IncrementalMutationDeps,
): IncrementalMutationOutcome {
  const unchanged = (result: IncrementalMutationResult): IncrementalMutationOutcome => ({
    result,
    nextCards: null,
    hydrationPaths: [],
  });

  if (event.isFolder) {
    return unchanged({ handled: false, action: "skipped_folder_event" });
  }

  const oldPathKind = event.oldPath ? resolveCardFileKindFromPath(event.oldPath) : null;
  if (event.fileKind === null && oldPathKind === null) {
    return unchanged({ handled: false, action: "skipped_folder_event" });
  }

  const cards = [...baseCards];
  const setBulkAfterRemoval = (path: string): void => {
    deps.setBulkSelection(pruneRemovedPath(deps.getBulkSelection(), path));
  };
  const insertSorted = (card: NoteCardRecord): void => {
    const index = findSortedInsertIndex(cards, card, deps.sort.field, deps.sort.direction);
    cards.splice(index, 0, card);
  };

  if (event.eventType === "delete") {
    const index = cards.findIndex((card) => card.path === event.path);
    if (index === -1) {
      return unchanged({ handled: true, action: "skipped_not_found" });
    }
    deps.pendingHydration.delete(event.path);
    cards.splice(index, 1);
    setBulkAfterRemoval(event.path);
    return { result: { handled: true, action: "removed" }, nextCards: cards, hydrationPaths: [] };
  }

  if (event.eventType === "create") {
    if (!deps.isPathInActiveScope(event.path) || cards.some((card) => card.path === event.path)) {
      return unchanged({ handled: true, action: "skipped_not_found" });
    }
    const file = deps.app.vault.getAbstractFileByPath(event.path);
    if (!(file instanceof TFile)) {
      return unchanged({ handled: false, action: "deferred_full_reload" });
    }
    const fileKind = resolveCardFileKind(file);
    if (fileKind === null) {
      return unchanged({ handled: true, action: "skipped_not_found" });
    }
    const card = createRecord(file, fileKind);
    insertSorted(card);
    return {
      result: { handled: true, action: "inserted" },
      nextCards: cards,
      hydrationPaths: [card.path],
    };
  }

  if (event.eventType === "modify") {
    const card = cards.find((candidate) => candidate.path === event.path);
    if (!card) {
      return unchanged({ handled: true, action: "skipped_not_found" });
    }
    deps.pendingHydration.delete(card.path);
    return {
      result: { handled: true, action: "hydration_reset" },
      nextCards: null,
      hydrationPaths: [card.path],
    };
  }

  if (event.eventType === "rename") {
    const oldIndex = event.oldPath
      ? cards.findIndex((card) => card.path === event.oldPath)
      : -1;
    const newInScope = deps.isPathInActiveScope(event.path);
    const newKind = event.fileKind;

    if (oldIndex !== -1) {
      const oldCard = cards[oldIndex];
      if (!newInScope || newKind === null) {
        if (oldCard) {
          deps.pendingHydration.delete(oldCard.path);
        }
        cards.splice(oldIndex, 1);
        if (event.oldPath) {
          setBulkAfterRemoval(event.oldPath);
        }
        return {
          result: { handled: true, action: "removed" },
          nextCards: cards,
          hydrationPaths: [],
        };
      }

      const file = deps.app.vault.getAbstractFileByPath(event.path);
      if (!oldCard || !(file instanceof TFile)) {
        return unchanged({ handled: false, action: "deferred_full_reload" });
      }
      const hadPending = deps.pendingHydration.has(oldCard.path);
      deps.pendingHydration.delete(oldCard.path);
      oldCard.file = file;
      oldCard.fileKind = newKind;
      oldCard.path = file.path;
      oldCard.title = file.basename;
      if (event.oldPath) {
        deps.setBulkSelection(migrateRenamedPath(
          deps.getBulkSelection(),
          event.oldPath,
          file.path,
        ));
      }
      cards.splice(oldIndex, 1);
      insertSorted(oldCard);
      return {
        result: { handled: true, action: "updated" },
        nextCards: cards,
        hydrationPaths: hadPending ? [file.path] : [],
      };
    }

    if (newInScope && newKind !== null && !cards.some((card) => card.path === event.path)) {
      const file = deps.app.vault.getAbstractFileByPath(event.path);
      if (!(file instanceof TFile)) {
        return unchanged({ handled: false, action: "deferred_full_reload" });
      }
      const card = createRecord(file, newKind);
      insertSorted(card);
      return {
        result: { handled: true, action: "inserted" },
        nextCards: cards,
        hydrationPaths: [card.path],
      };
    }
    return unchanged({ handled: true, action: "skipped_not_found" });
  }

  return unchanged({ handled: false, action: "deferred_full_reload" });
}
