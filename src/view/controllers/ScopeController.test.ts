import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import { DEFAULT_SETTINGS, normalizeSettings } from "../../settings";
import type { PropertyScalarRef } from "../../property-filter-settings";
import { TFile, TFolder } from "obsidian";
import type { EpochToken } from "../async-epoch";
import { isBoxMember } from "../card-box-membership";
import { getBoxMembershipSignature } from "../card-boxes";
import type { CardBoxDefinition } from "../types";
import { createBoxScope, createFolderScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { ScopeController } from "./ScopeController";

function createHarness(options: { isPathInBox?: (path: string, boxId: string) => boolean } = {}) {
  const settings = normalizeSettings(DEFAULT_SETTINGS);
  const saveSettings = vi.fn(async (patch: Partial<typeof settings>) => {
    Object.assign(settings, patch);
  });
  const requestUpdate = vi.fn(async () => undefined);
  const app = { vault: { getRoot: vi.fn(), getAbstractFileByPath: vi.fn() }, metadataCache: { getFileCache: vi.fn(() => null) } };
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
    isPathInBox: options.isPathInBox ?? (() => false),
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

function membershipRecord(path: string): NoteCardRecord {
  return {
    file: Object.assign(new TFile(), { path }),
    fileKind: "markdown",
    path,
    title: path,
    ctime: 1,
    mtime: 1,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
  };
}

function propertyBox(statusValue: PropertyScalarRef): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Box",
    rules: [{
      folder: "",
      includeSubfolders: true,
      tags: [],
      properties: [{ key: "status", values: [statusValue] }],
      id: "rule-1",
      name: "",
    }],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { ...DEFAULT_GROUP_SPEC },
  };
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

  it("replaces a modified card with a fresh live-stat record and schedules forced hydration", () => {
    const { context, controller, scheduleHydrationPath } = createHarness();
    const liveFile = Object.assign(new TFile(), {
      path: "old/nested/existing.md",
      name: "existing.md",
      basename: "existing",
      extension: "md",
      stat: { ctime: 11, mtime: 22 },
    });
    (context.getApp() as any).vault.getAbstractFileByPath = () => liveFile;
    const published: NoteCardRecord = {
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
      taskSummary: null,
    };
    context.store.replaceBaseCards([published]);

    const result = controller.handleVaultMutation({
      eventType: "modify",
      path: liveFile.path,
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    const installed = context.store.getBaseCard(liveFile.path);
    expect(result.incrementalResult).toEqual({ handled: true, action: "hydration_reset" });
    expect(installed).toBeDefined();
    expect(installed).not.toBe(published);
    expect(installed?.ctime).toBe(11);
    expect(installed?.mtime).toBe(22);
    expect(installed?.previewHtml).toBe("<p>old</p>");
    expect(installed?.previewMode).toBe("text");
    expect(installed?.hydrated).toBe(false);
    // The previously published record object is never mutated.
    expect(published.mtime).toBe(2);
    expect(published.hydrated).toBe(true);
    expect(scheduleHydrationPath).toHaveBeenCalledWith(liveFile.path);
  });

  it("skips hydration for a hidden modified card and keeps it for viewport demand", () => {
    const { context, controller, projectVisibleCards, scheduleHydrationPath } = createHarness();
    const liveFile = Object.assign(new TFile(), {
      path: "old/nested/hidden.md",
      basename: "hidden",
      extension: "md",
      stat: { ctime: 1, mtime: 5 },
    });
    (context.getApp() as any).vault.getAbstractFileByPath = () => liveFile;
    projectVisibleCards.mockImplementation(() => {
      context.store.replaceVisibleCards([]);
    });
    context.store.replaceBaseCards([{
      file: liveFile,
      fileKind: "markdown",
      path: liveFile.path,
      title: liveFile.basename,
      ctime: 1,
      mtime: 2,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
      taskSummary: null,
    }]);

    const result = controller.handleVaultMutation({
      eventType: "modify",
      path: liveFile.path,
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    expect(result.incrementalResult).toEqual({ handled: true, action: "hydration_reset" });
    expect(context.store.getBaseCard(liveFile.path)?.mtime).toBe(5);
    expect(context.store.getVisibleCards()).toEqual([]);
    expect(scheduleHydrationPath).not.toHaveBeenCalled();
  });

  it("defers to an authoritative reload when a modified card has no live file", () => {
    const { context, controller, scheduleHydrationPath } = createHarness();
    (context.getApp() as any).vault.getAbstractFileByPath = () => null;
    context.store.replaceBaseCards([{
      file: Object.assign(new TFile(), { path: "old/nested/gone.md" }),
      fileKind: "markdown",
      path: "old/nested/gone.md",
      title: "gone",
      ctime: 1,
      mtime: 2,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
      taskSummary: null,
    }]);

    const result = controller.handleVaultMutation({
      eventType: "modify",
      path: "old/nested/gone.md",
      oldPath: null,
      isFolder: false,
      fileKind: "markdown",
    });

    expect(result.shouldRefresh).toBe(true);
    expect(result.queueAction).toBe("enqueued");
    expect(result.incrementalResult).toBeNull();
    expect((controller as any).refreshQueued).toBe(true);
    expect(scheduleHydrationPath).not.toHaveBeenCalled();
  });

  it("schedules hydration for a renamed unhydrated card but not an already-hydrated one", () => {
    const hydrateHarness = (published: NoteCardRecord, destinationPath: string) => {
      const harness = createHarness();
      const liveFile = Object.assign(new TFile(), {
        path: destinationPath,
        basename: destinationPath.slice(destinationPath.lastIndexOf("/") + 1).replace(/\.md$/, ""),
        extension: "md",
        stat: { ctime: 3, mtime: 4 },
      });
      (harness.context.getApp() as any).vault.getAbstractFileByPath = () => liveFile;
      harness.context.store.replaceBaseCards([published]);
      return { ...harness, liveFile };
    };

    const unhydrated = hydrateHarness({
      file: Object.assign(new TFile(), { path: "old/nested/draft.md" }),
      fileKind: "markdown",
      path: "old/nested/draft.md",
      title: "draft",
      ctime: 1,
      mtime: 1,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
      taskSummary: null,
    }, "old/nested/renamed.md");
    const unhydratedResult = unhydrated.controller.handleVaultMutation({
      eventType: "rename",
      path: "old/nested/renamed.md",
      oldPath: "old/nested/draft.md",
      isFolder: false,
      fileKind: "markdown",
    });
    expect(unhydratedResult.incrementalResult).toEqual({ handled: true, action: "updated" });
    expect(unhydrated.context.store.getBaseCards().map((card) => card.path))
      .toEqual(["old/nested/renamed.md"]);
    expect(unhydrated.context.store.getBaseCard("old/nested/renamed.md")?.mtime).toBe(4);
    expect(unhydrated.scheduleHydrationPath).toHaveBeenCalledWith("old/nested/renamed.md");

    const hydrated = hydrateHarness({
      file: Object.assign(new TFile(), { path: "old/nested/final.md" }),
      fileKind: "markdown",
      path: "old/nested/final.md",
      title: "final",
      ctime: 1,
      mtime: 1,
      excerpt: "kept",
      previewHtml: "<p>kept</p>",
      previewMode: "text",
      hydrated: true,
      taskSummary: null,
    }, "old/nested/final-renamed.md");
    const hydratedResult = hydrated.controller.handleVaultMutation({
      eventType: "rename",
      path: "old/nested/final-renamed.md",
      oldPath: "old/nested/final.md",
      isFolder: false,
      fileKind: "markdown",
    });
    expect(hydratedResult.incrementalResult).toEqual({ handled: true, action: "updated" });
    const merged = hydrated.context.store.getBaseCard("old/nested/final-renamed.md");
    expect(merged?.previewHtml).toBe("<p>kept</p>");
    expect(merged?.hydrated).toBe(true);
    expect(hydrated.scheduleHydrationPath).not.toHaveBeenCalled();
  });

  it("prepares a kind-changing rename through the runtime cache before installation", () => {
    const { context, controller, prepareRecordsFromCache, scheduleHydrationPath } = createHarness();
    const liveCanvas = Object.assign(new TFile(), {
      path: "old/nested/board.canvas",
      basename: "board",
      extension: "canvas",
      stat: { ctime: 8, mtime: 9 },
    });
    (context.getApp() as any).vault.getAbstractFileByPath = () => liveCanvas;
    context.store.replaceBaseCards([{
      file: Object.assign(new TFile(), { path: "old/nested/note.md" }),
      fileKind: "markdown",
      path: "old/nested/note.md",
      title: "note",
      ctime: 1,
      mtime: 1,
      excerpt: "text",
      previewHtml: "<p>text</p>",
      previewMode: "text",
      hydrated: true,
      taskSummary: null,
    }]);

    const result = controller.handleVaultMutation({
      eventType: "rename",
      path: "old/nested/board.canvas",
      oldPath: "old/nested/note.md",
      isFolder: false,
      fileKind: "canvas",
    });

    expect(result.incrementalResult).toEqual({ handled: true, action: "updated" });
    expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
    expect(prepareRecordsFromCache.mock.calls[0]?.[0]).toHaveLength(1);
    expect(prepareRecordsFromCache.mock.calls[0]?.[0]?.[0]?.fileKind).toBe("canvas");
    const installed = context.store.getBaseCard("old/nested/board.canvas");
    expect(installed?.fileKind).toBe("canvas");
    expect(installed?.file).toBe(liveCanvas);
    // The preparation mock does not hydrate, so the fresh record stays a
    // hydration candidate and is scheduled because it is visible.
    expect(scheduleHydrationPath).toHaveBeenCalledWith("old/nested/board.canvas");
  });

  it("clears cross-scope records before loading and commits one prepared projection", async () => {
    const harness = createHarness();
    const { context, controller, projectVisibleCards, prepareRecordsFromCache,
      publishLoadStart, publishLoadCommit, hydrateStartupCardPaths } = harness;
    const oldFile = Object.assign(new TFile(), { path: "old.md", basename: "old", stat: { ctime: 1, mtime: 1 } });
    context.store.replaceBaseCards([{ file: oldFile, fileKind: "markdown", path: oldFile.path,
      title: "old", ctime: 1, mtime: 1, excerpt: "old", previewHtml: "old", previewMode: "text", hydrated: true, taskSummary: null }]);
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
      title: "a", ctime: 1, mtime: 1, excerpt: "old", previewHtml: "old", previewMode: "text" as const, hydrated: true, taskSummary: null };
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

  it("reconciles a loaded card out when refreshed metadata ends its Box membership", () => {
    const memberPath = "notes/member.md";
    const siblingPath = "notes/sibling.md";
    const { context, controller } = createHarness({
      isPathInBox: (path) => path === siblingPath,
    });
    const makeRecord = (path: string): NoteCardRecord => ({
      file: Object.assign(new TFile(), { path }),
      fileKind: "markdown",
      path,
      title: path,
      ctime: 1,
      mtime: 1,
      excerpt: "",
      previewHtml: "",
      previewMode: "empty",
      hydrated: false,
      taskSummary: null,
    });
    context.store.setScope(createBoxScope("box-1"));
    context.store.replaceBaseCards([makeRecord(memberPath), makeRecord(siblingPath)]);

    expect(controller.reconcileMetadataMembershipForPath(memberPath)).toBe("left");
    expect(context.store.getBaseCards().map((card) => card.path)).toEqual([siblingPath]);
    expect(controller.reconcileMetadataMembershipForPath(memberPath)).toBe("unchanged");
    expect(controller.reconcileMetadataMembershipForPath(siblingPath)).toBe("unchanged");
  });

  it("enters an absent matching file through the factory and the active box sort", () => {
    const enteringPath = "notes/entering.md";
    const existingPath = "notes/existing.md";
    const { context, controller, prepareRecordsFromCache, scheduleHydrationPath } = createHarness({
      isPathInBox: (path) => path === enteringPath,
    });
    const app = context.getApp() as any;
    const enteringFile = Object.assign(new TFile(), {
      path: enteringPath,
      basename: "entering",
      stat: { ctime: 5, mtime: 50 },
    });
    const existingFile = Object.assign(new TFile(), {
      path: existingPath,
      basename: "existing",
      stat: { ctime: 1, mtime: 10 },
    });
    app.vault.getAbstractFileByPath = (path: string) =>
      path === enteringPath ? enteringFile : path === existingPath ? existingFile : null;
    context.store.setScope(createBoxScope("box-1"));
    context.store.replaceBaseCards([membershipRecord(existingPath)]);

    expect(controller.reconcileMetadataMembershipForPath(enteringPath)).toBe("entered");
    expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
    expect(prepareRecordsFromCache.mock.calls[0]?.[0]).toHaveLength(1);
    // Descending mtime sort places the fresh record (mtime 50) first.
    expect(context.store.getBaseCards().map((card) => card.path)).toEqual([
      enteringPath,
      existingPath,
    ]);
    const entered = context.store.getBaseCard(enteringPath);
    expect(entered?.file).toBe(enteringFile);
    expect(entered?.ctime).toBe(5);
    expect(entered?.mtime).toBe(50);
    expect(entered?.taskSummary).toBeNull();
    // The controller owns reprojection/hydration, not the reconcile itself.
    expect(scheduleHydrationPath).not.toHaveBeenCalled();
    expect(controller.reconcileMetadataMembershipForPath(enteringPath)).toBe("unchanged");
  });

  it("treats a missing or unsupported live file as an unchanged no-op on entry", () => {
    const missingPath = "notes/missing.md";
    const unsupportedPath = "notes/board.sketch";
    const { context, controller } = createHarness({
      isPathInBox: () => true,
    });
    const app = context.getApp() as any;
    app.vault.getAbstractFileByPath = (path: string) =>
      path === unsupportedPath ? Object.assign(new TFile(), { path: unsupportedPath }) : null;
    context.store.setScope(createBoxScope("box-1"));
    context.store.replaceBaseCards([]);

    expect(controller.reconcileMetadataMembershipForPath(missingPath)).toBe("unchanged");
    expect(controller.reconcileMetadataMembershipForPath(unsupportedPath)).toBe("unchanged");
    expect(context.store.getBaseCards()).toEqual([]);
  });

  it("keeps manual membership and exclusions at isBoxMember precedence", () => {
    const manualPath = "notes/manual.md";
    const excludedPath = "notes/excluded.md";
    const box: CardBoxDefinition = {
      ...propertyBox({ kind: "text", value: "open" }),
      manualPaths: [manualPath],
      excludedPaths: [excludedPath],
    };
    const { context, controller } = createHarness({
      isPathInBox: (path) => isBoxMember(context.getApp(), path, box),
    });
    context.store.setScope(createBoxScope("box-1"));
    context.store.replaceBaseCards([membershipRecord(manualPath), membershipRecord(excludedPath)]);

    // Manual membership wins even though no rule matches.
    expect(controller.reconcileMetadataMembershipForPath(manualPath)).toBe("unchanged");
    // Exclusion wins even though the folder rule would match.
    expect(controller.reconcileMetadataMembershipForPath(excludedPath)).toBe("left");
    expect(context.store.getBaseCards().map((card) => card.path)).toEqual([manualPath]);
  });

  it("V-G2 reconciles a missing-clause member out once metadata arrives with a value", () => {
    const memberPath = "notes/member.md";
    const box = propertyBox({ kind: "missing" });
    const { context, controller } = createHarness({
      isPathInBox: (path) => isBoxMember(context.getApp(), path, box),
    });
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) =>
      path === memberPath ? Object.assign(new TFile(), { path }) : null;
    context.store.setScope(createBoxScope("box-1"));
    context.store.replaceBaseCards([membershipRecord(memberPath)]);

    expect(controller.reconcileMetadataMembershipForPath(memberPath)).toBe("unchanged");

    (context.getApp() as any).metadataCache.getFileCache = vi.fn(() => ({
      frontmatter: { status: "done" },
    }));
    expect(controller.reconcileMetadataMembershipForPath(memberPath)).toBe("left");
    expect(context.store.getBaseCards().map((card) => card.path)).toEqual([]);
  });

  it("V-G2 reconciles a member out when a frontmatter change ends a valued-clause match", () => {
    const memberPath = "notes/member.md";
    const box = propertyBox({ kind: "text", value: "open" });
    const { context, controller } = createHarness({
      isPathInBox: (path) => isBoxMember(context.getApp(), path, box),
    });
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) =>
      path === memberPath ? Object.assign(new TFile(), { path }) : null;
    context.store.setScope(createBoxScope("box-1"));
    context.store.replaceBaseCards([membershipRecord(memberPath)]);
    (context.getApp() as any).metadataCache.getFileCache = vi.fn(() => ({
      frontmatter: { status: "open" },
    }));

    expect(controller.reconcileMetadataMembershipForPath(memberPath)).toBe("unchanged");

    (context.getApp() as any).metadataCache.getFileCache = vi.fn(() => ({
      frontmatter: { status: "done" },
    }));
    expect(controller.reconcileMetadataMembershipForPath(memberPath)).toBe("left");
    expect(context.store.getBaseCards().map((card) => card.path)).toEqual([]);
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

  it("populates taskSummary from the metadata cache on folder load", async () => {
    const { context, controller } = createHarness();
    const nextFile = Object.assign(new TFile(), {
      path: "next/a.md",
      basename: "a",
      extension: "md",
      stat: { ctime: 2, mtime: 2 },
    });
    const folder = Object.assign(new TFolder(), { path: "next", children: [nextFile] });
    (context.getApp() as any).vault.getAbstractFileByPath = (path: string) =>
      path === "next" ? folder : null;
    (context.getApp() as any).metadataCache.getFileCache = vi.fn(() => ({
      listItems: [{ task: " " }, { task: "x" }],
    }));

    await controller.handleScopeSelection(
      controller.createProgrammaticSelectionRequest(createFolderScope("next", true), true),
    );

    expect(context.store.getBaseCards()).toHaveLength(1);
    expect(context.store.getBaseCards()[0]?.taskSummary).toEqual({ total: 2, incomplete: 1 });
  });

  describe("buildLoadKey", () => {
    function configurePerBoxSort() {
      const { context, controller } = createHarness();
      const settings = context.getSettings();
      settings.sort = { field: "mtime", direction: "desc" };
      settings.boxes = [{
        id: "box-1",
        name: "Ideas",
        rules: [],
        manualPaths: [],
        excludedPaths: [],
        pinnedPaths: [],
        sort: { field: "name", direction: "asc" },
        group: { ...DEFAULT_GROUP_SPEC },
      }];
      return { controller, settings };
    }

    it("returns the box sort by reference for a resolvable box scope", () => {
      const { controller, settings } = configurePerBoxSort();
      const result = controller.buildLoadKey(createBoxScope("box-1"));

      expect(result.sort).toEqual({ field: "name", direction: "asc" });
      expect(result.sort).toBe(settings.boxes[0].sort);
    });

    it("returns the global sort by reference for a folder scope", () => {
      const { controller, settings } = configurePerBoxSort();
      const result = controller.buildLoadKey(createFolderScope("notes", true));

      expect(result.sort).toBe(settings.sort);
    });

    it("falls back to the global sort by reference when the box id is unresolvable", () => {
      const { controller, settings } = configurePerBoxSort();
      const result = controller.buildLoadKey(createBoxScope("ghost"));

      expect(result.sort).toBe(settings.sort);
    });

    it("embeds the box sort and membership signature in the load-key identity", () => {
      const { controller, settings } = configurePerBoxSort();
      const serialized = controller.serializeLoadKey(controller.buildLoadKey(createBoxScope("box-1")));

      expect(serialized).toContain("name::asc");
      expect(serialized).toContain(getBoxMembershipSignature(settings.boxes[0]));
    });
  });
});
