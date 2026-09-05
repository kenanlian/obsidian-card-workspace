import { TFile, type Menu, type TFolder } from "obsidian";

import type { UiStrings } from "../../i18n";
import { PLAIN_FOLDER_ICON } from "../../icons";
import type { OpenDestination } from "../../settings";
import { getSystemPath, showInSystemExplorer } from "../desktop-shell";
import { isFavorite, isFavoriteKind, moveFavorite, reorderFavorite, toggleFavorite, type FavoriteReorderPosition } from "../favorites";
import { getCardFileIcon, resolveCardFileKindFromPath } from "../file-kind";
import { copyPathToClipboard } from "../note-ops";
import type { BoxSummary, FavoriteRowModel } from "../panel-model";
import type { NavigationSemanticState } from "../navigation-model";
import { isBoxScope, scopeDisplayPath, type CardScope } from "../scope";
import { normalizeTagPath } from "../tag-tree";
import type { FavoriteEntry, FavoriteKind } from "../types";
import type { ViewContext } from "../view-context";

/** `Foo.excalidraw.md` keeps the `.excalidraw` half. */
const CARD_FILE_EXTENSIONS = [".md", ".canvas", ".base"];

/** Recomputes only favorite selection state for a scope snapshot. */
export function remapFavoriteSelection(
  rows: readonly FavoriteRowModel[], scope: CardScope,
  activeTags: readonly string[], selectedPath: string | null,
): FavoriteRowModel[] {
  const normalizedTags = new Set(activeTags.map((tag) => normalizeTagPath(tag)));
  let changed = false;
  const next = rows.map((row) => {
    const semanticState: NavigationSemanticState = row.kind === "folder"
      ? !isBoxScope(scope) && row.ref === scope.path
        ? "current-range" : "none"
      : row.kind === "box"
        ? isBoxScope(scope) && row.ref === scope.boxId ? "current-range" : "none"
        : row.kind === "tag"
          ? normalizedTags.has(normalizeTagPath(row.ref)) ? "checked-filter" : "none"
          : row.ref === selectedPath ? "active-file" : "none";
    if (semanticState === row.semanticState) return row;
    changed = true;
    return { ...row, semanticState };
  });
  return changed ? next : rows as FavoriteRowModel[];
}

function stripCardFileExtension(fileName: string): string {
  for (const extension of CARD_FILE_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return fileName.slice(0, -extension.length);
    }
  }
  return fileName;
}

export interface FavoriteActionsDeps {
  context: ViewContext;
  /** Owned by `BoxActions`. */
  isBoxMode: () => boolean;
  getActiveBoxId: () => string | null;
  handleBoxCommand: (detail: { command?: unknown; boxId?: unknown }) => void;
  /** Owned by `NavLayoutController`; already folds in path normalization. */
  getFolderTreeCount: (path: string) => { direct: number; recursive: number } | undefined;
  /** Owned by `FolderActions`. */
  resolveFolderFromUiPath: (folderPath: string) => TFolder | null;
  /** Host navigation callback. */
  selectFolderFromNav: (path: string) => Promise<void>;
  requestDestructiveConfirmation: (options: {
    title: string;
    message: string;
    confirmButtonText: string;
  }) => Promise<boolean>;
  /** Delegates to `CardWorkspacePlugin`. */
  openNoteFromCard: (path: string, destination?: OpenDestination) => Promise<void>;
  /** Owned by `ProjectionController`; vault-wide, independent of browse scope. */
  getVaultTagCounts: () => Record<string, number>;
  /** Owned by `TagActions`; activating a favorited tag browses the vault under it. */
  applyTagFilter: (nextTags: string[]) => Promise<void>;
}

/**
 * Favorites CRUD, activation, row-model derivation, and menu wiring — moved
 * behind injected navigation, box, and tag seams.
 */
export class FavoriteActions {
  constructor(private readonly deps: FavoriteActionsDeps) {}

  private get strings(): UiStrings {
    return this.deps.context.getUiStrings();
  }

  async persistFavorites(favorites: FavoriteEntry[]): Promise<void> {
    await this.deps.context.saveSettings({ favorites });
  }

  async toggleFavoriteEntry(kind: FavoriteKind, ref: string): Promise<void> {
    const favorites = this.deps.context.getSettings().favorites ?? [];
    const next = toggleFavorite(favorites, kind, ref);
    if (next === favorites) {
      return;
    }
    await this.persistFavorites(next);
  }

  async moveFavoriteEntry(kind: FavoriteKind, ref: string, delta: -1 | 1): Promise<void> {
    const favorites = this.deps.context.getSettings().favorites ?? [];
    const next = moveFavorite(favorites, kind, ref, delta);
    if (next === favorites) {
      return;
    }
    await this.persistFavorites(next);
  }

  /** Manual drag reorder from the favorites section; persists the new array order. */
  async reorderFavoriteEntries(
    source: Pick<FavoriteEntry, "kind" | "ref">,
    target: Pick<FavoriteEntry, "kind" | "ref">,
    position: FavoriteReorderPosition,
  ): Promise<void> {
    const favorites = this.deps.context.getSettings().favorites ?? [];
    const next = reorderFavorite(favorites, source, target, position);
    if (next === favorites) {
      return;
    }
    await this.persistFavorites(next);
  }

  async clearFavorites(): Promise<void> {
    const favorites = this.deps.context.getSettings().favorites ?? [];
    if (favorites.length === 0) {
      return;
    }

    const strings = this.strings.view.navMenu;
    const confirmed = await this.deps.requestDestructiveConfirmation({
      title: strings.clearFavoritesConfirmTitle,
      message: strings.clearFavoritesConfirmBody(favorites.length),
      confirmButtonText: strings.clearFavoritesConfirm,
    });
    if (!confirmed) {
      return;
    }

    await this.persistFavorites([]);
  }

  handleFavoriteActivate(detail: { favorite?: unknown }): void {
    const favorite = detail.favorite;
    if (typeof favorite !== "object" || favorite === null) {
      return;
    }

    const { kind, ref } = favorite as { kind?: unknown; ref?: unknown };
    if (!isFavoriteKind(kind) || typeof ref !== "string") {
      return;
    }

    if (kind === "folder") {
      void this.deps.selectFolderFromNav(ref);
      return;
    }

    if (kind === "file") {
      void this.deps.openNoteFromCard(ref);
      return;
    }

    if (kind === "tag") {
      void this.activateFavoriteTag(ref);
      return;
    }

    const activeBoxId = this.deps.getActiveBoxId();
    if (ref === activeBoxId) return;
    this.deps.handleBoxCommand({ command: "switch", boxId: ref });
  }

  /** A favorited tag means "show every note with this tag": vault root + that one tag. */
  async activateFavoriteTag(tag: string): Promise<void> {
    await this.deps.selectFolderFromNav("");
    await this.deps.applyTagFilter([tag]);
  }

  /**
   * Every favorite row counts vault-wide, because activating one always leaves the
   * current scope. File rows are the exception: a note is always exactly one note.
   */
  buildFavoriteRowModels(precomputed: { boxSummaries: BoxSummary[] }): FavoriteRowModel[] {
    const settings = this.deps.context.getSettings();
    const favorites = settings.favorites ?? [];
    if (favorites.length === 0) {
      return [];
    }

    const showCounts = settings.showNavItemCounts;
    const hasTagFavorite = favorites.some((entry) => entry.kind === "tag");
    const boxSummaries = precomputed.boxSummaries;
    const activeBoxId = this.deps.getActiveBoxId();
    const isBoxMode = this.deps.isBoxMode();
    const activeFolderPath = scopeDisplayPath(this.deps.context.store.getScope());
    const activeTags = new Set(settings.filter.tags.map((tag) => normalizeTagPath(tag)));

    return favorites.map((entry) => this.buildFavoriteRowModel(entry, {
      showCounts,
      // Only pay for the vault-wide tag walk when a row will actually show one.
      vaultTagCounts: showCounts && hasTagFavorite ? this.deps.getVaultTagCounts() : {},
      includeSubfolders: settings.includeSubfolders,
      boxSummaries,
      activeBoxId,
      isBoxMode,
      activeFolderPath,
      activeTags,
    }));
  }

  buildFavoriteRowModel(
    entry: FavoriteEntry,
    context: {
      showCounts: boolean;
      vaultTagCounts: Record<string, number>;
      includeSubfolders: boolean;
      boxSummaries: BoxSummary[];
      activeBoxId: string | null;
      isBoxMode: boolean;
      activeFolderPath: string;
      activeTags: Set<string>;
    },
  ): FavoriteRowModel {
    const { kind, ref } = entry;

    if (kind === "folder") {
      return {
        kind,
        ref,
        label: ref === "" ? this.strings.toolbar.folderMenu.rootFolder : ref.slice(ref.lastIndexOf("/") + 1),
        icon: ref === "" ? "house" : PLAIN_FOLDER_ICON,
        count: context.showCounts ? this.getFavoriteFolderCount(ref, context.includeSubfolders) : 0,
        semanticState: !context.isBoxMode && ref === context.activeFolderPath ? "current-range" : "none",
        missing: this.deps.resolveFolderFromUiPath(ref) === null,
      };
    }

    if (kind === "file") {
      return {
        kind,
        ref,
        label: stripCardFileExtension(ref.slice(ref.lastIndexOf("/") + 1)),
        icon: getCardFileIcon(resolveCardFileKindFromPath(ref) ?? "markdown"),
        count: 0,
        semanticState: ref === this.deps.context.store.getSelectedPath() ? "active-file" : "none",
        missing: !(this.deps.context.getApp().vault.getAbstractFileByPath(ref) instanceof TFile),
      };
    }

    if (kind === "tag") {
      // Never marked missing: activation browses the whole vault for this tag,
      // so the current folder's tag set says nothing about it. Tags that stop
      // existing vault-wide are pruned from favorites instead.
      return {
        kind,
        ref,
        label: ref,
        icon: "tag",
        count: context.vaultTagCounts[normalizeTagPath(ref)] ?? 0,
        semanticState: context.activeTags.has(normalizeTagPath(ref)) ? "checked-filter" : "none",
        missing: false,
      };
    }

    const summary = context.boxSummaries.find((box) => box.id === ref) ?? null;
    return {
      kind,
      ref,
      label: summary?.name ?? ref,
      icon: "box",
      count: context.showCounts ? (summary?.cardCount ?? 0) : 0,
      semanticState: ref === context.activeBoxId ? "current-range" : "none",
      missing: summary === null,
    };
  }

  /** Mirrors the folder section so the same folder never shows two different numbers. */
  getFavoriteFolderCount(folderPath: string, includeSubfolders: boolean): number {
    const counts = this.deps.getFolderTreeCount(folderPath);
    if (!counts) {
      return 0;
    }
    return includeSubfolders ? counts.recursive : counts.direct;
  }

  async copyFavoritePath(ref: string, mode: "vault" | "system"): Promise<void> {
    if (mode === "vault") {
      await copyPathToClipboard(ref === "" ? "/" : ref, this.strings.noteOps);
      return;
    }

    const systemPath = getSystemPath(this.deps.context.getApp(), ref);
    if (systemPath === null) {
      this.deps.context.notify(this.strings.desktopShell.unavailable);
      return;
    }

    await copyPathToClipboard(systemPath, this.strings.noteOps);
  }

  async revealInSystemExplorer(ref: string): Promise<void> {
    const result = await showInSystemExplorer(this.deps.context.getApp(), ref, this.strings.desktopShell);
    if (!result.ok) {
      this.deps.context.notify(result.error);
    }
  }

  appendCardFavoriteMenuItem(menu: Menu, notePath: string): void {
    const navMenu = this.strings.view.navMenu;
    const favorited = isFavorite(this.deps.context.getSettings().favorites ?? [], "file", notePath);
    menu.addItem((item) => {
      item
        .setTitle(favorited ? navMenu.unfavorite : navMenu.favorite)
        .setIcon(favorited ? "star-off" : "star")
        .onClick(() => {
          void this.toggleFavoriteEntry("file", notePath);
        });
    });
  }
}
