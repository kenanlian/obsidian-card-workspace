import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsStore, serializeSettings, splitFlatPatch } from "./SettingsStore";
import { SETTINGS_SCHEMA_VERSION, type PluginSettings } from "../settings";

interface SaveHarness {
  store: SettingsStore;
  save: ReturnType<typeof vi.fn<(data: unknown) => Promise<void>>>;
  documents: unknown[];
  inFlight: { current: number; max: number };
  hangFirstSave: () => void;
  releaseFirstSave: () => void;
  failFirstSave: (error: Error) => void;
}

function createStore(options?: {
  load?: () => Promise<unknown>;
  hangFirst?: boolean;
}): SaveHarness {
  const documents: unknown[] = [];
  const inFlight = { current: 0, max: 0 };
  let firstSaveRelease: (() => void) | null = null;
  let firstSaveReject: ((reason: unknown) => void) | null = null;
  let hangFirst = options?.hangFirst ?? false;

  const save = vi.fn(async (data: unknown) => {
    inFlight.current += 1;
    inFlight.max = Math.max(inFlight.max, inFlight.current);
    documents.push(structuredClone(data));
    try {
      if (hangFirst) {
        hangFirst = false;
        await new Promise<void>((resolve, reject) => {
          firstSaveRelease = resolve;
          firstSaveReject = reject;
        });
      }
    } finally {
      inFlight.current -= 1;
    }
  });

  const store = new SettingsStore({
    load: options?.load ?? (async () => ({})),
    save,
  });

  return {
    store,
    save,
    documents,
    inFlight,
    hangFirstSave: () => {
      hangFirst = true;
    },
    releaseFirstSave: () => {
      firstSaveRelease?.();
    },
    failFirstSave: (error: Error) => {
      firstSaveReject?.(error);
    },
  };
}

function persistedRevision(store: SettingsStore): number {
  return (store as unknown as { persistedRevision: number }).persistedRevision;
}

describe("SettingsStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write during init", async () => {
    const { store, save } = createStore({
      load: async () => ({ lastFolderPath: "notes", previewLines: 6 }),
    });

    await store.init();

    expect(save).not.toHaveBeenCalled();
    expect(store.getFlat()).toMatchObject({ lastFolderPath: "notes", previewLines: 6 });
  });

  it("loads a v2 three-layer document without writing", async () => {
    const { store, save } = createStore({
      load: async () => ({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        preferences: { previewLines: 7, showNavItemCounts: true },
        workspace: { lastFolderPath: "notes", filterTags: ["work"], activeBoxId: "box-1" },
        userData: {
          boxes: [{ id: "box-1", name: "Inbox" }],
          pinnedPaths: ["a.md"],
        },
      }),
    });

    await store.init();

    expect(save).not.toHaveBeenCalled();
    expect(store.getFlat()).toMatchObject({
      previewLines: 7,
      showNavItemCounts: true,
      lastFolderPath: "notes",
      filter: { tags: ["work"] },
      pinnedPaths: ["a.md"],
      activeBoxId: "box-1",
    });
  });

  it("applyLaunchOverride clears activeBoxId without writing", async () => {
    const { store, save } = createStore({
      load: async () => ({
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        workspace: { activeBoxId: "box-1" },
        userData: { boxes: [{ id: "box-1", name: "Inbox" }] },
      }),
    });

    await store.init();
    expect(store.getFlat().activeBoxId).toBe("box-1");

    store.applyLaunchOverride();

    expect(store.getFlat().activeBoxId).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("returns a fresh normalized copy on every getFlat read", async () => {
    const { store } = createStore();
    await store.init();

    const first = store.getFlat();
    const second = store.getFlat();
    expect(first.filter.tags).not.toBe(second.filter.tags);
    expect(first.pinnedPaths).not.toBe(second.pinnedPaths);
    expect(first.boxes).not.toBe(second.boxes);
  });

  it("updates getFlat on the same tick, before persist resolves", async () => {
    const { store } = createStore();
    await store.init();

    const pending = store.updatePreferences({ previewLines: 7 });
    expect(store.getFlat().previewLines).toBe(7);
    await pending;
  });

  it("serializes interleaved preferences and workspace writes as the latest v2 document", async () => {
    const { store, save, documents } = createStore();
    await store.init();

    const preferencesWrite = store.updatePreferences({ previewLines: 6 });
    const workspaceWrite = store.updateWorkspace({ lastFolderPath: "notes" });
    await preferencesWrite;
    await vi.advanceTimersByTimeAsync(300);
    await workspaceWrite;

    expect(save.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(documents.at(-1)).toEqual(serializeSettings(store.getFlat()));
    expect(documents.at(-1)).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: { previewLines: 6 },
      workspace: { lastFolderPath: "notes" },
    });
    expect(documents.at(-1)).not.toHaveProperty("previewLines");
    expect(documents.at(-1)).not.toHaveProperty("lastFolderPath");
  });

  it("issues exactly one follow-up write when a second update lands during an in-flight save", async () => {
    vi.useRealTimers();
    const { store, save, inFlight, releaseFirstSave } = createStore({ hangFirst: true });
    await store.init();

    const first = store.updatePreferences({ previewLines: 4 });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    const second = store.updatePreferences({ previewLines: 6 });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(inFlight.current).toBe(1);

    releaseFirstSave();
    await Promise.all([first, second]);

    expect(save).toHaveBeenCalledTimes(2);
    expect(inFlight.max).toBe(1);
    expect(save.mock.calls[1]?.[0]).toEqual(serializeSettings(store.getFlat()));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: { previewLines: 6 },
    });
  });

  it("never overlaps save() calls", async () => {
    vi.useRealTimers();
    const { store, inFlight } = createStore();
    await store.init();

    await Promise.all([
      store.updatePreferences({ previewLines: 3 }),
      store.updatePreferences({ previewLines: 4 }),
      store.updateUserData({ pinnedPaths: ["a.md"] }),
      store.updatePreferences({ showNavItemCounts: true }),
    ]);

    expect(inFlight.max).toBe(1);
    expect(inFlight.current).toBe(0);
  });

  it("flushes workspace writes before the 300ms debounce expires", async () => {
    const { store, save } = createStore();
    await store.init();

    const pending = store.updateWorkspace({ lastFolderPath: "inbox", navPaneWidth: 200 });
    expect(save).not.toHaveBeenCalled();

    await store.flushPendingWrites();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toEqual(serializeSettings(store.getFlat()));
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      workspace: { lastFolderPath: "inbox", navPaneWidth: 200 },
    });
    await pending;

    await vi.advanceTimersByTimeAsync(300);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("coalesces normalized expansion updates through the workspace debounce", async () => {
    const { store, save } = createStore();
    await store.init();

    const folders = store.updateWorkspace({ expandedFolderPaths: ["B", "A", "A"] });
    const tags = store.updateWorkspace({ expandedTagPaths: ["#Work / AI", "personal"] });
    expect(store.getFlat()).toMatchObject({
      expandedFolderPaths: ["A", "B"],
      expandedTagPaths: ["personal", "work/ai"],
    });
    expect(save).not.toHaveBeenCalled();

    await store.flushPendingWrites();
    await Promise.all([folders, tags]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      workspace: {
        expandedFolderPaths: ["A", "B"],
        expandedTagPaths: ["personal", "work/ai"],
      },
    });
  });

  it("keeps dirty memory and retries after a failed save", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const store = new SettingsStore({
      load: async () => ({}),
      save,
    });
    await store.init();

    await expect(store.updatePreferences({ previewLines: 8 })).rejects.toThrow("disk full");
    expect(persistedRevision(store)).toBe(0);
    expect(store.getFlat().previewLines).toBe(8);

    await store.updatePreferences({ showNavItemCounts: true });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toEqual(serializeSettings(store.getFlat()));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: { previewLines: 8, showNavItemCounts: true },
    });
    expect(persistedRevision(store)).toBeGreaterThan(0);
    expect(store.getFlat()).toMatchObject({
      previewLines: 8,
      showNavItemCounts: true,
    });
  });

  it("rejects every waiting caller when an in-flight save fails", async () => {
    vi.useRealTimers();
    const { store, save, inFlight, failFirstSave } = createStore({ hangFirst: true });
    await store.init();

    const first = store.updatePreferences({ previewLines: 4 });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);

    const second = store.updateUserData({ pinnedPaths: ["a.md"] });
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    expect(inFlight.current).toBe(1);

    failFirstSave(new Error("disk full"));
    await expect(first).rejects.toThrow("disk full");
    await expect(second).rejects.toThrow("disk full");

    expect(persistedRevision(store)).toBe(0);
    expect(store.getFlat()).toMatchObject({
      previewLines: 4,
      pinnedPaths: ["a.md"],
    });
    expect(inFlight.max).toBe(1);

    await store.updatePreferences({ showNavItemCounts: true });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]?.[0]).toEqual(serializeSettings(store.getFlat()));
    expect(save.mock.calls[1]?.[0]).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      preferences: { previewLines: 4, showNavItemCounts: true },
      userData: { pinnedPaths: ["a.md"] },
    });
    expect(inFlight.max).toBe(1);
    expect(persistedRevision(store)).toBeGreaterThan(0);
  });

  it("invalidates getFlat identity after every updateXxx", async () => {
    const { store } = createStore();
    await store.init();
    const before = store.getFlat();

    const pending = store.updateUserData({ pinnedPaths: ["note.md"] });
    const after = store.getFlat();
    expect(after.pinnedPaths).not.toBe(before.pinnedPaths);
    expect(after.pinnedPaths).toEqual(["note.md"]);
    await pending;
  });

  it("places sectionCollapsed on the workspace layer and merges a single-section patch", async () => {
    const { store, documents } = createStore();
    await store.init();

    const split = splitFlatPatch({ sectionCollapsed: { folders: false } });
    expect(split.workspace.sectionCollapsed).toEqual({ folders: false });
    expect(split.preferences).not.toHaveProperty("sectionCollapsed");
    expect(split.userData).not.toHaveProperty("sectionCollapsed");

    const allCollapsed = store.updateWorkspace({
      sectionCollapsed: { favorites: true, folders: true, tags: true, boxes: true },
    });
    await store.flushPendingWrites();
    await allCollapsed;

    const pending = store.updateWorkspace({ sectionCollapsed: { folders: false } });
    await store.flushPendingWrites();
    await pending;

    const persisted = documents.at(-1) as {
      preferences: Record<string, unknown>;
      workspace: { sectionCollapsed: Record<string, boolean> };
    };
    expect(persisted.preferences).not.toHaveProperty("sectionCollapsed");
    expect(persisted.workspace.sectionCollapsed).toEqual({
      favorites: true, folders: false, tags: true, boxes: true,
    });
    expect(store.getFlat().sectionCollapsed).toEqual({
      favorites: true, folders: false, tags: true, boxes: true,
    });
  });

  it("places navSectionOrder on the preferences layer without moving sectionCollapsed", async () => {
    const { store, documents } = createStore();
    await store.init();

    const order: PluginSettings["navSectionOrder"] = ["boxes", "favorites", "folders", "tags"];
    const split = splitFlatPatch({ navSectionOrder: order });
    expect(split.preferences.navSectionOrder).toEqual(order);
    expect(split.workspace).not.toHaveProperty("navSectionOrder");
    expect(split.userData).not.toHaveProperty("navSectionOrder");

    const prefsWrite = store.updatePreferences({ navSectionOrder: order });
    const workspaceWrite = store.updateWorkspace({
      sectionCollapsed: { favorites: true, folders: false, tags: true, boxes: false },
    });
    await store.flushPendingWrites();
    await prefsWrite;
    await workspaceWrite;

    const persisted = documents.at(-1) as {
      preferences: Record<string, unknown>;
      workspace: Record<string, unknown>;
    };
    expect(persisted.preferences.navSectionOrder).toEqual(order);
    expect(persisted).not.toHaveProperty("navSectionOrder");
    expect(persisted.workspace).not.toHaveProperty("navSectionOrder");
    expect(persisted.workspace.sectionCollapsed).toEqual({
      favorites: true, folders: false, tags: true, boxes: false,
    });
    expect(persisted.preferences).not.toHaveProperty("sectionCollapsed");
  });
});
