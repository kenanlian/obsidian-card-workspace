import { TFile, type App } from "obsidian";

import type { SortDirection, SortField } from "../../settings";
import { migrateRenamedPath, pruneRemovedPath } from "../bulk-selection";
import { createCardRecord } from "../card-record";
import { findSortedInsertIndex } from "../card-sort";
import { resolveCardFileKind, resolveCardFileKindFromPath, type CardFileKind } from "../file-kind";
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
  /** Runtime preview-cache/non-Markdown placeholder preparation for fresh records. */
  prepareRecordsFromCache: (records: NoteCardRecord[]) => void;
  getBulkSelection: () => BulkSelectionState;
  setBulkSelection: (state: BulkSelectionState) => void;
  isPathInActiveScope: (path: string) => boolean;
}

export interface IncrementalMutationOutcome {
  result: IncrementalMutationResult;
  /** `null` means no collection change; `[]` means the collection became empty. */
  nextCards: NoteCardRecord[] | null;
  /**
   * Hydration candidates the caller schedules only after installing
   * `nextCards` and reprojecting: every path whose pending read was canceled
   * plus a merged record that is still unhydrated. The caller schedules only
   * candidates still visible and unhydrated; viewport demand covers hidden cards.
   */
  hydrationPaths: readonly string[];
}

function unchanged(result: IncrementalMutationResult): IncrementalMutationOutcome {
  return { result, nextCards: null, hydrationPaths: [] };
}

interface LiveSupportedFile {
  file: TFile;
  fileKind: CardFileKind;
}

/** Resolves the current live `TFile` for a path; `null` when missing/unsupported. */
function resolveLiveSupportedFile(app: App, path: string): LiveSupportedFile | null {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    return null;
  }
  const fileKind = resolveCardFileKind(file);
  return fileKind === null ? null : { file, fileKind };
}

export function applyIncrementalMutation(
  event: VaultMutationEvent,
  baseCards: readonly NoteCardRecord[],
  deps: IncrementalMutationDeps,
): IncrementalMutationOutcome {
  if (event.isFolder) {
    return unchanged({ handled: false, action: "skipped_folder_event" });
  }

  const oldPathKind = event.oldPath ? resolveCardFileKindFromPath(event.oldPath) : null;
  if (event.fileKind === null && oldPathKind === null) {
    return unchanged({ handled: true, action: "skipped_folder_event" });
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
    const live = resolveLiveSupportedFile(deps.app, event.path);
    if (!live) {
      return unchanged({ handled: false, action: "deferred_full_reload" });
    }
    const card = createCardRecord(deps.app, live.file, live.fileKind);
    insertSorted(card);
    return {
      result: { handled: true, action: "inserted" },
      nextCards: cards,
      hydrationPaths: [card.path],
    };
  }

  if (event.eventType === "modify") {
    const index = cards.findIndex((card) => card.path === event.path);
    if (index === -1) {
      return unchanged({ handled: true, action: "skipped_not_found" });
    }
    const live = resolveLiveSupportedFile(deps.app, event.path);
    if (!live) {
      return unchanged({ handled: false, action: "deferred_full_reload" });
    }
    const existing = cards[index]!;
    deps.pendingHydration.delete(event.path);
    // Replace rather than mutate the published record: live identity and stats
    // win while the display preview/task fields survive until forced hydration
    // (or later viewport demand for hidden cards) refreshes them.
    const replacement = createCardRecord(deps.app, live.file, live.fileKind);
    replacement.excerpt = existing.excerpt;
    replacement.previewHtml = existing.previewHtml;
    replacement.previewMode = existing.previewMode;
    replacement.taskSummary = existing.taskSummary;
    cards.splice(index, 1);
    insertSorted(replacement);
    return {
      result: { handled: true, action: "hydration_reset" },
      nextCards: cards,
      hydrationPaths: [replacement.path],
    };
  }

  if (event.eventType === "rename") {
    return applyRenameMutation(event, cards, insertSorted, setBulkAfterRemoval, deps);
  }

  return unchanged({ handled: false, action: "deferred_full_reload" });
}

function applyRenameMutation(
  event: VaultMutationEvent,
  cards: NoteCardRecord[],
  insertSorted: (card: NoteCardRecord) => void,
  setBulkAfterRemoval: (path: string) => void,
  deps: IncrementalMutationDeps,
): IncrementalMutationOutcome {
  const oldPath = event.oldPath;
  const oldIndex = oldPath !== null ? cards.findIndex((card) => card.path === oldPath) : -1;

  if (oldIndex !== -1 && (!deps.isPathInActiveScope(event.path) || event.fileKind === null)) {
    if (oldPath !== null) {
      deps.pendingHydration.delete(oldPath);
      setBulkAfterRemoval(oldPath);
    }
    cards.splice(oldIndex, 1);
    return { result: { handled: true, action: "removed" }, nextCards: cards, hydrationPaths: [] };
  }

  if (oldIndex !== -1) {
    const live = resolveLiveSupportedFile(deps.app, event.path);
    if (!live) {
      return unchanged({ handled: false, action: "deferred_full_reload" });
    }
    const oldCard = cards[oldIndex]!;
    const hadPendingRead = (oldPath !== null && deps.pendingHydration.has(oldPath))
      || deps.pendingHydration.has(event.path);
    if (oldPath !== null) {
      deps.pendingHydration.delete(oldPath);
    }
    deps.pendingHydration.delete(event.path);
    cards.splice(oldIndex, 1);
    // A metadata-first event may already have inserted the rename destination
    // while the old-path record still exists; remove it too so exactly one
    // merged destination record remains (one-record-per-path postcondition).
    const staleDestinationIndex = cards.findIndex((card) => card.path === event.path);
    if (staleDestinationIndex !== -1) {
      cards.splice(staleDestinationIndex, 1);
    }
    const merged = createCardRecord(deps.app, live.file, live.fileKind);
    if (live.fileKind === oldCard.fileKind) {
      // Same kind: content is unchanged, so the old-path preview state stays
      // valid; identity/path/title/stats and the task summary move to live values.
      merged.excerpt = oldCard.excerpt;
      merged.previewHtml = oldCard.previewHtml;
      merged.previewMode = oldCard.previewMode;
      merged.hydrated = oldCard.hydrated;
    } else {
      // Kind change: never carry preview/task state across kinds. The fresh
      // factory record runs through runtime-cache/non-Markdown placeholder
      // preparation; hydration happens only if it is still required.
      deps.prepareRecordsFromCache([merged]);
    }
    insertSorted(merged);
    if (oldPath !== null) {
      deps.setBulkSelection(migrateRenamedPath(deps.getBulkSelection(), oldPath, event.path));
    }
    return {
      result: { handled: true, action: "updated" },
      nextCards: cards,
      hydrationPaths: hadPendingRead || !merged.hydrated ? [event.path] : [],
    };
  }

  if (
    deps.isPathInActiveScope(event.path) && event.fileKind !== null
    && !cards.some((card) => card.path === event.path)
  ) {
    const live = resolveLiveSupportedFile(deps.app, event.path);
    if (!live) {
      return unchanged({ handled: false, action: "deferred_full_reload" });
    }
    const card = createCardRecord(deps.app, live.file, live.fileKind);
    insertSorted(card);
    return {
      result: { handled: true, action: "inserted" },
      nextCards: cards,
      hydrationPaths: [card.path],
    };
  }

  return unchanged({ handled: true, action: "skipped_not_found" });
}
