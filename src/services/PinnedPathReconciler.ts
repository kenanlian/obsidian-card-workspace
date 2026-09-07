import { prunePathList, rewritePathListAfterRename } from "../path-references";
import type { PartialPluginSettings, PluginSettings } from "../settings";
import type { VaultMutationEvent } from "./vault-events";

export interface PinnedPathReconcilerDeps {
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<unknown>;
  onStep?: (step: string) => void;
}

/**
 * Owns global `settings.pinnedPaths` reconciliation against vault rename and
 * delete events, using the shared path-boundary contract:
 *
 * - `create` and `modify` are no-ops, and a rename without an old path is
 *   ignored;
 * - file rename rewrites exact matches; folder rename rewrites exact and
 *   descendant paths at a `/` boundary;
 * - file delete removes exact matches; folder delete removes exact and
 *   descendant paths;
 * - a semantic no-op performs no settings write and no view update.
 *
 * A change persists through `saveSettings({ pinnedPaths })`, so open folder
 * views receive the existing `reproject` intent; Box views may harmlessly
 * receive the scope-aware intent result but keep using their Box-local pins.
 */
export class PinnedPathReconciler {
  onStep?: (step: string) => void;

  private readonly getSettings: () => PluginSettings;
  private readonly saveSettings: (patch: PartialPluginSettings) => Promise<unknown>;

  constructor(deps: PinnedPathReconcilerDeps) {
    this.getSettings = deps.getSettings;
    this.saveSettings = deps.saveSettings;
    this.onStep = deps.onStep;
  }

  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    this.onStep?.("pinnedPaths");
    if (event.eventType !== "rename" && event.eventType !== "delete") {
      return;
    }

    const pinnedPaths = this.getSettings().pinnedPaths;
    if (pinnedPaths.length === 0) {
      return;
    }

    let nextPinnedPaths = pinnedPaths;
    if (event.eventType === "rename") {
      if (event.oldPath === null) {
        return;
      }
      nextPinnedPaths = rewritePathListAfterRename(
        pinnedPaths,
        event.oldPath,
        event.path,
        event.isFolder ? "at-or-below" : "exact",
      );
    } else {
      nextPinnedPaths = prunePathList(
        pinnedPaths,
        event.path,
        event.isFolder ? "at-or-below" : "exact",
      );
    }

    if (nextPinnedPaths === pinnedPaths) {
      return;
    }

    await this.saveSettings({ pinnedPaths: nextPinnedPaths });
  }
}
