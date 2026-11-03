import { iconTargetKey, parseIconTargetKey, type IconOverrides } from "../icon-config";
import { validateIconPickers } from "../icon-picker/IconPicker";
import { isPathAtOrBelow, rewritePathReference } from "../path-references";
import type { PartialPluginSettings, PluginSettings } from "../settings";
import type { VaultMutationEvent } from "./vault-events";

export function reconcileIconPaths(current: IconOverrides, event: VaultMutationEvent): IconOverrides {
  if (event.eventType !== "rename" && event.eventType !== "delete") return current;
  const from = event.eventType === "rename" ? event.oldPath : event.path;
  if (from === null) return current;
  const next = { ...current };
  let changed = false;
  for (const [key, spec] of Object.entries(current)) {
    const target = parseIconTargetKey(key);
    if (!target || (target.kind !== "file" && target.kind !== "folder")) continue;
    if (!(event.isFolder ? isPathAtOrBelow(target.ref, from) : target.kind === "file" && target.ref === from)) continue;
    const ref = event.eventType === "rename" ? rewritePathReference(target.ref, from, event.path) : null;
    if (ref === target.ref) continue;
    changed = true; delete next[key];
    if (ref !== null) {
      const mapped = iconTargetKey({ kind: target.kind, ref });
      if (!Object.prototype.hasOwnProperty.call(current, mapped)) next[mapped] = spec;
    }
  }
  return changed ? next : current;
}
/** No opportunistic pruning; only explicit path events and definition deletion clean icons. */
export class IconReconciler {
  constructor(private readonly deps: { getSettings: () => PluginSettings; saveSettings: (patch: PartialPluginSettings) => Promise<void> }) {}
  reconcileDefinitions(previous: PluginSettings, patch: PartialPluginSettings): PartialPluginSettings {
    const removedBoxes = new Set(previous.boxes.filter(box => patch.boxes !== undefined && !patch.boxes.some(next => next.id === box.id)).map(box => box.id));
    const removedTemplates = new Set(previous.noteTemplates.filter(template => patch.noteTemplates !== undefined && !patch.noteTemplates.some(next => next.id === template.id)).map(template => template.id));
    if (!removedBoxes.size && !removedTemplates.size) return patch;
    const current = patch.iconOverrides ?? previous.iconOverrides;
    const next = { ...current };
    for (const key of Object.keys(current)) {
      const target = parseIconTargetKey(key);
      if ((target?.kind === "box" && removedBoxes.has(target.ref)) || (target?.kind === "template" && removedTemplates.has(target.ref))) delete next[key];
    }
    return { ...patch, iconOverrides: next };
  }
  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    validateIconPickers();
    const current = this.deps.getSettings().iconOverrides;
    const next = reconcileIconPaths(current, event);
    if (next !== current) await this.deps.saveSettings({ iconOverrides: next });
  }
}
