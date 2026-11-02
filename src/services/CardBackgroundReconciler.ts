import { isPathAtOrBelow, rewritePathReference } from "../path-references";
import type { PartialPluginSettings, PluginSettings } from "../settings";
import type { VaultMutationEvent } from "./vault-events";

export class CardBackgroundReconciler {
  constructor(private readonly deps: { getSettings: () => PluginSettings; saveSettings: (patch: PartialPluginSettings) => Promise<unknown> }) {}
  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    if (event.eventType !== "rename" && event.eventType !== "delete") return;
    if (event.eventType === "rename" && event.oldPath === null) return;
    const current = this.deps.getSettings().cardBackgroundOverrides;
    const next = { ...current };
    const moved: typeof next = {};
    let changed = false;
    for (const [path, color] of Object.entries(current)) {
      const target: string = event.eventType === "rename" ? event.oldPath! : event.path;
      if (!(event.isFolder ? isPathAtOrBelow(path, target) : path === target)) continue;
      const newPath = event.eventType === "rename" ? rewritePathReference(path, target, event.path) : null;
      if (newPath === path) continue;
      delete next[path];
      if (newPath !== null) moved[newPath] = color;
      changed = true;
    }
    if (changed) await this.deps.saveSettings({ cardBackgroundOverrides: { ...next, ...moved } });
  }
}
