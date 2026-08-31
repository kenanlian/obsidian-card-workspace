import { describe, expect, it, vi } from "vitest";

import { DEFAULT_GROUP_SPEC } from "../card-grouping-settings";
import type { PluginSettings } from "../settings";
import type { CardBoxDefinition } from "../view/types";
import { BoxReconciler } from "./BoxReconciler";
import type { VaultMutationEvent } from "./vault-events";

function makeBox(partial: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: partial.id ?? "box-1",
    name: partial.name ?? "Box",
    rules: partial.rules ?? [],
    manualPaths: partial.manualPaths ?? [],
    excludedPaths: partial.excludedPaths ?? [],
    pinnedPaths: partial.pinnedPaths ?? [],
    sort: partial.sort ?? { field: "mtime", direction: "desc" },
    group: partial.group ?? { ...DEFAULT_GROUP_SPEC },
  };
}

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

function createHarness(boxes: CardBoxDefinition[]) {
  const settings = { boxes } as PluginSettings;
  const updateUserData = vi.fn((patch: { boxes?: CardBoxDefinition[] }) => {
    if (patch.boxes) {
      settings.boxes = patch.boxes;
    }
    return Promise.resolve(null);
  });
  const onUserDataReconciled = vi.fn();
  const steps: string[] = [];
  const reconciler = new BoxReconciler({
    getSettings: () => settings,
    updateUserData,
    onUserDataReconciled,
    onStep: (step) => steps.push(step),
  });
  return { settings, updateUserData, onUserDataReconciled, steps, reconciler };
}

describe("BoxReconciler", () => {
  it("V51 persists rewritten boxes on rename and notifies nav refresh", async () => {
    const { reconciler, updateUserData, onUserDataReconciled, settings } = createHarness([
      makeBox({ manualPaths: ["Projects/A.md"], pinnedPaths: ["Projects/Sub/B.md"] }),
    ]);

    await reconciler.handleVaultMutation(createEvent());

    expect(updateUserData).toHaveBeenCalledTimes(1);
    expect(updateUserData).toHaveBeenCalledWith({
      boxes: [
        expect.objectContaining({
          manualPaths: ["Work/A.md"],
          pinnedPaths: ["Work/Sub/B.md"],
        }),
      ],
    });
    expect(settings.boxes[0]?.manualPaths).toEqual(["Work/A.md"]);
    expect(onUserDataReconciled).toHaveBeenCalledTimes(1);
  });

  it("V51 persists dropped paths on delete", async () => {
    const { reconciler, updateUserData, onUserDataReconciled } = createHarness([
      makeBox({ manualPaths: ["A.md", "B.md"], pinnedPaths: ["A.md"] }),
    ]);

    await reconciler.handleVaultMutation(
      createEvent({
        eventType: "delete",
        path: "A.md",
        oldPath: null,
        isFolder: false,
        fileKind: "markdown",
      }),
    );

    expect(updateUserData).toHaveBeenCalledWith({
      boxes: [expect.objectContaining({ manualPaths: ["B.md"], pinnedPaths: [] })],
    });
    expect(onUserDataReconciled).toHaveBeenCalledTimes(1);
  });

  it("V51 does not write on a no-op mutation", async () => {
    const { reconciler, updateUserData, onUserDataReconciled, steps } = createHarness([
      makeBox({ manualPaths: ["Other/A.md"] }),
    ]);

    await reconciler.handleVaultMutation(createEvent());

    expect(updateUserData).not.toHaveBeenCalled();
    expect(onUserDataReconciled).not.toHaveBeenCalled();
    expect(steps).toEqual(["boxes"]);
  });

  it("V51 still reports the boxes step when there is nothing to reconcile", async () => {
    const { reconciler, updateUserData, steps } = createHarness([]);

    await reconciler.handleVaultMutation(createEvent({ eventType: "modify", oldPath: null, isFolder: false }));

    expect(updateUserData).not.toHaveBeenCalled();
    expect(steps).toEqual(["boxes"]);
  });
});
