import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFolder, type App } from "obsidian";

import { collectVaultTagIndex } from "../view/metadata-utils";
import { DEFAULT_SETTINGS, type PartialPluginSettings, type PluginSettings } from "../settings";
import {
  NavigationWorkspaceReconciler,
  reconcileExpandedFolders,
  rewriteExpandedFoldersAfterRename,
} from "./NavigationWorkspaceReconciler";
import type { VaultMutationEvent } from "./vault-events";

vi.mock("../view/metadata-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../view/metadata-utils")>();
  return {
    ...actual,
    collectVaultTagIndex: vi.fn(actual.collectVaultTagIndex),
  };
});

type ScheduledIdle = {
  task: () => void;
  timeoutMs: number;
  cancelled: boolean;
};

function folder(path: string): TFolder {
  const value = new TFolder();
  value.path = path;
  value.name = path.split("/").at(-1) ?? "";
  return value;
}

function event(overrides: Partial<VaultMutationEvent> = {}): VaultMutationEvent {
  return { eventType: "modify", path: "note.md", oldPath: null, isFolder: false, fileKind: "markdown", ...overrides };
}

function createHarness(options: {
  folders?: Record<string, TFolder | null>;
  tags?: string[] | null;
  settings?: Partial<PluginSettings>;
} = {}) {
  let settings: PluginSettings = {
    ...DEFAULT_SETTINGS,
    ...options.settings,
    expandedFolderPaths: [...(options.settings?.expandedFolderPaths ?? [])],
    expandedTagPaths: [...(options.settings?.expandedTagPaths ?? [])],
    lastFolderPath: options.settings?.lastFolderPath ?? "",
  };
  const markdownFiles = options.tags === null ? [] : [{ path: "tags.md" }];
  const app = {
    vault: {
      getRoot: () => folder(""),
      getAbstractFileByPath: vi.fn((path: string) => options.folders?.[path] ?? null),
      getMarkdownFiles: vi.fn(() => markdownFiles),
    },
    metadataCache: {
      getFileCache: vi.fn(() => ({ tags: (options.tags ?? []).map((tag) => ({ tag })) })),
    },
  } as unknown as App;
  const saveSettings = vi.fn(async (patch: PartialPluginSettings) => {
    settings = { ...settings, ...patch } as PluginSettings;
  });
  const scheduled: ScheduledIdle[] = [];
  const scheduleIdle = vi.fn((task: () => void, timeoutMs: number) => {
    const entry: ScheduledIdle = { task, timeoutMs, cancelled: false };
    scheduled.push(entry);
    return () => {
      entry.cancelled = true;
    };
  });
  const reconciler = new NavigationWorkspaceReconciler({
    getSettings: () => settings,
    saveSettings,
    getApp: () => app,
    scheduleIdle,
  });
  return { app, reconciler, saveSettings, getSettings: () => settings, scheduleIdle, scheduled };
}

describe("NavigationWorkspaceReconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(collectVaultTagIndex).mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("rewrites exact and descendant paths without root or prefix collisions", () => {
    expect(rewriteExpandedFoldersAfterRename(["A", "A/deep", "AB", "/"], "A", "Renamed"))
      .toEqual(["AB", "Renamed", "Renamed/deep"]);
  });

  it("canonicalizes live folders and prunes missing folders", () => {
    const canonical = folder("Projects/Alpha");
    const app = {
      vault: { getAbstractFileByPath: (path: string) => path === "projects/alpha" ? canonical : null },
    } as unknown as App;
    expect(reconcileExpandedFolders(app, ["projects/alpha", "missing", "/"])).toEqual(["Projects/Alpha"]);
  });

  it("applies one coherent rename patch for last-folder and expansion", async () => {
    const { reconciler, saveSettings } = createHarness({
      settings: { lastFolderPath: "A/deep", expandedFolderPaths: ["A", "A/deep", "AB"] },
    });
    await reconciler.handleVaultMutation(event({ eventType: "rename", path: "B", oldPath: "A", isFolder: true, fileKind: null }));
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(saveSettings).toHaveBeenCalledWith({
      lastFolderPath: "B/deep",
      expandedFolderPaths: ["AB", "B", "B/deep"],
    });
  });

  it("prunes deleted folders against live vault state", async () => {
    const live = folder("Live");
    const { reconciler, saveSettings } = createHarness({
      folders: { Live: live },
      settings: { expandedFolderPaths: ["Deleted", "Deleted/child", "Live"] },
    });
    await reconciler.handleVaultMutation(event({ eventType: "delete", path: "Deleted", isFolder: true, fileKind: null }));
    expect(saveSettings).toHaveBeenCalledWith({ expandedFolderPaths: ["Live"] });
  });

  it("reconciles expanded folders before the idle tag scan", async () => {
    const canonical = folder("Projects/Alpha");
    const { reconciler, saveSettings, getSettings, scheduleIdle, scheduled } = createHarness({
      folders: { "projects/alpha": canonical },
      tags: ["#Work/AI"],
      settings: {
        expandedFolderPaths: ["projects/alpha", "missing"],
        expandedTagPaths: ["work", "work/ai", "stale"],
      },
    });
    await reconciler.reconcileInitial();
    expect(collectVaultTagIndex).not.toHaveBeenCalled();
    expect(scheduleIdle).toHaveBeenCalledOnce();
    expect(scheduleIdle).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(saveSettings).toHaveBeenCalledWith({ expandedFolderPaths: ["Projects/Alpha"] });
    expect(getSettings().expandedFolderPaths).toEqual(["Projects/Alpha"]);
    expect(getSettings().expandedTagPaths).toEqual(["work", "work/ai", "stale"]);

    scheduled[0]?.task();
    await Promise.resolve();
    expect(collectVaultTagIndex).toHaveBeenCalledOnce();
    expect(saveSettings).toHaveBeenCalledTimes(2);
    expect(saveSettings).toHaveBeenLastCalledWith({ expandedTagPaths: ["work", "work/ai"] });
    expect(getSettings().expandedTagPaths).toEqual(["work", "work/ai"]);
  });

  it("does not save tags when disposed before the idle scan runs", async () => {
    const canonical = folder("Projects/Alpha");
    const { reconciler, saveSettings, getSettings, scheduled } = createHarness({
      folders: { "projects/alpha": canonical },
      tags: ["#Work/AI"],
      settings: {
        expandedFolderPaths: ["projects/alpha", "missing"],
        expandedTagPaths: ["work", "work/ai", "stale"],
      },
    });
    await reconciler.reconcileInitial();
    expect(getSettings().expandedFolderPaths).toEqual(["Projects/Alpha"]);
    expect(collectVaultTagIndex).not.toHaveBeenCalled();
    const idle = scheduled[0];
    expect(idle).toBeDefined();
    reconciler.dispose();
    expect(idle?.cancelled).toBe(true);
    idle?.task();
    await Promise.resolve();
    expect(collectVaultTagIndex).not.toHaveBeenCalled();
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(saveSettings).toHaveBeenCalledWith({ expandedFolderPaths: ["Projects/Alpha"] });
    expect(getSettings().expandedTagPaths).toEqual(["work", "work/ai", "stale"]);
  });

  it("retains Tags when collection is untrustworthy", async () => {
    const { reconciler, saveSettings, getSettings, scheduled } = createHarness({
      tags: null,
      settings: { expandedTagPaths: ["keep"] },
    });
    await reconciler.reconcileInitial();
    expect(collectVaultTagIndex).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    scheduled[0]?.task();
    await Promise.resolve();
    expect(collectVaultTagIndex).toHaveBeenCalledOnce();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(getSettings().expandedTagPaths).toEqual(["keep"]);
  });

  it("cancels an initial reconciliation before collection or persistence after disposal", async () => {
    const { app, reconciler, saveSettings, scheduleIdle } = createHarness({
      settings: { expandedFolderPaths: ["stale"] },
    });
    const pending = reconciler.reconcileInitial();
    reconciler.dispose();
    await pending;
    expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(scheduleIdle).not.toHaveBeenCalled();
    expect(collectVaultTagIndex).not.toHaveBeenCalled();
  });

  it("skips create Tag checks, coalesces other events, and cancels on disposal", async () => {
    const harness = createHarness({ tags: [], settings: { expandedTagPaths: ["stale"] } });
    await harness.reconciler.handleVaultMutation(event({ eventType: "create" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.saveSettings).not.toHaveBeenCalled();

    await harness.reconciler.handleVaultMutation(event({ eventType: "modify" }));
    await harness.reconciler.handleVaultMutation(event({ eventType: "delete" }));
    harness.reconciler.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.saveSettings).not.toHaveBeenCalled();
  });

  it("coalesces delayed trustworthy Tag pruning", async () => {
    const harness = createHarness({ tags: ["#live/child"], settings: { expandedTagPaths: ["live", "stale"] } });
    await harness.reconciler.handleVaultMutation(event());
    await harness.reconciler.handleVaultMutation(event({ eventType: "rename" }));
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.saveSettings).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.saveSettings).toHaveBeenCalledOnce();
    expect(harness.saveSettings).toHaveBeenCalledWith({ expandedTagPaths: ["live"] });
  });
});

describe("folder order reconciliation", () => {
  it("validates only saved references on startup and retains empty manual groups", async () => {
    const h = createHarness({ folders: { A: folder("A"), B: folder("B"), "A/x": folder("A/x") },
      settings: { folderSiblingOrders: { "": ["B", "A", "A", "gone", "A/x"], A: ["A/x", "A/gone"], stale: [] },
        folderDescendingNameSorts: ["", "A", "Unrecorded", "stale"] } });
    await h.reconciler.reconcileInitial();
    expect(h.getSettings().folderSiblingOrders).toEqual({ "": ["B", "A"], A: ["A/x"] });
    expect(h.getSettings().folderDescendingNameSorts).toEqual(["", "A"]);
    expect(h.app.vault.getMarkdownFiles).not.toHaveBeenCalled();
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    h.reconciler.dispose();
  });
  it("appends new children only to manual groups and ignores duplicate create events", async () => {
    const h = createHarness({ settings: { folderSiblingOrders: { A: [] } } });
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "create", path: "A/z" }));
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "create", path: "A/z" }));
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "create", path: "B/x" }));
    expect(h.getSettings().folderSiblingOrders).toEqual({ A: ["A/z"] });
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    h.reconciler.dispose();
  });
  it("keeps rename position, appends a cross-parent move, rewrites subtree records, and prunes deletes", async () => {
    const h = createHarness({ settings: { folderSiblingOrders: {
      "": ["B", "A"], A: ["A/z", "A/x"], B: [], "A/x": ["A/x/c"], "A/x/c": [],
    }, folderDescendingNameSorts: ["", "A/x", "A/x/c"] } });
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "rename", oldPath: "A/x", path: "A/y" }));
    expect(h.getSettings().folderSiblingOrders.A).toEqual(["A/z", "A/y"]);
    expect(h.getSettings().folderDescendingNameSorts).toEqual(["", "A/y", "A/y/c"]);
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "rename", oldPath: "A/y", path: "B/y" }));
    expect(h.getSettings().folderSiblingOrders).toEqual({ "": ["B", "A"], A: ["A/z"], B: ["B/y"],
      "B/y": ["B/y/c"], "B/y/c": [] });
    expect(h.getSettings().folderDescendingNameSorts).toEqual(["", "B/y", "B/y/c"]);
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "delete", path: "B/y" }));
    expect(h.getSettings().folderSiblingOrders).toEqual({ "": ["B", "A"], A: ["A/z"], B: [] });
    expect(h.getSettings().folderDescendingNameSorts).toEqual([""]);
    h.reconciler.dispose();
  });
});

describe("unrecorded folder rename", () => {
  it("preserves position in the name-sorted tail of a manual group", async () => {
    const a = folder("A"), root = folder("");
    const x = folder("A/x"), renamed = folder("A/a"), z = folder("A/z");
    a.children = [x, renamed, z];
    root.children = [a];
    const h = createHarness({ folders: { A: a }, settings: { folderSiblingOrders: { A: ["A/x"] } } });
    await h.reconciler.handleVaultMutation(event({ isFolder: true, eventType: "rename", oldPath: "A/y", path: "A/a" }));
    expect(h.getSettings().folderSiblingOrders).toEqual({ A: ["A/x", "A/a", "A/z"] });
    h.reconciler.dispose();
  });
});

it("rewrites hidden folder descendants on rename but keeps missing rules after deletion and startup reconciliation", async () => {
  const h = createHarness({ settings: { hiddenFolderPaths: ["A", "A/child", "AB", "ghost"] } });
  await h.reconciler.handleVaultMutation(event({ eventType: "rename", path: "B", oldPath: "A", isFolder: true }));
  expect(h.getSettings().hiddenFolderPaths).toEqual(["B", "B/child", "AB", "ghost"]);
  await h.reconciler.handleVaultMutation(event({ eventType: "delete", path: "B", isFolder: true }));
  await h.reconciler.reconcileInitial();
  expect(h.getSettings().hiddenFolderPaths).toEqual(["B", "B/child", "AB", "ghost"]);
  h.reconciler.dispose();
});
