import { afterEach, describe, it, expect, vi } from "vitest";
import { SettingsStore, serializeSettings } from "./SettingsStore";
import { DEVICE_PREFERENCE_KEYS, overlayDeviceSettings, pickDeviceSettings, sharedSettings } from "./device-settings";
import { DEFAULT_SETTINGS } from "../settings";

afterEach(() => vi.useRealTimers());
function fixture(raw: unknown = serializeSettings(DEFAULT_SETTINGS), localRaw: unknown = null) {
  const shared: unknown[] = [], local: unknown[] = [];
  const save = vi.fn(async (data: unknown) => { shared.push(structuredClone(data)); });
  const saveLocal = vi.fn(async (data: unknown) => { local.push(structuredClone(data)); });
  const onError = vi.fn();
  const store = new SettingsStore({ load: async () => raw, save, local: { load: () => localRaw, save: saveLocal, onError } });
  return { store, shared, local, save, saveLocal, onError };
}
describe("device preference keys", () => {
  it("stores task sort and group beside sort and group", () => {
    const keys = [...DEVICE_PREFERENCE_KEYS];
    const groupIndex = keys.indexOf("group");
    expect(keys.slice(groupIndex, groupIndex + 3)).toEqual(["group", "taskSort", "taskGroup"]);
    expect(keys).toContain("sort");
    expect(keys).toContain("defaultView");
    expect(keys).not.toContain("enhancedTaskEditing");
    expect(keys).not.toContain("autoCreatedDate");
    expect(keys).not.toContain("autoDoneDate");
    expect(keys).not.toContain("taskDateButtons");
    expect(keys).not.toContain("taskDateHideSource");
  });

  it("overlays device task sort and group while shared preferences stay on the shared document", () => {
    const document = serializeSettings(DEFAULT_SETTINGS);
    const local = pickDeviceSettings(document);
    local.preferences.taskSort = { field: "text", direction: "desc" };
    local.preferences.taskGroup = { dimension: "file" };
    const overlaid = overlayDeviceSettings(document, local);
    expect(overlaid.preferences.taskSort).toEqual({ field: "text", direction: "desc" });
    expect(overlaid.preferences.taskGroup).toEqual({ dimension: "file" });
    expect(overlaid.preferences.enhancedTaskEditing).toBe(true);
    const shared = sharedSettings(overlaid, document);
    expect(shared.preferences.taskSort).toEqual(document.preferences.taskSort);
    expect(shared.preferences.taskGroup).toEqual(document.preferences.taskGroup);
    expect(shared.preferences.enhancedTaskEditing).toBe(true);
  });
});

describe("device overlays", () => {
  it("seeds legacy device fields without startup writes; keeps mixed patches in their own documents", async () => {
    const f = fixture({ ...DEFAULT_SETTINGS, previewLines: 7, lastFolderPath: "old" }); await f.store.init();
    expect(f.store.getFlat().previewLines).toBe(7); expect(f.shared).toEqual([]); expect(f.local).toEqual([]);
    await f.store.updateFlat({ previewLines: 3, skipLeadingTags: true, pinnedPaths: ["a.md"] });
    expect(f.shared).toHaveLength(1); expect(f.local).toHaveLength(1);
    expect(f.shared[0]).toMatchObject({ schemaVersion: 2, preferences: { previewLines: 7, skipLeadingTags: false }, workspace: { lastFolderPath: "old" }, userData: { pinnedPaths: ["a.md"] } });
    expect(f.local[0]).toMatchObject({ version: 1, preferences: { previewLines: 3, skipLeadingTags: true }, workspace: { lastFolderPath: "old" } });
    const restarted = fixture(f.shared[0], f.local[0]); await restarted.store.init();
    expect(restarted.store.getFlat()).toMatchObject({ previewLines: 3, skipLeadingTags: true, pinnedPaths: ["a.md"] });
    await restarted.store.updateFlat({ favorites: [] }); expect(restarted.shared).toHaveLength(0);
  });
  it("debounces all workspace changes locally; local-only writes never touch shared data", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.store.init();
    const pending = f.store.updateFlat({ lastFolderPath: "folder", navPaneCollapsed: true });
    await vi.advanceTimersByTimeAsync(299); expect(f.local).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1); await pending;
    expect(f.local[0]).toMatchObject({ workspace: { lastFolderPath: "folder", navPaneCollapsed: true } }); expect(f.shared).toHaveLength(0);
    await f.store.updateFlat({ cardImageMode: "inline" }); expect(f.shared).toHaveLength(0);
  });
  it("keeps session changes on local failure and retries only the failed destination on flush", async () => {
    const f = fixture(); await f.store.init(); f.saveLocal.mockRejectedValueOnce(new Error("quota"));
    await expect(f.store.updateFlat({ previewLines: 3, pinnedPaths: ["x.md"] })).rejects.toThrow("quota");
    expect(f.store.getFlat()).toMatchObject({ previewLines: 3, pinnedPaths: ["x.md"] }); expect(f.onError).toHaveBeenCalledOnce();
    await f.store.flushPendingWrites(); expect(f.save).toHaveBeenCalledOnce(); expect(f.saveLocal).toHaveBeenCalledTimes(2);
  });
  it("does not write either destination for a future shared or local schema", async () => {
    for (const f of [fixture({ schemaVersion: 3 }), fixture(undefined, { version: 2 })]) {
      expect(await f.store.init()).toBe("unsupported-schema");
      await expect(f.store.updateFlat({ previewLines: 3 })).rejects.toThrow(); await f.store.flushPendingWrites();
      expect(f.shared).toHaveLength(0); expect(f.local).toHaveLength(0);
    }
  });
  it("does not redirect shared failures into local storage", async () => {
    const f = fixture(); await f.store.init(); f.save.mockRejectedValueOnce(new Error("disk"));
    await expect(f.store.updateFlat({ pinnedPaths: ["x"] })).rejects.toThrow("disk");
    expect(f.local).toHaveLength(0); expect(f.store.getFlat().pinnedPaths).toEqual(["x"]);
    await f.store.flushPendingWrites(); expect(f.shared).toHaveLength(1);
  });
});

it("lets either destination persist independently when the other fails", async () => {
  const f = fixture(); await f.store.init(); f.save.mockRejectedValue(new Error("shared disk"));
  await expect(f.store.updateFlat({ pinnedPaths: ["a"], previewLines: 3 })).rejects.toThrow("shared disk");
  expect(f.local).toHaveLength(1); expect(f.store.getPersistenceDiagnostics()).toMatchObject({ sharedPending: true, localPending: false });
  await f.store.updateFlat({ previewLines: 4 }); expect(f.local).toHaveLength(2);
  const g = fixture(); await g.store.init(); g.saveLocal.mockRejectedValue(new Error("local disk"));
  await expect(g.store.updateFlat({ previewLines: 3 })).rejects.toThrow("local disk");
  await g.store.updateFlat({ pinnedPaths: ["b"] }); expect(g.shared).toHaveLength(1);
  expect(g.store.getPersistenceDiagnostics()).toMatchObject({ localStorageDegraded: true });
});
