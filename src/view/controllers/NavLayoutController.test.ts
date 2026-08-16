import { TFile, TFolder } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";

const obsidianTypes = vi.hoisted(() => {
  class MockTFile {
    path = "";
    name = "";
    extension = "";
  }
  class MockTFolder {
    path = "";
    name = "";
    children: Array<MockTFile | MockTFolder> = [];
  }
  return { MockTFile, MockTFolder };
});

vi.mock("obsidian", () => ({
  TFile: obsidianTypes.MockTFile,
  TFolder: obsidianTypes.MockTFolder,
}));

import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import { createFolderScope } from "../scope";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { NavLayoutController } from "./NavLayoutController";

function folder(path: string, children: Array<TFile | TFolder> = []): TFolder {
  const value = new TFolder();
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.children = children;
  return value;
}

function file(path: string): TFile {
  const value = new TFile();
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.extension = path.slice(path.lastIndexOf(".") + 1);
  return value;
}

function createHarness(root = folder("")) {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  const publishGroups = vi.fn();
  const saveSettings = vi.fn(async (patch: Partial<typeof settings>) => {
    Object.assign(settings, patch);
  });
  const context = {
    getApp: () => ({ vault: { getRoot: () => root } }),
    store: createViewStateStore(createFolderScope("", true)),
    epochs: createViewEpochs(),
    getSettings: () => settings,
    saveSettings,
    getUiStrings: vi.fn(),
    publishGroups,
    requestUpdate: vi.fn(),
    notify: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  const onNavCountsInvalidated = vi.fn();
  const controller = new NavLayoutController({
    context,
    onNavCountsInvalidated,
    getTooltipSide: () => "right",
  });
  return { context, controller, onNavCountsInvalidated, publishGroups, saveSettings, settings };
}

describe("NavLayoutController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives the folder tree and exposes identical counts for favorites", () => {
    const nested = folder("alpha/nested", [file("alpha/nested/three.canvas")]);
    const alpha = folder("alpha", [file("alpha/one.md"), file("alpha/two.txt"), nested]);
    const { controller, publishGroups } = createHarness(folder("", [file("root.base"), alpha]));

    controller.refreshFolderTreeState();

    expect(controller.getFolderTree()).toEqual([
      expect.objectContaining({ path: "/", directCount: 1, recursiveCount: 3, recursiveFolderCount: 2 }),
      expect.objectContaining({ path: "alpha", directCount: 1, recursiveCount: 2, recursiveFolderCount: 1 }),
    ]);
    expect(controller.getFolderTreeCount("alpha/nested")).toEqual({ direct: 1, recursive: 1 });
    expect(publishGroups).toHaveBeenCalledWith("nav");
  });

  it("preserves dual/single pane layout and delegates persistent toggles", async () => {
    const { controller, publishGroups, saveSettings, settings } = createHarness();

    expect(controller.getLayoutMode()).toBe("dual");
    controller.onShellResize(settings.navPaneWidth + 303);
    expect(controller.getLayoutMode()).toBe("single");
    expect(controller.getNavVisible()).toBe(false);

    await controller.onToggleNavPane();
    expect(controller.getNavVisible()).toBe(true);
    controller.returnToCardsViewIfSinglePane();
    expect(controller.getNavVisible()).toBe(false);

    controller.onShellResize(settings.navPaneWidth + 304);
    await controller.onToggleNavPane();
    expect(saveSettings).toHaveBeenCalledWith({ navPaneCollapsed: true });
    expect(publishGroups).toHaveBeenCalledWith("nav");
    expect(controller.getTooltipSide()).toBe("right");
  });

  it("debounces tree and count refreshes at exactly 250ms", () => {
    vi.useFakeTimers();
    const { context, controller, onNavCountsInvalidated, publishGroups } = createHarness();
    const initialNavEpoch = context.epochs.navCount.value;

    controller.scheduleFolderTreeRefresh();
    controller.scheduleNavCountRefresh();
    vi.advanceTimersByTime(249);
    expect(publishGroups).not.toHaveBeenCalled();
    expect(onNavCountsInvalidated).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(publishGroups).toHaveBeenCalledTimes(2);
    expect(onNavCountsInvalidated).toHaveBeenCalledTimes(1);
    expect(context.epochs.navCount.value).toBe(initialNavEpoch + 1);
  });

  it("refreshes nav state and reports disposal of either pending timer", () => {
    vi.useFakeTimers();
    const { context, controller, onNavCountsInvalidated, publishGroups } = createHarness();
    const initialNavEpoch = context.epochs.navCount.value;

    controller.refreshNavState();
    expect(onNavCountsInvalidated).toHaveBeenCalledTimes(1);
    expect(context.epochs.navCount.value).toBe(initialNavEpoch + 1);
    expect(publishGroups).toHaveBeenCalledWith("nav", "scope");

    controller.scheduleFolderTreeRefresh();
    controller.scheduleNavCountRefresh();
    expect(controller.dispose()).toEqual({ cancelledDebounce: true });
    vi.runAllTimers();
    expect(onNavCountsInvalidated).toHaveBeenCalledTimes(1);
  });
});
