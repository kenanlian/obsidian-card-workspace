import { describe, expect, it, vi } from "vitest";
import { migrateSettings, mergeSettings, DEFAULT_SETTINGS } from "./settings";
import { SettingsStore, hasPatchValues, serializeSettings, splitFlatPatch } from "./services/SettingsStore";
import { normalizeCardBackgroundOverrides } from "./card-background";

describe("card background persistence", () => {
  it.each(["theme", "blue"] as const)("clears the last override and restores %s through the real settings write guards", async (defaultColor) => {
    const initial = serializeSettings(mergeSettings(DEFAULT_SETTINGS, {
      cardBackgroundColor: defaultColor,
      cardBackgroundOverrides: { "editing.md": "red" },
    }));
    let disk = initial;
    const save = vi.fn(async (value: unknown) => { disk = value as typeof initial; });
    const store = new SettingsStore({ load: async () => disk, save });
    await store.init();
    const patch = { cardBackgroundOverrides: {} };
    // main.saveSettings and SettingsStore both use this guard. An empty
    // replacement map must reach the semantic comparison and persistence.
    expect(hasPatchValues(patch)).toBe(true);
    expect(hasPatchValues(splitFlatPatch(patch).userData)).toBe(true);
    expect(await store.updateFlat(patch)).toBe("patch");
    expect(store.getFlat().cardBackgroundOverrides).toEqual({});
    expect(store.getFlat().cardBackgroundColor).toBe(defaultColor);
    expect(save).toHaveBeenCalledTimes(1);
    expect(disk.userData.cardBackgroundOverrides).toEqual({});
    const restored = new SettingsStore({ load: async () => disk, save });
    await restored.init();
    expect(restored.getFlat().cardBackgroundOverrides).toEqual({});
    save.mockClear();
    expect(await restored.updateFlat(patch)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
  it("defaults old settings, discards invalid colors and round trips both layers", () => {
    expect(migrateSettings({}).cardBackgroundColor).toBe("theme");
    expect(normalizeCardBackgroundOverrides({ "a.md": "red", "b.pdf": "#fff", "": "blue" })).toEqual({ "a.md": "red" });
    const settings = mergeSettings(DEFAULT_SETTINGS, { cardBackgroundColor: "blue", cardBackgroundOverrides: { "a.pdf": "red" } });
    const saved = serializeSettings(settings);
    expect(saved.preferences.cardBackgroundColor).toBe("blue");
    expect(saved.userData.cardBackgroundOverrides).toEqual({ "a.pdf": "red" });
    expect(migrateSettings(saved)).toEqual(settings);
    expect(migrateSettings({ cardBackgroundColor: "invalid", cardBackgroundOverrides: [] }).cardBackgroundColor).toBe("theme");
  });
  it("installs patch updates synchronously and protects future schemas", async () => {
    const save = vi.fn(async () => {});
    const store = new SettingsStore({ load: async () => ({}), save });
    await store.init();
    const result = store.updatePreferences({ cardBackgroundColor: "green" });
    expect(store.getFlat().cardBackgroundColor).toBe("green");
    expect(await result).toBe("patch");
    expect(await store.updateUserData({ cardBackgroundOverrides: { "a.md": "pink" } })).toBe("patch");
    const future = new SettingsStore({ load: async () => ({ schemaVersion: 999 }), save });
    await future.init();
    await expect(future.updatePreferences({ cardBackgroundColor: "red" })).rejects.toThrow();
    expect(future.getFlat().cardBackgroundColor).toBe("theme");
  });
});
