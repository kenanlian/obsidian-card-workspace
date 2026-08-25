import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import { TFile, TFolder } from "obsidian";
import type { EpochToken } from "../async-epoch";
import { createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
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
  const app = { vault: { getRoot: vi.fn(), getAbstractFileByPath: vi.fn() } };
  const context = {
    getApp: () => app,
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
  const scheduleHydrationPath = vi.fn();
  const hydrateStartupCardPaths = vi.fn(async (_paths: string[], _token: EpochToken) => undefined);
  const projectVisibleCards = vi.fn(() => {
    context.store.replaceVisibleCards([...context.store.getBaseCards()]);
  });
  const prepareRecordsFromCache = vi.fn((_records: NoteCardRecord[]) => undefined);
  const invalidateForVaultMutation = vi.fn();
  const publishLoadStart = vi.fn();
  const publishLoadCommit = vi.fn();
  const controller = new ScopeController({
    context,
    collectBoxFiles: () => [],
    isPathInBox: () => false,
    deriveVisibleCardsFrom: (cards) => [...cards],
    projectVisibleCards,
    getBulkSelection: () => ({ selectedPaths: new Set<string>(), anchorPath: null }),
    setBulkSelection: vi.fn(),
    clearBulkSelection: vi.fn(),
    hasPendingHydration: (path) => pending.has(path),
    deletePendingHydration: (path) => pending.delete(path),
    resetHydrationForLoad: () => pending.clear(),
    prepareRecordsFromCache,
    invalidateForVaultMutation,
    hydrateStartupCardPaths,
    scheduleHydrationPath,
    resetSearchForLoad: vi.fn(),
    refreshSearchProjection: vi.fn(),
    scheduleNavCountRefresh: vi.fn(),
    refreshFolderTreeState: vi.fn(),
    scheduleFolderTreeRefresh: vi.fn(),
    publishLoadStart,
    publishLoadCommit,
    startupCardCount: 6,
  });
  return { context, controller, requestUpdate, saveSettings, scheduleHydrationPath,
    hydrateStartupCardPaths, projectVisibleCards, prepareRecordsFromCache,
    invalidateForVaultMutation, publishLoadStart, publishLoadCommit };
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

  it("does not persist an in-flight different-scope load after dispose", async () => {
    const { context, controller, saveSettings, hydrateStartupCardPaths } = createHarness();
    const folder = Object.assign(new TFolder(), { path: "notes", children: [] });
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) =>
      path === "notes" ? folder : null;
    let release!: () => void;
    hydrateStartupCardPaths.mockImplementationOnce(() => new Promise<undefined>((resolve) => {
      release = () => resolve(undefined);
    }));

    const loading = controller.handleScopeSelection(
      controller.createProgrammaticSelectionRequest(createFolderScope("notes", true), false),
    );
    controller.dispose();
    release();
    await loading;

    expect(saveSettings).not.toHaveBeenCalled();
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

  it("installs an incrementally created record before scheduling its hydration", () => {
    const { context, controller, scheduleHydrationPath } = createHarness();
    const liveFile = Object.assign(new TFile(), {
      path: "old/nested/new.md",
      name: "new.md",
      basename: "new",
      extension: "md",
      stat: { ctime: 1, mtime: 2 },
    });
    (context.getApp() as any).vault.getAbstractFileByPath = () => liveFile;
    scheduleHydrationPath.mockImplementation((path: string) => {
      expect(context.store.getBaseCards().some((card) => card.path === path)).toBe(true);
    });

    const result = controller.handleVaultMutation({
      eventType: "create",
      path: liveFile.path,
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    expect(result.incrementalResult?.action).toBe("inserted");
    expect(scheduleHydrationPath).toHaveBeenCalledWith(liveFile.path);
  });

  it("schedules an existing modified card for forced hydration", () => {
    const { context, controller, scheduleHydrationPath } = createHarness();
    const liveFile = Object.assign(new TFile(), {
      path: "old/nested/existing.md",
      name: "existing.md",
      basename: "existing",
      extension: "md",
      stat: { ctime: 1, mtime: 2 },
    });
    context.store.replaceBaseCards([{
      file: liveFile,
      fileKind: "markdown",
      path: liveFile.path,
      title: liveFile.basename,
      ctime: 1,
      mtime: 2,
      excerpt: "old",
      previewHtml: "<p>old</p>",
      previewMode: "text",
      hydrated: true,
    }]);

    const result = controller.handleVaultMutation({
      eventType: "modify",
      path: liveFile.path,
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    expect(result.incrementalResult?.action).toBe("hydration_reset");
    expect(scheduleHydrationPath).toHaveBeenCalledWith(liveFile.path);
  });

  it("clears cross-scope records before loading and commits one prepared projection", async () => {
    const harness = createHarness();
    const { context, controller, projectVisibleCards, prepareRecordsFromCache,
      publishLoadStart, publishLoadCommit, hydrateStartupCardPaths } = harness;
    const oldFile = Object.assign(new TFile(), { path: "old.md", basename: "old", stat: { ctime: 1, mtime: 1 } });
    context.store.replaceBaseCards([{ file: oldFile, fileKind: "markdown", path: oldFile.path,
      title: "old", ctime: 1, mtime: 1, excerpt: "old", previewHtml: "old", previewMode: "text", hydrated: true }]);
    context.store.replaceVisibleCards([...context.store.getBaseCards()]);
    const nextFile = Object.assign(new TFile(), { path: "next/a.md", basename: "a", extension: "md", stat: { ctime: 2, mtime: 2 } });
    const folder = Object.assign(new TFolder(), { path: "next", children: [nextFile] });
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) => path === "next" ? folder : null;
    let release!: () => void;
    hydrateStartupCardPaths.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    publishLoadStart.mockImplementationOnce((changed: boolean) => {
      expect(changed).toBe(true);
      expect(context.store.getBaseCards()).toEqual([]);
      expect(context.store.getVisibleCards()).toEqual([]);
    });

    const loading = controller.handleScopeSelection(
      controller.createProgrammaticSelectionRequest(createFolderScope("next", true), true),
    );
    expect(projectVisibleCards).not.toHaveBeenCalled();
    expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
    release();
    await loading;

    expect(projectVisibleCards).toHaveBeenCalledTimes(1);
    expect(publishLoadCommit).toHaveBeenCalledTimes(1);
    expect(context.store.getVisibleCards().map((card) => card.path)).toEqual([nextFile.path]);
  });

  it("keeps same-scope committed cards busy until one final projection", async () => {
    const { context, controller, projectVisibleCards, publishLoadStart,
      publishLoadCommit, hydrateStartupCardPaths } = createHarness();
    const oldFile = Object.assign(new TFile(), { path: "old/nested/a.md", basename: "a", stat: { ctime: 1, mtime: 1 } });
    const record = { file: oldFile, fileKind: "markdown" as const, path: oldFile.path,
      title: "a", ctime: 1, mtime: 1, excerpt: "old", previewHtml: "old", previewMode: "text" as const, hydrated: true };
    context.store.replaceBaseCards([record]);
    context.store.replaceVisibleCards([record]);
    const folder = Object.assign(new TFolder(), { path: "old/nested", children: [oldFile] });
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) => path === folder.path ? folder : null;
    let release!: () => void;
    hydrateStartupCardPaths.mockImplementationOnce(() => new Promise<undefined>((resolve) => { release = () => resolve(undefined); }));
    publishLoadStart.mockImplementationOnce((changed: boolean) => {
      expect(changed).toBe(false);
      expect(context.store.getVisibleCards()).toEqual([record]);
    });

    const loading = controller.refresh({ reason: "manual", forceRefresh: true });
    expect(projectVisibleCards).not.toHaveBeenCalled();
    release();
    await loading;
    expect(projectVisibleCards).toHaveBeenCalledTimes(1);
    expect(publishLoadCommit).toHaveBeenCalledTimes(1);
  });

  it("invalidates offscreen cache entries before rejecting a vault event", () => {
    const { controller, invalidateForVaultMutation } = createHarness();
    const event = { eventType: "rename" as const, path: "archive/new", oldPath: "archive/old",
      isFolder: true, fileKind: null };
    const result = controller.handleVaultMutation(event);
    expect(result.shouldRefresh).toBe(false);
    expect(invalidateForVaultMutation).toHaveBeenCalledWith(event);
  });

  it("reuses prepared records across root to folder to root transitions", async () => {
    const { context, controller, prepareRecordsFromCache, hydrateStartupCardPaths } = createHarness();
    const rootFile = Object.assign(new TFile(), { path: "root.md", basename: "root", extension: "md", stat: { ctime: 1, mtime: 1 } });
    const childFile = Object.assign(new TFile(), { path: "child/note.md", basename: "note", extension: "md", stat: { ctime: 2, mtime: 2 } });
    const child = Object.assign(new TFolder(), { path: "child", children: [childFile] });
    const root = Object.assign(new TFolder(), { path: "", children: [rootFile, child] });
    (context.getApp() as any).vault.getRoot = () => root;
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) => path === "child" ? child : null;
    const cached = new Set<string>();
    let reads = 0;
    prepareRecordsFromCache.mockImplementation((records) => {
      records.forEach((record) => { if (cached.has(record.path)) record.hydrated = true; });
    });
    hydrateStartupCardPaths.mockImplementation(async (paths) => {
      paths.forEach((path) => { const card = context.store.getBaseCard(path); if (card && !card.hydrated) { reads += 1; cached.add(path); } });
      return undefined;
    });

    await controller.handleScopeSelection(
      controller.createProgrammaticSelectionRequest(createFolderScope("", true), true),
    );
    await controller.handleScopeSelection(
      controller.createProgrammaticSelectionRequest(createFolderScope("child", true), true),
    );
    await controller.handleScopeSelection(
      controller.createProgrammaticSelectionRequest(createFolderScope("", true), true),
    );

    expect(reads).toBe(2);
    expect(context.store.getVisibleCards().map((card) => card.path)).toEqual([childFile.path, rootFile.path]);
    expect(context.store.getVisibleCards().every((card) => card.hydrated)).toBe(true);
  });
});
