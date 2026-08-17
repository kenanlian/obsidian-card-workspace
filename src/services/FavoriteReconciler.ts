import { debounce, type App } from "obsidian";

import type { PluginSettings } from "../settings";
import { pruneFavoriteTags, reconcileFavoritesForVaultMutation } from "../view/favorites";
import { collectVaultTagIndex } from "../view/metadata-utils";
import type { UserDataSettings } from "./SettingsStore";
import type { VaultMutationEvent } from "./vault-events";

export interface FavoriteReconcilerDeps {
  getSettings: () => PluginSettings;
  updateUserData: (patch: Partial<UserDataSettings>) => Promise<unknown>;
  onUserDataReconciled: () => void;
  getApp: () => App;
  onStep?: (step: string) => void;
}

/**
 * Owns favorite path rewrite and delayed tag prune against vault mutations.
 * Favorites reconcile and tag-prune queue share one bus listener (C12).
 */
export class FavoriteReconciler {
  onStep?: (step: string) => void;

  private readonly getSettings: () => PluginSettings;
  private readonly updateUserData: (patch: Partial<UserDataSettings>) => Promise<unknown>;
  private readonly onUserDataReconciled: () => void;
  private readonly getApp: () => App;
  // Longer than the other vault-change debouncers: this one walks every markdown
  // file's cache, and the cache lags the vault events that trigger it.
  private debouncedFavoriteTagPrune = debounce(
    () => {
      this.pruneFavoriteTagsNow();
    },
    1000,
    false,
  );

  constructor(deps: FavoriteReconcilerDeps) {
    this.getSettings = deps.getSettings;
    this.updateUserData = deps.updateUserData;
    this.onUserDataReconciled = deps.onUserDataReconciled;
    this.getApp = deps.getApp;
    this.onStep = deps.onStep;
  }

  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    this.onStep?.("favorites");
    const persist = this.reconcileFavoritesForVaultMutation(event);
    this.onStep?.("tagPrune");
    this.queueFavoriteTagPrune(event);
    await persist;
  }

  dispose(): void {
    const favoriteTagPrune = this.debouncedFavoriteTagPrune as (() => void) & {
      cancel?: () => void;
    };
    favoriteTagPrune.cancel?.();
  }

  private async reconcileFavoritesForVaultMutation(event: VaultMutationEvent): Promise<void> {
    const favorites = this.getSettings().favorites;
    if (favorites.length === 0) {
      return;
    }

    if (event.eventType !== "rename" && event.eventType !== "delete") {
      return;
    }

    const nextFavorites = reconcileFavoritesForVaultMutation(favorites, {
      eventType: event.eventType,
      path: event.path,
      oldPath: event.oldPath,
      isFolder: event.isFolder,
    });

    if (nextFavorites === favorites) {
      return;
    }

    const persist = this.updateUserData({ favorites: nextFavorites });
    this.onUserDataReconciled();
    await persist;
  }

  /**
   * `create` is skipped on purpose: it can only add tags, and the metadata cache
   * may not have parsed the new file yet, which would look like a vanished tag.
   */
  private queueFavoriteTagPrune(event: VaultMutationEvent): void {
    if (event.eventType === "create") {
      return;
    }

    if (!this.getSettings().favorites.some((entry) => entry.kind === "tag")) {
      return;
    }

    this.debouncedFavoriteTagPrune();
  }

  private pruneFavoriteTagsNow(): void {
    const favorites = this.getSettings().favorites;
    if (!favorites.some((entry) => entry.kind === "tag")) {
      return;
    }

    const vaultTags = collectVaultTagIndex(this.getApp());
    if (vaultTags === null) {
      return;
    }

    const nextFavorites = pruneFavoriteTags(favorites, vaultTags.tagPaths);
    if (nextFavorites === favorites) {
      return;
    }

    void this.updateUserData({ favorites: nextFavorites });
    this.onUserDataReconciled();
  }
}
