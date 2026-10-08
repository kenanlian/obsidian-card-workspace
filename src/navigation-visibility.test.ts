import { describe, expect, it, vi } from "vitest";
import { TFolder, type App } from "obsidian";
import { collectNavigationVisibilityPaths } from "./navigation-visibility-inventory";
import {
  hiddenPathAncestor, mergeHiddenPathDraft, normalizeHiddenFolderPaths,
  normalizeHiddenTagPaths, normalizeHiddenNavSections, rewriteHiddenTagsAfterRename,
} from "./navigation-visibility";
import { DEFAULT_SETTINGS, mergeSettings, migrateSettings } from "./settings";
import { serializeSettings, SettingsStore } from "./services/SettingsStore";
import { UnsupportedSettingsSchemaError } from "./settings-schema";

describe("navigation visibility settings", () => {
  it("defaults old documents to no hidden entries and normalizes junk without collapsing child records", () => {
    for (const raw of [undefined, {}, { schemaVersion: 2, preferences: {}, userData: {} }]) {
      const settings = migrateSettings(raw);
      expect(settings.hiddenFolderPaths).toEqual([]);
      expect(settings.hiddenTagPaths).toEqual([]);
      expect(settings.hiddenNavSections).toEqual([]);
    }
    expect(normalizeHiddenFolderPaths(["work", "work/child", "work", "/", "", null, 1, "../bad", "bad\0path", "a\\b"]))
      .toEqual(["a/b", "work", "work/child"]);
    expect(normalizeHiddenTagPaths(["#Work/ Child", "work/child", "work", "/", {}, "..", ""]))
      .toEqual(["work", "work/child"]);
    expect(normalizeHiddenNavSections(["tags", "folders", "tags", "bad", null]))
      .toEqual(["folders", "tags"]);
  });

  it("round trips through the intended layers in schema 2 and restores missing records", async () => {
    let persisted: unknown;
    const store = new SettingsStore({ load: async () => undefined, save: async (data) => { persisted = data; } });
    await store.init();
    expect(await store.updateFlat({ hiddenFolderPaths: ["missing", "missing/child"], hiddenTagPaths: ["#gone"], hiddenNavSections: ["links"] }))
      .toBe("patch");
    const document = serializeSettings(store.getFlat());
    expect(document.schemaVersion).toBe(2);
    expect(document.preferences.hiddenNavSections).toEqual(["links"]);
    expect(document.userData.hiddenFolderPaths).toEqual(["missing", "missing/child"]);
    expect(document.userData.hiddenTagPaths).toEqual(["gone"]);
    expect(document.workspace).not.toHaveProperty("hiddenTagPaths");
    const restored = new SettingsStore({ load: async () => persisted, save: vi.fn() });
    await restored.init();
    expect(restored.getFlat()).toEqual(store.getFlat());
    expect(migrateSettings({ hiddenFolderPaths: ["legacy"], hiddenTagPaths: ["#Tag"], hiddenNavSections: ["boxes"] }))
      .toMatchObject({ hiddenFolderPaths: ["legacy"], hiddenTagPaths: ["tag"], hiddenNavSections: ["boxes"] });
  });

  it("rejects visibility writes for future schemas and never flushes over the document", async () => {
    const save = vi.fn();
    const store = new SettingsStore({ load: async () => ({ schemaVersion: 3 }), save });
    await store.init();
    await expect(store.updateFlat({ hiddenFolderPaths: ["A"], hiddenTagPaths: ["tag"], hiddenNavSections: ["tags"] }))
      .rejects.toBeInstanceOf(UnsupportedSettingsSchemaError);
    await store.flushPendingWrites();
    expect(store.getFlat()).toEqual(DEFAULT_SETTINGS);
    expect(save).not.toHaveBeenCalled();
  });

  it("retains explicit child rules and merges only draft differences with concurrent edits", () => {
    expect(hiddenPathAncestor("work/child", ["work", "work/child"])).toBe("work");
    expect(hiddenPathAncestor("workspace", ["work"])).toBeNull();
    expect(hiddenPathAncestor("work/child", ["work/child"])).toBeNull();
    expect(mergeHiddenPathDraft(["work", "work/child", "concurrent"], ["work", "work/child"], new Set(["work/child", "added"])))
      .toEqual(["work/child", "concurrent", "added"]);
    expect(mergeSettings(DEFAULT_SETTINGS, { hiddenFolderPaths: ["work", "work/child"] }).hiddenFolderPaths)
      .toEqual(["work", "work/child"]);
  });

  it("rewrites tag descendants and keeps original rules when a rename only partly succeeds", () => {
    const hidden = ["a", "a/child", "ab", "x/child"];
    expect(rewriteHiddenTagsAfterRename(hidden, "a", "x", false)).toEqual(["ab", "x", "x/child"]);
    expect(rewriteHiddenTagsAfterRename(hidden, "a", "x", true)).toEqual(["a", "a/child", "ab", "x", "x/child"]);
  });
});

describe("navigation visibility inventory", () => {
  it("collects folders and cached tags across the vault, including synthetic parents, without body reads", () => {
    const child = Object.assign(new TFolder(), { path: "A/child", children: [] });
    const parent = Object.assign(new TFolder(), { path: "A", children: [child] });
    const root = Object.assign(new TFolder(), { path: "", children: [parent] });
    const cachedRead = vi.fn();
    const getFileCache = vi.fn(() => ({ tags: [{ tag: "#Work/Child" }] }));
    const app = { vault: { getRoot: () => root, getMarkdownFiles: () => [{ path: "outside/note.md" }], cachedRead },
      metadataCache: { getFileCache } } as unknown as App;
    expect(collectNavigationVisibilityPaths(app, "folders")).toEqual(["A", "A/child"]);
    expect(collectNavigationVisibilityPaths(app, "tags")).toEqual(["work", "work/child"]);
    expect(getFileCache).toHaveBeenCalledTimes(1);
    expect(cachedRead).not.toHaveBeenCalled();
  });
});
