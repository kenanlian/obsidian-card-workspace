import { describe, expect, it, vi } from "vitest";

import type { PluginSettings } from "../settings";
import { PinnedPathReconciler } from "./PinnedPathReconciler";
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

function createHarness(pinnedPaths: string[]) {
  const settings = { pinnedPaths } as PluginSettings;
  const saveSettings = vi.fn((patch: { pinnedPaths?: string[] }) => {
    if (patch.pinnedPaths) {
      settings.pinnedPaths = patch.pinnedPaths;
    }
    return Promise.resolve();
  });
  const steps: string[] = [];
  const reconciler = new PinnedPathReconciler({
    getSettings: () => settings,
    saveSettings,
    onStep: (step) => steps.push(step),
  });
  return { settings, saveSettings, steps, reconciler };
}

describe("PinnedPathReconciler", () => {
  it("persists boundary-rewritten pins on a folder rename", async () => {
    const { reconciler, saveSettings, settings } = createHarness([
      "Projects",
      "Projects/A.md",
      "Projected/B.md",
    ]);

    await reconciler.handleVaultMutation(createEvent());

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({
      pinnedPaths: ["Work", "Work/A.md", "Projected/B.md"],
    });
    expect(settings.pinnedPaths).toEqual(["Work", "Work/A.md", "Projected/B.md"]);
  });

  it("rewrites only exact matches on a file rename", async () => {
    const { reconciler, saveSettings } = createHarness(["Notes/A.md", "Notes/AB.md"]);

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "rename",
        path: "Notes/Renamed.md",
        oldPath: "Notes/A.md",
        isFolder: false,
        fileKind: "markdown",
      }),
    );

    expect(saveSettings).toHaveBeenCalledWith({
      pinnedPaths: ["Notes/Renamed.md", "Notes/AB.md"],
    });
  });

  it("drops exact and descendant pins on a folder delete", async () => {
    const { reconciler, saveSettings } = createHarness([
      "Projects",
      "Projects/Sub/A.md",
      "Projected/B.md",
    ]);

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "delete",
        path: "Projects",
        oldPath: null,
      }),
    );

    expect(saveSettings).toHaveBeenCalledWith({ pinnedPaths: ["Projected/B.md"] });
  });

  it("drops only the exact pin on a file delete", async () => {
    const { reconciler, saveSettings } = createHarness(["Notes/A.md", "Notes/B.md"]);

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "delete",
        path: "Notes/A.md",
        oldPath: null,
        isFolder: false,
        fileKind: "markdown",
      }),
    );

    expect(saveSettings).toHaveBeenCalledWith({ pinnedPaths: ["Notes/B.md"] });
  });

  it("keeps the first occurrence when a rename collides two pins", async () => {
    const { reconciler, saveSettings } = createHarness(["Projects/A.md", "Work/A.md"]);

    await reconciler.handleVaultMutation(createEvent());

    expect(saveSettings).toHaveBeenCalledWith({ pinnedPaths: ["Work/A.md"] });
  });

  it("ignores create, modify, and renames without an old path", async () => {
    const { reconciler, saveSettings, steps } = createHarness(["Projects/A.md"]);

    await reconciler.handleVaultMutation(
      createEvent({ eventType: "create", path: "Projects/A.md", oldPath: null }),
    );
    await reconciler.handleVaultMutation(
      createEvent({ eventType: "modify", path: "Projects/A.md", oldPath: null, isFolder: false, fileKind: "markdown" }),
    );
    await reconciler.handleVaultMutation(createEvent({ oldPath: null }));

    expect(saveSettings).not.toHaveBeenCalled();
    expect(steps).toEqual(["pinnedPaths", "pinnedPaths", "pinnedPaths"]);
  });

  it("does not write on a semantic no-op", async () => {
    const { reconciler, saveSettings, steps, settings } = createHarness([
      "Other/A.md",
      "Projects-lookalike/B.md",
    ]);
    const original = settings.pinnedPaths;

    await reconciler.handleVaultMutation(createEvent());

    expect(saveSettings).not.toHaveBeenCalled();
    expect(settings.pinnedPaths).toBe(original);
    expect(steps).toEqual(["pinnedPaths"]);
  });

  it("does not write for unchanged duplicate pins", async () => {
    const { reconciler, saveSettings } = createHarness(["Other/A.md", "Other/A.md"]);

    await reconciler.handleVaultMutation(createEvent());

    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("still reports the step when there are no pins", async () => {
    const { reconciler, saveSettings, steps } = createHarness([]);

    await reconciler.handleVaultMutation(createEvent());

    expect(saveSettings).not.toHaveBeenCalled();
    expect(steps).toEqual(["pinnedPaths"]);
  });

  it("propagates a settings-save rejection for bus-level isolation", async () => {
    const settings = { pinnedPaths: ["Projects/A.md"] } as PluginSettings;
    const failure = new Error("disk unavailable");
    const saveSettings = vi.fn(() => Promise.reject(failure));
    const reconciler = new PinnedPathReconciler({
      getSettings: () => settings,
      saveSettings,
    });

    await expect(reconciler.handleVaultMutation(createEvent())).rejects.toBe(failure);
    expect(saveSettings).toHaveBeenCalledWith({ pinnedPaths: ["Work/A.md"] });
  });
});
