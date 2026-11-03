import { describe, expect, it, vi } from "vitest";
import { iconTargetKey, type IconSpec } from "../icon-config";
import { migrateSettings } from "../settings";
import { IconReconciler, reconcileIconPaths } from "./IconReconciler";
import type { VaultMutationEvent } from "./vault-events";
const key = (kind: "folder" | "file" | "template", ref: string) => iconTargetKey({ kind, ref });
const icon: IconSpec = { kind: "emoji", value: "📘" };
const other: IconSpec = { kind: "lucide", value: "heart" };
const renamed: VaultMutationEvent = { eventType: "rename", path: "New", oldPath: "Old", isFolder: true, fileKind: null };
describe("plugin-level icon reconciliation", () => {
  it("rewrites folder descendants and files on a boundary, preserves conflicts and unrelated identities", () => {
    const before = { [key("folder", "")]: icon, [key("folder", "Old")]: icon, [key("file", "Old/a.md")]: icon, [key("folder", "Old/sub")]: icon, [key("file", "Older/a.md")]: icon, [key("file", "New/a.md")]: other, [key("template", "Old/a.md")]: icon };
    const after = reconcileIconPaths(before, renamed);
    expect(after).toEqual({ [key("folder", "")]: icon, [key("folder", "New")]: icon, [key("folder", "New/sub")]: icon, [key("file", "Older/a.md")]: icon, [key("file", "New/a.md")]: other, [key("template", "Old/a.md")]: icon });
    expect(reconcileIconPaths(after, { ...renamed, eventType: "delete", path: "New" })).toEqual({ [key("folder", "")]: icon, [key("file", "Older/a.md")]: icon, [key("template", "Old/a.md")]: icon });
  });
  it("renames/deletes only the exact file identity, and does nothing on modify", () => {
    const before = { [key("file", "Old/a.md")]: icon, [key("file", "Old/a.md/child")]: other };
    expect(reconcileIconPaths(before, { ...renamed, path: "b.md", oldPath: "Old/a.md", isFolder: false })).toEqual({ [key("file", "b.md")]: icon, [key("file", "Old/a.md/child")]: other });
    expect(reconcileIconPaths(before, { ...renamed, eventType: "modify" })).toBe(before);
  });
  it("saves only changed overrides", async () => {
    const settings = migrateSettings({ iconOverrides: { [key("file", "Old/a.md")]: icon } });
    const saveSettings = vi.fn(async () => {});
    const reconciler = new IconReconciler({ getSettings: () => settings, saveSettings });
    await reconciler.handleVaultMutation({ ...renamed, eventType: "modify" }); expect(saveSettings).not.toHaveBeenCalled();
    await reconciler.handleVaultMutation(renamed); expect(saveSettings).toHaveBeenCalledWith({ iconOverrides: { [key("file", "New/a.md")]: icon } });
  });
  it("retains stable box/template IDs on rename, then cleans only explicitly removed definitions", () => {
    const settings = migrateSettings({ boxes: [{ id: "b", name: "Old" }], noteTemplates: [{ id: "t", filePath: "Missing.md" }],
      iconOverrides: { '["box","b"]': icon, [key("template", "t")]: icon, [key("file", "Missing.md")]: other } });
    const reconciler = new IconReconciler({ getSettings: () => settings, saveSettings: async () => {} });
    const rename = { boxes: settings.boxes.map(box => ({ ...box, name: "Renamed" })) };
    expect(reconciler.reconcileDefinitions(settings, rename)).toBe(rename);
    expect(reconciler.reconcileDefinitions(settings, { boxes: [], noteTemplates: [] })).toEqual({ boxes: [], noteTemplates: [], iconOverrides: { [key("file", "Missing.md")]: other } });
    expect(reconciler.reconcileDefinitions(settings, { previewLines: 0 })).toEqual({ previewLines: 0 });
  });

});
