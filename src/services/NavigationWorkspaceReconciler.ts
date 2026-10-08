import { folderParentPath, folderSiblingOrdersEqual, hasFolderSiblingOrder, normalizeFolderDescendingNameSorts, normalizeFolderSiblingOrders, orderFolderSiblings,
  pruneFolderSiblingOrders, rewriteFolderSiblingOrders, type FolderSiblingOrders } from "../folder-sibling-orders";
import { debounce, TFolder, type App } from "obsidian";

import {
  type PartialPluginSettings,
  type PluginSettings,
} from "../settings";
import { normalizeExpandedFolderPaths, normalizeExpandedTagPaths } from "../navigation-expansion-settings";
import { collectVaultTagIndex } from "../view/metadata-utils";
import { isPathAtOrBelow, rewritePathReference, rewritePathListAfterRename } from "../path-references";
import { scheduleIdleTask } from "../search";
import type { VaultMutationEvent } from "./vault-events";

const TAG_RECONCILE_DEBOUNCE_MS = 1000;
const INITIAL_TAG_RECONCILE_IDLE_TIMEOUT_MS = 10_000;

export interface NavigationWorkspaceReconcilerDeps {
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<unknown>;
  getApp: () => App;
  onStep?: (step: string) => void;
  scheduleIdle?: (task: () => void, timeoutMs: number) => () => void;
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
    paths.map((path) => rewritePathReference(path, oldPath, newPath)),
  );
}

/** Validate only persisted references; never enumerate the vault at startup. */
export function reconcileFolderSiblingOrders(app: App, orders: FolderSiblingOrders): FolderSiblingOrders {
  return Object.fromEntries(Object.entries(normalizeFolderSiblingOrders(orders)).flatMap(([parent, paths]) => {
    const folder = parent === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(parent);
    if (!(folder instanceof TFolder)) return [];
    return [[parent, paths.filter((path) => app.vault.getAbstractFileByPath(path) instanceof TFolder)]];
  }));
}

/** A folder added while the plugin was disabled may still be in the name-sorted tail.
 * Capture that tail's pre-rename order so even an unrecorded sibling keeps its position.
 */
function captureUnrecordedRenameOrder(app: App, orders: FolderSiblingOrders, oldPath: string, newPath: string): FolderSiblingOrders {
  const parent = folderParentPath(oldPath);
  if (parent !== folderParentPath(newPath) || !hasFolderSiblingOrder(orders, parent) || orders[parent].includes(oldPath)) return orders;
  const folder = parent === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(parent);
  if (!(folder instanceof TFolder)) return orders;
  const siblings = folder.children.filter((child): child is TFolder => child instanceof TFolder).map((child) => {
    const path = child.path === newPath ? oldPath : child.path;
    return { path, name: path.slice(path.lastIndexOf("/") + 1) };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return { ...orders, [parent]: orderFolderSiblings(siblings, orders, parent).map((child) => child.path) };
}

export class NavigationWorkspaceReconciler {
  private readonly getSettings: () => PluginSettings;
  private readonly saveSettings: (patch: PartialPluginSettings) => Promise<unknown>;
  private readonly getApp: () => App;
  private readonly onStep?: (step: string) => void;
  private readonly scheduleIdle: (task: () => void, timeoutMs: number) => () => void;
  private disposed = false;
  private generation = 0;
  private cancelInitialTagIdle: (() => void) | null = null;
  private readonly debouncedTagReconcile: (() => void) & { cancel: () => void };

  constructor(deps: NavigationWorkspaceReconcilerDeps) {
    this.getSettings = deps.getSettings;
    this.saveSettings = deps.saveSettings;
    this.getApp = deps.getApp;
    this.onStep = deps.onStep;
    this.scheduleIdle = deps.scheduleIdle ?? scheduleIdleTask;
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
    if (this.disposed || generation !== this.generation) return;
    const folderSiblingOrders = reconcileFolderSiblingOrders(this.getApp(), settings.folderSiblingOrders);
    const folderDescendingNameSorts = normalizeFolderDescendingNameSorts(settings.folderDescendingNameSorts)
      .filter((parent) => hasFolderSiblingOrder(folderSiblingOrders, parent));
    const patch: PartialPluginSettings = {};
    if (!arraysEqual(folders, settings.expandedFolderPaths)) patch.expandedFolderPaths = folders;
    if (!folderSiblingOrdersEqual(folderSiblingOrders, settings.folderSiblingOrders)) patch.folderSiblingOrders = folderSiblingOrders;
    if (!arraysEqual(folderDescendingNameSorts, settings.folderDescendingNameSorts)) patch.folderDescendingNameSorts = folderDescendingNameSorts;
    if (Object.keys(patch).length > 0) await this.saveSettings(patch);
    if (this.disposed || generation !== this.generation) return;

    this.cancelInitialTagIdle?.();
    this.cancelInitialTagIdle = this.scheduleIdle(() => {
      void this.reconcileInitialTags(generation).catch((error: unknown) => {
        if (!this.disposed) console.warn("[Card Workspace] Navigation Tag reconciliation failed.", error);
      });
    }, INITIAL_TAG_RECONCILE_IDLE_TIMEOUT_MS);
  }

  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    if (this.disposed) return;
    this.onStep?.("navigation");
    let persist: Promise<unknown> | null = null;
    if (event.isFolder && event.eventType === "rename" && event.oldPath !== null) {
      const oldPath = event.oldPath;
      const settings = this.getSettings();
      const lastFolderPath = rewritePathReference(
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
      const hiddenFolderPaths = rewritePathListAfterRename(settings.hiddenFolderPaths, oldPath, event.path, "at-or-below");
      if (hiddenFolderPaths !== settings.hiddenFolderPaths) patch.hiddenFolderPaths = hiddenFolderPaths;
      if (lastFolderPath !== settings.lastFolderPath) patch.lastFolderPath = lastFolderPath;
      if (!arraysEqual(expandedFolderPaths, settings.expandedFolderPaths)) {
        patch.expandedFolderPaths = expandedFolderPaths;
      }
      const previousOrders = captureUnrecordedRenameOrder(this.getApp(), settings.folderSiblingOrders, event.oldPath, event.path);
      const folderSiblingOrders = rewriteFolderSiblingOrders(previousOrders, event.oldPath, event.path);
      if (!folderSiblingOrdersEqual(folderSiblingOrders, settings.folderSiblingOrders)) patch.folderSiblingOrders = folderSiblingOrders;
      const folderDescendingNameSorts = normalizeFolderDescendingNameSorts(settings.folderDescendingNameSorts
        .map((parent) => rewritePathReference(parent, oldPath, event.path)));
      if (!arraysEqual(folderDescendingNameSorts, settings.folderDescendingNameSorts)) patch.folderDescendingNameSorts = folderDescendingNameSorts;
      if (Object.keys(patch).length > 0) persist = this.saveSettings(patch);
    } else if (event.isFolder && event.eventType === "delete") {
      const settings = this.getSettings();
      const expandedFolderPaths = reconcileExpandedFolders(this.getApp(), settings.expandedFolderPaths);
      const patch: PartialPluginSettings = {};
      if (!arraysEqual(expandedFolderPaths, settings.expandedFolderPaths)) patch.expandedFolderPaths = expandedFolderPaths;
      const folderSiblingOrders = pruneFolderSiblingOrders(settings.folderSiblingOrders, event.path);
      if (!folderSiblingOrdersEqual(folderSiblingOrders, settings.folderSiblingOrders)) patch.folderSiblingOrders = folderSiblingOrders;
      const folderDescendingNameSorts = settings.folderDescendingNameSorts.filter((parent) => !isPathAtOrBelow(parent, event.path));
      if (!arraysEqual(folderDescendingNameSorts, settings.folderDescendingNameSorts)) patch.folderDescendingNameSorts = folderDescendingNameSorts;
      if (Object.keys(patch).length > 0) persist = this.saveSettings(patch);
    } else if (event.isFolder && event.eventType === "create") {
      const orders = this.getSettings().folderSiblingOrders;
      const parent = folderParentPath(event.path);
      if (hasFolderSiblingOrder(orders, parent) && !orders[parent].includes(event.path)) {
        persist = this.saveSettings({ folderSiblingOrders: { ...orders, [parent]: [...orders[parent], event.path] } });
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
    this.cancelInitialTagIdle?.();
    this.cancelInitialTagIdle = null;
    this.debouncedTagReconcile.cancel();
  }

  private async reconcileInitialTags(generation: number): Promise<void> {
    if (this.disposed || generation !== this.generation) return;
    const settings = this.getSettings();
    const vaultTags = collectVaultTagIndex(this.getApp());
    if (vaultTags === null || this.disposed || generation !== this.generation) return;
    const expandedTagPaths = normalizeExpandedTagPaths(
      settings.expandedTagPaths.filter((path) => vaultTags.tagPaths.has(path)),
    );
    if (this.disposed || generation !== this.generation) return;
    if (!arraysEqual(expandedTagPaths, settings.expandedTagPaths)) {
      await this.saveSettings({ expandedTagPaths });
    }
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
