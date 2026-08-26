import { debounce, TFolder, type App } from "obsidian";

import {
  type PartialPluginSettings,
  type PluginSettings,
} from "../settings";
import { normalizeExpandedFolderPaths, normalizeExpandedTagPaths } from "../navigation-expansion-settings";
import { collectVaultTagIndex } from "../view/metadata-utils";
import { rewritePathAfterRename } from "../view/scope-files";
import type { VaultMutationEvent } from "./vault-events";

const TAG_RECONCILE_DEBOUNCE_MS = 1000;

export interface NavigationWorkspaceReconcilerDeps {
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<unknown>;
  getApp: () => App;
  onStep?: (step: string) => void;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function reconcileExpandedFolders(app: App, paths: readonly string[]): string[] {
  const canonical = new Set<string>();
  for (const path of normalizeExpandedFolderPaths(paths)) {
    const file = app.vault.getAbstractFileByPath(path);
    if (file instanceof TFolder && file.path.length > 0) canonical.add(file.path);
  }
  return normalizeExpandedFolderPaths([...canonical]);
}

export function rewriteExpandedFoldersAfterRename(
  paths: readonly string[],
  oldPath: string,
  newPath: string,
): string[] {
  return normalizeExpandedFolderPaths(
    paths.map((path) => rewritePathAfterRename(path, oldPath, newPath)),
  );
}

export class NavigationWorkspaceReconciler {
  private readonly getSettings: () => PluginSettings;
  private readonly saveSettings: (patch: PartialPluginSettings) => Promise<unknown>;
  private readonly getApp: () => App;
  private readonly onStep?: (step: string) => void;
  private disposed = false;
  private generation = 0;
  private readonly debouncedTagReconcile: (() => void) & { cancel: () => void };

  constructor(deps: NavigationWorkspaceReconcilerDeps) {
    this.getSettings = deps.getSettings;
    this.saveSettings = deps.saveSettings;
    this.getApp = deps.getApp;
    this.onStep = deps.onStep;
    this.debouncedTagReconcile = debounce(
      () => {
        void this.reconcileTags().catch((error: unknown) => {
          if (!this.disposed) console.warn("[Card Workspace] Navigation Tag reconciliation failed.", error);
        });
      },
      TAG_RECONCILE_DEBOUNCE_MS,
      false,
    );
  }

  async reconcileInitial(): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    await Promise.resolve();
    if (this.disposed || generation !== this.generation) return;
    const settings = this.getSettings();
    const folders = reconcileExpandedFolders(this.getApp(), settings.expandedFolderPaths);
    const vaultTags = collectVaultTagIndex(this.getApp());
    const tags = vaultTags === null
      ? settings.expandedTagPaths
      : normalizeExpandedTagPaths(
        settings.expandedTagPaths.filter((path) => vaultTags.tagPaths.has(path)),
      );
    if (this.disposed || generation !== this.generation) return;

    const patch: PartialPluginSettings = {};
    if (!arraysEqual(folders, settings.expandedFolderPaths)) patch.expandedFolderPaths = folders;
    if (!arraysEqual(tags, settings.expandedTagPaths)) patch.expandedTagPaths = tags;
    if (Object.keys(patch).length > 0) await this.saveSettings(patch);
  }

  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    if (this.disposed) return;
    this.onStep?.("navigation");
    let persist: Promise<unknown> | null = null;
    if (event.isFolder && event.eventType === "rename" && event.oldPath !== null) {
      const settings = this.getSettings();
      const lastFolderPath = rewritePathAfterRename(
        settings.lastFolderPath,
        event.oldPath,
        event.path,
      );
      const expandedFolderPaths = rewriteExpandedFoldersAfterRename(
        settings.expandedFolderPaths,
        event.oldPath,
        event.path,
      );
      const patch: PartialPluginSettings = {};
      if (lastFolderPath !== settings.lastFolderPath) patch.lastFolderPath = lastFolderPath;
      if (!arraysEqual(expandedFolderPaths, settings.expandedFolderPaths)) {
        patch.expandedFolderPaths = expandedFolderPaths;
      }
      if (Object.keys(patch).length > 0) persist = this.saveSettings(patch);
    } else if (event.isFolder && event.eventType === "delete") {
      const settings = this.getSettings();
      const expandedFolderPaths = reconcileExpandedFolders(this.getApp(), settings.expandedFolderPaths);
      if (!arraysEqual(expandedFolderPaths, settings.expandedFolderPaths)) {
        persist = this.saveSettings({ expandedFolderPaths });
      }
    }

    if (event.eventType !== "create" && this.getSettings().expandedTagPaths.length > 0) {
      this.debouncedTagReconcile();
    }
    await persist;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.debouncedTagReconcile.cancel();
  }

  private async reconcileTags(): Promise<void> {
    if (this.disposed) return;
    const generation = this.generation;
    const settings = this.getSettings();
    const vaultTags = collectVaultTagIndex(this.getApp());
    if (vaultTags === null || this.disposed || generation !== this.generation) return;
    const expandedTagPaths = normalizeExpandedTagPaths(
      settings.expandedTagPaths.filter((path) => vaultTags.tagPaths.has(path)),
    );
    if (!arraysEqual(expandedTagPaths, settings.expandedTagPaths)) {
      await this.saveSettings({ expandedTagPaths });
    }
  }
}
