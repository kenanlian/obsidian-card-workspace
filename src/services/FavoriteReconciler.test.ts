import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

import type { PluginSettings } from "../settings";
import type { FavoriteEntry } from "../view/types";
import { FavoriteReconciler } from "./FavoriteReconciler";
import type { VaultMutationEvent } from "./vault-events";

function createEvent(overrides: Partial<VaultMutationEvent> = {}): VaultMutationEvent {
  return {
    eventType: "rename",
    path: "Work",
    oldPath: "Projects",
    isFolder: true,
    fileKind: null,
    ...overrides,
  };
}

function createAppWithTags(tagsByPath: Record<string, string[]>): App {
  return {
    metadataCache: {
      getFileCache(file: { path: string }) {
        const tags = tagsByPath[file.path];
        if (!tags) {
          return { tags: [] };
        }
        return { tags: tags.map((tag) => ({ tag })) };
      },
    },
    vault: {
      getMarkdownFiles: () => Object.keys(tagsByPath).map((path) => ({ path, extension: "md" })),
    },
  } as unknown as App;
}

const liveReconcilers: FavoriteReconciler[] = [];

function createHarness(favorites: FavoriteEntry[], app: App = createAppWithTags({})) {
  const settings = { favorites } as PluginSettings;
  const updateUserData = vi.fn((patch: { favorites?: FavoriteEntry[] }) => {
    if (patch.favorites) {
      settings.favorites = patch.favorites;
    }
    return Promise.resolve(null);
  });
  const onUserDataReconciled = vi.fn();
  const steps: string[] = [];
  const reconciler = new FavoriteReconciler({
    getSettings: () => settings,
    updateUserData,
    onUserDataReconciled,
    getApp: () => app,
    onStep: (step) => steps.push(step),
  });
  liveReconcilers.push(reconciler);
  return { settings, updateUserData, onUserDataReconciled, steps, reconciler };
}

describe("FavoriteReconciler", () => {
  afterEach(() => {
    for (const reconciler of liveReconcilers) {
      reconciler.dispose();
    }
    liveReconcilers.length = 0;
    vi.useRealTimers();
  });

  it("V51 persists rewritten favorites on rename and notifies nav refresh", async () => {
    const { reconciler, updateUserData, onUserDataReconciled, settings } = createHarness([
      { kind: "folder", ref: "Projects" },
      { kind: "file", ref: "Projects/A.md" },
      { kind: "tag", ref: "work" },
    ]);

    await reconciler.handleVaultMutation(createEvent());

    expect(updateUserData).toHaveBeenCalledTimes(1);
    expect(updateUserData).toHaveBeenCalledWith({
      favorites: [
        { kind: "folder", ref: "Work" },
        { kind: "file", ref: "Work/A.md" },
        { kind: "tag", ref: "work" },
      ],
    });
    expect(settings.favorites).toEqual([
      { kind: "folder", ref: "Work" },
      { kind: "file", ref: "Work/A.md" },
      { kind: "tag", ref: "work" },
    ]);
    expect(onUserDataReconciled).toHaveBeenCalledTimes(1);
  });

  it("V51 persists dropped path favorites on delete", async () => {
    const { reconciler, updateUserData, onUserDataReconciled } = createHarness([
      { kind: "folder", ref: "Projects" },
      { kind: "folder", ref: "Other" },
      { kind: "file", ref: "Projects/A.md" },
    ]);

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "delete",
        path: "Projects",
        oldPath: null,
        isFolder: true,
      }),
    );

    expect(updateUserData).toHaveBeenCalledWith({
      favorites: [{ kind: "folder", ref: "Other" }],
    });
    expect(onUserDataReconciled).toHaveBeenCalledTimes(1);
  });

  it("V51 does not write on a no-op mutation but still reports both steps", async () => {
    const { reconciler, updateUserData, onUserDataReconciled, steps } = createHarness([
      { kind: "folder", ref: "Other" },
    ]);

    await reconciler.handleVaultMutation(createEvent());

    expect(updateUserData).not.toHaveBeenCalled();
    expect(onUserDataReconciled).not.toHaveBeenCalled();
    expect(steps).toEqual(["favorites", "tagPrune"]);
  });

  it("V51 skips tag prune on create even when tag favorites exist", async () => {
    vi.useFakeTimers();
    const { reconciler, updateUserData, steps } = createHarness(
      [{ kind: "tag", ref: "archive" }],
      createAppWithTags({ "notes/a.md": ["#work"] }),
    );

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "create",
        path: "notes/new.md",
        oldPath: null,
        isFolder: false,
        fileKind: "markdown",
      }),
    );

    vi.advanceTimersByTime(2000);
    expect(updateUserData).not.toHaveBeenCalled();
    expect(steps).toEqual(["favorites", "tagPrune"]);
  });

  it("V51 debounces tag prune by 1000ms and notifies when tags are dropped", async () => {
    vi.useFakeTimers();
    const { reconciler, updateUserData, onUserDataReconciled } = createHarness(
      [
        { kind: "tag", ref: "archive" },
        { kind: "folder", ref: "notes" },
      ],
      createAppWithTags({ "notes/survivor.md": ["#work/ai"] }),
    );

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "delete",
        path: "notes/gone.md",
        oldPath: null,
        isFolder: false,
        fileKind: "markdown",
      }),
    );

    expect(updateUserData).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(updateUserData).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(updateUserData).toHaveBeenCalledWith({
      favorites: [{ kind: "folder", ref: "notes" }],
    });
    expect(onUserDataReconciled).toHaveBeenCalledTimes(1);
  });

  it("V51 reports favorites then tagPrune from the same listener even when empty", async () => {
    const { reconciler, steps, updateUserData } = createHarness([]);

    await reconciler.handleVaultMutation(createEvent());

    expect(updateUserData).not.toHaveBeenCalled();
    expect(steps).toEqual(["favorites", "tagPrune"]);
  });
});
