import { describe, expect, it, vi } from "vitest";
import { RECENT_ICON_LIMIT, iconSpecEquals, iconTargetKey, normalizeEmojiSkinTone, normalizeRecentIcons, pushRecentIcon, normalizeIconDefaults, normalizeIconOverrides, normalizeIconSpec, parseIconTargetKey, resolveContentIcon, rewriteTagIconOverrides, type IconSpec, type IconTarget } from "./icon-config";
import { navigationIconTarget } from "./view/content-icon-target";
import { migrateSettings, mergeSettings } from "./settings";
import { SettingsStore, serializeSettings } from "./services/SettingsStore";
import { resolveSettingsUpdateIntent } from "./view/update-intent";

const heart: IconSpec = { kind: "emoji", value: "❤️" };
const sun: IconSpec = { kind: "lucide", value: "sun" };
const key = (kind: "folder" | "file" | "tag" | "box" | "template", ref: string) => iconTargetKey({ kind, ref });

describe("content icon identity and resolution", () => {
  it("resolves item, category, built-in in order; parents never inherit", () => {
    const settings = { iconDefaults: { folder: sun }, iconOverrides: { [key("folder", "A")]: heart } };
    expect(resolveContentIcon(settings, { kind: "folder", ref: "A" })).toEqual(heart);
    expect(resolveContentIcon(settings, { kind: "folder", ref: "A/B" })).toEqual(sun);
    expect(resolveContentIcon({}, { kind: "folder", ref: "A/B" }, "folder-closed")).toEqual({ kind: "lucide", value: "folder-closed" });
    expect(resolveContentIcon({ iconOverrides: { [key("tag", "work")]: heart } }, { kind: "tag", ref: "work/project" })).toEqual({ kind: "lucide", value: "tag" });
    expect(resolveContentIcon({ iconOverrides: { [iconTargetKey({ kind: "property", ref: "status" })]: heart } }, { kind: "property-value", ref: "status", value: { kind: "text", value: "done" } })).toEqual({ kind: "lucide", value: "dot" });
  });
  it("normalizes vault root and favorite aliases; templates are independent of their file", () => {
    expect(key("folder", "/")).toBe(key("folder", ""));
    for (const kind of ["folder", "file", "tag", "box"] as const) {
      const target = navigationIconTarget({ section: "favorites", scope: "item", favorite: { kind, ref: "x" } })!;
      expect(iconTargetKey(target)).toBe(key(kind, "x"));
    }
    expect(key("file", "template.md")).not.toBe(key("template", "template.md"));
    const settings = { iconOverrides: { [key("file", "template.md")]: heart } };
    expect(resolveContentIcon(settings, { kind: "template", ref: "template.md" })).not.toEqual(heart);
  });
  it("round-trips collision-free property identities including missing, punctuation and Unicode", () => {
    const targets: IconTarget[] = [
      { kind: "property", ref: " Status " },
      ...([{ kind: "text", value: "1" }, { kind: "number", value: 1 }, { kind: "boolean", value: true }, { kind: "missing" }, { kind: "text", value: '["m"]:中文' }] as const).map(value => ({ kind: "property-value" as const, ref: "status", value })),
    ];
    expect(new Set(targets.map(iconTargetKey)).size).toBe(targets.length);
    for (const target of targets) expect(iconTargetKey(parseIconTargetKey(iconTargetKey(target))!)).toBe(iconTargetKey(target));
    expect(parseIconTargetKey('["property-value","status","oops"]')).toBeNull();
  });
  it("defends malformed data without parsing emoji catalogue or dropping unavailable Lucide IDs", () => {
    for (const value of [null, [], {}, { kind: "lucide", value: "<svg>" }, { kind: "emoji", value: "😀😀" }, { kind: "emoji", value: "abc" }, { kind: "emoji", value: "<img>😀" }]) expect(normalizeIconSpec(value)).toBeNull();
    for (const value of ["🇨🇳", "👨‍👩‍👧‍👦", "👩🏽‍💻", "1️⃣"]) expect(normalizeIconSpec({ kind: "emoji", value })).toEqual({ kind: "emoji", value });
    expect(normalizeIconDefaults({ folder: heart, nonCategory: sun, tag: null })).toEqual({ folder: heart });
    expect(normalizeIconOverrides({ broken: heart, [key("folder", "")]: { kind: "lucide", value: "future-host-icon" } })).toEqual({ [key("folder", "")]: { kind: "lucide", value: "future-host-icon" } });
  });
});

describe("icon persistence and patch isolation", () => {
  it("round-trips v2 layers and clears the last override/default with empty maps", async () => {
    const save = vi.fn(async () => {});
    const store = new SettingsStore({ load: async () => null, save }); await store.init();
    expect(store.getFlat().iconDefaults).toEqual({});
    await store.updateFlat({ iconDefaults: { folder: heart }, iconOverrides: { [key("file", "a.md")]: sun } });
    const document = serializeSettings(store.getFlat());
    expect(document.schemaVersion).toBe(2);
    expect(document.preferences.iconDefaults).toEqual({ folder: heart });
    expect(document.userData.iconOverrides).toEqual({ [key("file", "a.md")]: sun });
    expect(migrateSettings(document)).toEqual(store.getFlat());
    const current = store.getFlat();
    expect(resolveSettingsUpdateIntent(current, mergeSettings(current, { iconDefaults: {} }))).toBe("patch");
    await store.updateFlat({ iconDefaults: {}, iconOverrides: {} });
    expect(store.getFlat().iconDefaults).toEqual({}); expect(store.getFlat().iconOverrides).toEqual({});
    // Facets/definition availability are deliberately absent from normalization.
    expect(migrateSettings({ iconOverrides: { [key("tag", "outside/scope")]: heart, [key("template", "missing-file-registration")]: sun } }).iconOverrides).toHaveProperty(key("tag", "outside/scope"));
  });
  it("retains newest memory through a failed write and retries the dirty document", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("disk")).mockResolvedValue(undefined);
    const store = new SettingsStore({ load: async () => null, save }); await store.init();
    await expect(store.updateFlat({ iconDefaults: { folder: heart } })).rejects.toThrow("disk");
    expect(store.getFlat().iconDefaults.folder).toEqual(heart);
    await store.flushPendingWrites();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].preferences.iconDefaults.folder).toEqual(heart);
  });
  it("never writes a future schema", async () => {
    const save = vi.fn(); const store = new SettingsStore({ load: async () => ({ schemaVersion: 3 }), save });
    expect(await store.init()).toBe("unsupported-schema");
    await expect(store.updateFlat({ iconDefaults: { folder: heart } })).rejects.toThrow("Unsupported");
    await store.flushPendingWrites(); expect(save).not.toHaveBeenCalled();
  });
});

describe("authored tag identity changes", () => {
  it("moves the entire subtree, keeps target conflicts, and leaves unrelated prefixes", () => {
    const current = { [key("tag", "work")]: heart, [key("tag", "work/sub")]: heart, [key("tag", "done/sub")]: sun, [key("tag", "worker")]: sun };
    expect(rewriteTagIconOverrides(current, "work", "done")).toEqual({ [key("tag", "done")]: heart, [key("tag", "done/sub")]: sun, [key("tag", "worker")]: sun });
    expect(rewriteTagIconOverrides(current, "work", "done", true)).toEqual({ ...current, [key("tag", "done")]: heart });
    expect(rewriteTagIconOverrides(current, "absent", "done")).toBe(current);
    expect(rewriteTagIconOverrides(current, "work", null)).toEqual({ [key("tag", "done/sub")]: sun, [key("tag", "worker")]: sun });
  });
});

describe("picker preferences", () => {
  it("treats bare and lucide-prefixed IDs as one glyph and keeps recent icons bounded and unique", () => {
    expect(iconSpecEquals({ kind: "lucide", value: "lucide-sun" }, sun)).toBe(true);
    expect(iconSpecEquals({ kind: "emoji", value: "sun" }, sun)).toBe(false);
    const many = Array.from({ length: RECENT_ICON_LIMIT + 5 }, (_, index): IconSpec => ({ kind: "lucide", value: `icon-${index}` }));
    expect(normalizeRecentIcons([sun, { kind: "lucide", value: "lucide-sun" }, { kind: "emoji", value: "plain text" }, ...many])).toHaveLength(RECENT_ICON_LIMIT);
    expect(normalizeRecentIcons("bad")).toEqual([]);
    expect(pushRecentIcon([heart, sun], { kind: "lucide", value: "lucide-sun" })).toEqual([{ kind: "lucide", value: "lucide-sun" }, heart]);
    expect(pushRecentIcon(many, heart)).toHaveLength(RECENT_ICON_LIMIT);
  });
  it("stores plain text as a normalized no-icon spec that never enters recent icons", () => {
    const none: IconSpec = { kind: "none", value: "" };
    expect(normalizeIconSpec({ kind: "none", value: "ignored" })).toEqual(none);
    expect(iconSpecEquals(none, { kind: "none", value: "" })).toBe(true);
    expect(iconSpecEquals(none, sun)).toBe(false);
    expect(pushRecentIcon([sun], none)).toEqual([sun]);
    expect(normalizeRecentIcons([none, sun])).toEqual([sun]);
    expect(resolveContentIcon({ iconDefaults: { folder: none } }, { kind: "folder", ref: "A" })).toEqual(none);
    expect(resolveContentIcon({ iconDefaults: { folder: none }, iconOverrides: { [iconTargetKey({ kind: "folder", ref: "A" })]: sun } }, { kind: "folder", ref: "A" })).toEqual(sun);
  });
  it("accepts only single skin-tone modifiers", () => {
    expect(normalizeEmojiSkinTone("🏽")).toBe("🏽");
    expect(normalizeEmojiSkinTone("🏽🏽")).toBe("");
    expect(normalizeEmojiSkinTone(3)).toBe("");
  });
});
