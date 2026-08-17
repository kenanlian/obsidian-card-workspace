import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import { createFolderScope } from "../scope";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { ScopeController } from "./ScopeController";

function createHarness() {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  const saveSettings = vi.fn(async (patch: Partial<typeof settings>) => {
    Object.assign(settings, patch);
  });
  const requestUpdate = vi.fn(async () => undefined);
  const context = {
    getApp: () => ({ vault: { getRoot: vi.fn(), getAbstractFileByPath: vi.fn() } }),
    store: createViewStateStore(createFolderScope("old/nested", true)),
    epochs: createViewEpochs(),
    getSettings: () => settings,
    saveSettings,
    getUiStrings: vi.fn(),
    publishGroups: vi.fn(),
    requestUpdate,
    notify: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  const pending = new Set<string>();
  const controller = new ScopeController({
    context,
    collectBoxFiles: () => [],
    isPathInBox: () => false,
    deriveVisibleCardsFrom: () => [],
    projectVisibleCards: vi.fn(),
    getBulkSelection: () => ({ selectedPaths: new Set<string>(), anchorPath: null }),
    setBulkSelection: vi.fn(),
    clearBulkSelection: vi.fn(),
    pendingHydration: pending,
    hydrateStartupCardPaths: vi.fn(async () => undefined),
    hydrateCardNow: vi.fn(),
    resetSearchForLoad: vi.fn(),
    refreshSearchProjection: vi.fn(),
    scheduleNavCountRefresh: vi.fn(),
    refreshFolderTreeState: vi.fn(),
    scheduleFolderTreeRefresh: vi.fn(),
    startupCardCount: 6,
  });
  return { context, controller, requestUpdate, saveSettings };
}

describe("ScopeController", () => {
  afterEach(() => vi.useRealTimers());

  it("applies a scope rename and recomputes its load key exactly once without persistence", () => {
    const { context, controller, saveSettings } = createHarness();
    const applySpy = vi.spyOn(controller, "applyScopeRename");
    const loadKeySpy = vi.spyOn(controller, "refreshLoadKeyForCurrentScope");
    const persistSpy = vi.spyOn(controller as any, "persistScopeProjection");

    const result = controller.handleVaultMutation({
      eventType: "rename",
      path: "new",
      oldPath: "old",
      isFolder: true,
      fileKind: null,
    });

    expect(result.selectedFolderPathAfterRename).toBe("new/nested");
    expect(context.store.getScope()).toEqual(createFolderScope("new/nested", true));
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(loadKeySpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).not.toHaveBeenCalled();
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("debounces vault refresh at 249ms then fires at 250ms", () => {
    vi.useFakeTimers();
    const { controller, requestUpdate } = createHarness();
    controller.scheduleVaultRefresh();
    vi.advanceTimersByTime(249);
    expect(requestUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestUpdate).toHaveBeenCalledWith("reload", "vault-change");
  });

  it("V53 collapses multiple scheduleVaultRefresh calls within 250ms to one reload", () => {
    vi.useFakeTimers();
    const { controller, requestUpdate } = createHarness();
    controller.scheduleVaultRefresh();
    vi.advanceTimersByTime(100);
    controller.scheduleVaultRefresh();
    vi.advanceTimersByTime(249);
    expect(requestUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    expect(requestUpdate).toHaveBeenCalledWith("reload", "vault-change");
  });

  it("V53 defers an in-scope vault event while a load is in flight and refresh clears the queue", async () => {
    const { controller } = createHarness();
    (controller as any).inFlight = Promise.resolve(true);
    const result = controller.handleVaultMutation({
      eventType: "create",
      path: "old/nested/note.md",
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });
    expect(result.shouldRefresh).toBe(true);
    expect(result.queueAction).toBe("deferred_while_inflight");
    expect((controller as any).refreshQueued).toBe(true);

    await controller.refresh({ reason: "vault-change" });
    expect((controller as any).refreshQueued).toBe(false);
  });

  it("dispose cancels debounce, clears queued refresh state, and invalidates epochs", () => {
    vi.useFakeTimers();
    const { context, controller, requestUpdate } = createHarness();
    const before = context.epochs.load.value;
    controller.scheduleVaultRefresh();
    const report = controller.dispose();
    vi.runAllTimers();
    expect(report.cancelledDebounce).toBe(true);
    expect(context.epochs.load.value).toBe(before + 1);
    expect(requestUpdate).not.toHaveBeenCalled();
  });
});
