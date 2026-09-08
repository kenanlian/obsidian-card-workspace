import { TFile, type App } from "obsidian";

import { createCardRecord } from "../card-record";
import { findSortedInsertIndex } from "../card-sort";
import { resolveCardFileKind } from "../file-kind";
import { isLinksMember } from "../links-sources";
import type { BoxScope, CardScope, LinksScope } from "../scope";
import type { CardBoxSortSpec, NoteCardRecord, VaultMutationEvent } from "../types";

/** Result of one metadata-path membership reconciliation. */
export type MetadataMembershipOutcome = "unchanged" | "entered" | "left";

/** Shared store/app/sort accessors for symmetric single-path membership reconcile. */
export interface PathMembershipReconcileDeps {
  getBaseCards: () => readonly NoteCardRecord[];
  replaceBaseCards: (cards: NoteCardRecord[]) => void;
  prepareRecordsFromCache: (records: NoteCardRecord[]) => void;
  deletePendingHydration: (path: string) => boolean;
  getApp: () => App;
  resolveSort: () => CardBoxSortSpec;
}

/**
 * Symmetric single-path membership reconcile.
 *
 * A loaded card that no longer matches is removed; an absent supported file
 * that now matches is inserted through `createCardRecord`, prepared from the
 * runtime preview cache / non-Markdown placeholder path, and reinserted under
 * the active sort. A missing or unsupported live file is a safe no-op
 * ("unchanged"). Repeat-safe: an already-applied counterpart event reports
 * "unchanged".
 */
export function reconcileSymmetricPathMembership(
  path: string,
  isMember: boolean,
  deps: PathMembershipReconcileDeps,
): MetadataMembershipOutcome {
  const cards = deps.getBaseCards();
  const index = cards.findIndex((card) => card.path === path);

  if (index !== -1) {
    if (isMember) {
      return "unchanged";
    }
    deps.deletePendingHydration(path);
    deps.replaceBaseCards(cards.filter((card) => card.path !== path));
    return "left";
  }

  if (!isMember) {
    return "unchanged";
  }

  const file = deps.getApp().vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    return "unchanged";
  }
  const fileKind = resolveCardFileKind(file);
  if (fileKind === null) {
    return "unchanged";
  }

  const record = createCardRecord(deps.getApp(), file, fileKind);
  deps.prepareRecordsFromCache([record]);
  const sort = deps.resolveSort();
  const nextCards = [...cards];
  nextCards.splice(
    findSortedInsertIndex(nextCards, record, sort.field, sort.direction),
    0,
    record,
  );
  deps.replaceBaseCards(nextCards);
  return "entered";
}

/** Box arm of metadata membership: `isPathInBox` keeps manual/exclusion precedence. */
export function reconcileBoxMembershipForPath(
  scope: BoxScope,
  path: string,
  deps: PathMembershipReconcileDeps & {
    isPathInBox: (path: string, boxId: string) => boolean;
  },
): MetadataMembershipOutcome {
  return reconcileSymmetricPathMembership(path, deps.isPathInBox(path, scope.boxId), deps);
}

/**
 * C9 links arm: backlinks reuse the extracted symmetric reconcile; outgoing
 * source-note edits schedule a scope reload and otherwise no-op.
 */
export function reconcileLinksMembershipForPath(
  scope: LinksScope,
  path: string,
  deps: PathMembershipReconcileDeps,
  requestScopeReload: () => void,
): MetadataMembershipOutcome {
  if (scope.direction === "outgoing") {
    if (path === scope.notePath) {
      requestScopeReload();
    }
    return "unchanged";
  }
  return reconcileSymmetricPathMembership(path, isLinksMember(deps.getApp(), scope, path), deps);
}

/**
 * C8 links source-file identity: rename rewrites `notePath`, refreshes the
 * load key, and schedules an authoritative scope reload — the renamed source
 * is never a member of its own links set, so the event is reported handled
 * and never reaches incremental assembly. Delete falls back to the persisted
 * last folder and reports handled so the links set is not reloaded.
 */
export function reconcileLinksScopeForVaultEvent(
  scope: CardScope,
  event: VaultMutationEvent,
  hooks: {
    setScope: (scope: CardScope) => void;
    refreshLoadKey: () => void;
    requestScopeReload: () => void;
    fallbackToFolder: (path: string) => void;
    lastFolderPath: string;
  },
): boolean {
  if (scope.kind !== "links" || event.isFolder) {
    return false;
  }
  if (event.eventType === "rename" && event.oldPath === scope.notePath) {
    hooks.setScope({ ...scope, notePath: event.path });
    hooks.refreshLoadKey();
    hooks.requestScopeReload();
    return true;
  }
  if (event.eventType === "delete" && event.path === scope.notePath) {
    hooks.fallbackToFolder(hooks.lastFolderPath);
    return true;
  }
  return false;
}

/**
 * Links incremental gate: C11 refresh-relevance (`isPathRelevantToLinksScope`)
 * is not membership, so `create` and rename-into events under a links scope
 * must defer to the debounced full reload — `collectLinksFiles` recomputes the
 * true set and no phantom card is inserted (a phantom would persist: outgoing
 * reconcile never evicts foreign paths, backlinks evicts only markdown on its
 * own metadata change). Renames of a loaded member keep the incremental merge;
 * delete/modify stay incremental. Folder/box scopes are unaffected.
 */
export function shouldDeferLinksIncrementalMutation(
  scope: CardScope,
  event: VaultMutationEvent,
  oldPathInBase: boolean,
): boolean {
  if (scope.kind !== "links") {
    return false;
  }
  if (event.eventType === "create") {
    return true;
  }
  return event.eventType === "rename" && !oldPathInBase;
}
