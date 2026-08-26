import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFolder, type App } from "obsidian";

import { DEFAULT_SETTINGS, type PartialPluginSettings, type PluginSettings } from "../settings";
import {
  NavigationWorkspaceReconciler,
  reconcileExpandedFolders,
  rewriteExpandedFoldersAfterRename,
} from "./NavigationWorkspaceReconciler";
import type { VaultMutationEvent } from "./vault-events";

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
    expandedFolderPaths: [...(options.settings?.expandedFolderPaths ?? [])],
    expandedTagPaths: [...(options.settings?.expandedTagPaths ?? [])],
    lastFolderPath: options.settings?.lastFolderPath ?? "",
  };
  const markdownFiles = options.tags === null ? [] : [{ path: "tags.md" }];
  const app = {
    vault: {
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
  const reconciler = new NavigationWorkspaceReconciler({
    getSettings: () => settings,
    saveSettings,
    getApp: () => app,
  });
  return { app, reconciler, saveSettings, getSettings: () => settings };
}

describe("NavigationWorkspaceReconciler", () => {
  beforeEach(() => vi.useFakeTimers());
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

  it("initially reconciles folder case and trustworthy Tag ancestors in one patch", async () => {
    const canonical = folder("Projects/Alpha");
    const { reconciler, saveSettings } = createHarness({
      folders: { "projects/alpha": canonical },
      tags: ["#Work/AI"],
      settings: {
        expandedFolderPaths: ["projects/alpha", "missing"],
        expandedTagPaths: ["work", "work/ai", "stale"],
      },
    });
    await reconciler.reconcileInitial();
    expect(saveSettings).toHaveBeenCalledOnce();
    expect(saveSettings).toHaveBeenCalledWith({
      expandedFolderPaths: ["Projects/Alpha"],
      expandedTagPaths: ["work", "work/ai"],
    });
  });

  it("retains Tags when collection is untrustworthy", async () => {
    const { reconciler, saveSettings } = createHarness({
      tags: null,
      settings: { expandedTagPaths: ["keep"] },
    });
    await reconciler.reconcileInitial();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("cancels an initial reconciliation before collection or persistence after disposal", async () => {
    const { app, reconciler, saveSettings } = createHarness({
      settings: { expandedFolderPaths: ["stale"] },
    });
    const pending = reconciler.reconcileInitial();
    reconciler.dispose();
    await pending;
    expect(app.vault.getAbstractFileByPath).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
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
