import { RuntimeActivity } from "./runtime/activity";
import { resolveRuntimeResourceBudget } from "./runtime/resource-budget";
/*
 * Copyright (c) 2026 kenanlian
 * SPDX-License-Identifier: GPL-3.0-only
 * See LICENSE for the GNU General Public License, version 3.
 */

import { QuickInputSubmissionCoordinator, validateQuickInputBoxes } from "./services/QuickInputSubmissionCoordinator";
import { NoteCreationService, NoteInputError } from "./services/NoteCreationService";
import { TemplateStorageService } from "./services/TemplateStorageService";
import { TemplateActions } from "./view/actions/template-actions";
import { focusTemplateEditor, focusTemplateNote } from "./input/template-editor";
import type { QuickInputRequest, TemplateNoteCursor } from "./note-input";
import { TemplateReferenceReconciler } from "./services/TemplateReferenceReconciler";
import { QUICK_INPUT_VIEW, QuickInputView } from "./input/QuickInputView";
import { createRuntimePlatformServices } from "./runtime/platform-services";
import { resolveRuntimeOpenBehavior } from "./runtime/capabilities";
import type { RuntimeActionResult, RuntimeUnavailable } from "./runtime/platform";
import { QuickInputShortcut } from "./input/QuickInputShortcut";
import type { QuickInputWindowManager } from "./input/QuickInputWindowManager";

import {
  addIcon,
  Component,
  MarkdownView,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf,
  View,
  debounce,
} from "obsidian";
import { isSupportedImagePath } from "./images/image-source";
import { ThumbnailService } from "./images/ThumbnailService";
import { ThumbnailStore } from "./images/ThumbnailStore";
import { ThumbnailWorker } from "./images/ThumbnailWorker";
import { resolveVaultCacheIdentity } from "./runtime/vault-namespace";
import { EditorView, dropCursor } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { getUiStrings, resolveUiLanguage, type UiLanguage, type UiStrings } from "./i18n";
import { CardWorkspaceSettingTab } from "./CardWorkspaceSettingTab";
import { EditorDropController } from "./services/EditorDropController";
import { NativeFileDragController } from "./services/NativeFileDragController";
import type { CardFileDragStartPayload } from "./view/types";
import { BoxReconciler } from "./services/BoxReconciler";
import { addManualPaths, findCardBox, upsertCardBox } from "./view/card-boxes";
import { FavoriteReconciler } from "./services/FavoriteReconciler";
import { NavigationWorkspaceReconciler } from "./services/NavigationWorkspaceReconciler";
import { PinnedPathReconciler } from "./services/PinnedPathReconciler";
import { SearchCoordinator, type SearchSnapshotListener } from "./services/SearchCoordinator";
import { SettingsStore, hasPatchValues } from "./services/SettingsStore";
import { VaultEventBus, type VaultEventListener } from "./services/VaultEventBus";
import { MetadataEventBus, type MetadataEventListener } from "./services/MetadataEventBus";
import type { VaultMutationEvent, VaultMutationEventType } from "./services/vault-events";
import { FOLDER_CARD_VIEW, FolderCardView } from "./view/FolderCardView";
import type {
  SearchIndexObservabilitySnapshot,
  SearchService,
  SearchServiceSnapshot,
} from "./search";
import type { OpenDestination, PartialPluginSettings, PluginSettings } from "./settings";
import type { FolderSelectionRequest, FolderSelectionSource, SelectionResult } from "./view/types";
import { resolveCardFileKind } from "./view/file-kind";
import { canOpenFileInObsidian } from "./file-visibility";
import { createFolderScope, type CardScope } from "./view/scope";
import { locationExistsInText, type CardOpenLocation, type LinkCardLocation, type LinkReferenceCardLocation, type SearchSnippetCardLocation } from "./view/link-card-location";
import { resolveSearchSnippetLocation } from "./search";
import { findSearchContextLocation } from "./view/context-preview";
import { resolveSettingsUpdateIntent } from "./view/update-intent";
import { activateDeferredView } from "./view/deferred-view-activation";
import { BULK_ADD_TO_BOX_ICON, BULK_ADD_TO_BOX_ICON_SVG, BULK_REMOVE_FROM_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON_SVG, CARD_WORKSPACE_ICON, CARD_WORKSPACE_ICON_SVG, PLAIN_FOLDER_ICON, PLAIN_FOLDER_ICON_SVG } from "./icons";

function normalizeFolderScopePath(path: string): string { return path === "/" ? "" : path; }

export default class CardWorkspacePlugin extends Plugin {
  private readonly popoutEvents = new Map<Window, Component>();
  private quickInputSubmissions: QuickInputSubmissionCoordinator | null = null;
  private noteCreationService: NoteCreationService | null = null;
  private workspaceSettingTab: CardWorkspaceSettingTab | null = null;
  private readonly templateStorageService = new TemplateStorageService({
    app: this.app, getSettings: () => this.getSettings(), saveSettings: async (patch) => { await this.saveSettings(patch); await this.flushSettings(); },
    flushVaultEvents: () => this.vaultEventBus.flushPendingEvents(),
    assertWritable: async () => {
      await this.settingsReadyPromise;
      if (this.disposed) throw new Error("Plugin unloaded");
      await this.settingsStore.updateFlat({});
    },
  });
  readonly runtimeActivity = new RuntimeActivity();
  private readonly activityWindows = new Map<Window, () => void>();
  readonly runtimePlatform = createRuntimePlatformServices(() => this.app, window);
  readonly resourceBudget = resolveRuntimeResourceBudget(this.runtimePlatform.device);
  private resolvedCacheIdentity: ReturnType<typeof resolveVaultCacheIdentity> | null = null;
  private get vaultCacheIdentity() { return this.resolvedCacheIdentity ??= resolveVaultCacheIdentity(this.app, this.runtimePlatform.device); }
  private get vaultCacheNamespace(): string { return this.vaultCacheIdentity.namespace; }
  readonly quickInputShortcut = new QuickInputShortcut({
    bridge: () => {
      const result = this.runtimePlatform.quickInputDesktop();
      if (result.outcome === "unavailable") throw new Error("Desktop shortcut unavailable");
      return result.value.shortcuts();
    },
    save: async (accelerator) => { await this.saveSettings({ quickInputGlobalShortcut: accelerator }); await this.flushSettings(); },
    open: () => { void this.openQuickInput(); },
  });
  private mobileQuickInput: import("./input/MobileQuickInput").MobileQuickInput | null = null;
  private mobileQuickInputOpening: Promise<RuntimeActionResult> | null = null;
  private quickInputManager: QuickInputWindowManager | null = null;
  private quickInputInitialization: Promise<QuickInputWindowManager | null> | null = null;
  private readonly templateReferenceReconciler = new TemplateReferenceReconciler({
    getSettings: () => this.getSettings(), saveSettings: (patch) => this.saveSettings(patch),
  });
  private readonly uiLanguage: UiLanguage = resolveUiLanguage();
  private readonly settingsStore = new SettingsStore({
    load: () => this.loadData(),
    save: (data) => this.saveData(data),
    local: {
      load: () => this.app.loadLocalStorage("card-workspace.device-settings.v1"),
      save: (data) => this.app.saveLocalStorage("card-workspace.device-settings.v1", data),
      onError: (error) => { console.warn("[Card Workspace] Device settings unavailable", error); new Notice(this.getUiStrings().mobile.localStorageUnavailable); },
    },
  });
  private thumbnails: { service: ThumbnailService; vault: string } | null = null;
  private readonly scopeHistoryAnchors = new WeakMap<WorkspaceLeaf, Map<string, import("./view/scroll-anchoring").RowAnchor>>();
  getScopeHistoryAnchors(leaf: WorkspaceLeaf) {
    let anchors = this.scopeHistoryAnchors.get(leaf);
    if (!anchors) { anchors = new Map(); this.scopeHistoryAnchors.set(leaf, anchors); }
    return anchors;
  }
  readonly navigationSessionId = `${Date.now()}-${Math.random()}`;
  private selectionRequestSeq = 0;
  private cardOpenSeq = 0;
  private templateOpenDepth = 0;
  private templateNoteFocusAbort: AbortController | null = null;
  private cancelLinkCorrection: (() => void) | null = null;
  private latestHandledRequestId = 0;
  private vaultObserversRegistered = false;
  private metadataObserversRegistered = false;
  private vaultEventListenersRegistered = false;
  private readonly vaultEventBus = new VaultEventBus();
  private readonly metadataEventBus = new MetadataEventBus();
  private vaultEventUnsubscribers: Array<() => void> = [];
  private disposed = false; private settingsReadyPromise: Promise<void> = Promise.resolve();
  private layoutReadyTask: Promise<void> = Promise.resolve(); private startupPromise: Promise<void> = Promise.resolve();
  private readonly editorDropController = new EditorDropController({
    app: this.app,
    getSettings: () => this.getSettings(),
    getUiStrings: () => this.getUiStrings(),
  });
  private readonly nativeFileDragController = new NativeFileDragController(() => this.app);
  private readonly searchCoordinator = new SearchCoordinator({
    workGate: this.runtimeActivity.background,
    resourceBudget: this.resourceBudget,
    getVaultNamespace: () => this.vaultCacheNamespace,
    canPersist: () => this.vaultCacheIdentity.persistent,
    getApp: () => this.app,
    getUiStrings: () => this.getUiStrings(),
    getPluginVersion: () => (this.manifest as { version?: string } | undefined)?.version ?? "0.0.0",
  });
  private debouncedNavStateRefresh = debounce(
    () => {
      this.withFolderViews((view) => {
        view.refreshNavState();
      });
    },
    250,
    false,
  );
  private readonly boxReconciler = new BoxReconciler({
    getSettings: () => this.getSettings(),
    updateUserData: (patch) => this.settingsStore.updateUserData(patch),
    onUserDataReconciled: () => this.debouncedNavStateRefresh(),
  });
  private readonly favoriteReconciler = new FavoriteReconciler({
    getSettings: () => this.getSettings(),
    updateUserData: (patch) => this.settingsStore.updateUserData(patch),
    onUserDataReconciled: () => this.debouncedNavStateRefresh(),
    getApp: () => this.app,
  });
  private readonly navigationWorkspaceReconciler = new NavigationWorkspaceReconciler({
    workGate: this.runtimeActivity.background,
    getSettings: () => this.getSettings(),
    saveSettings: (patch) => this.saveSettings(patch),
    getApp: () => this.app,
  });
  private readonly pinnedPathReconciler = new PinnedPathReconciler({
    getSettings: () => this.getSettings(),
    saveSettings: (patch) => this.saveSettings(patch),
  });

  startCardFileDrag({ event, path }: CardFileDragStartPayload): (() => void) | null {
    return this.runtimePlatform.capabilities.nativeFileDrag ? this.nativeFileDragController.start(event, path) : null;
  }

  /** Bounded on-demand evidence; per-view caches are additive, not process limits. */
  getRuntimeDiagnostics() {
    const views: ReturnType<FolderCardView["getRuntimeDiagnostics"]>[] = [];
    let viewCount = 0, activePreviewReads = 0, previewCacheEntries = 0, diagramBytes = 0, searchSourceBytes = 0, objectUrls = 0;
    this.withFolderViews((view) => {
      const snapshot = view.getRuntimeDiagnostics(); viewCount++;
      activePreviewReads += snapshot.preview.active; previewCacheEntries += snapshot.preview.cacheEntries;
      diagramBytes += snapshot.preview.diagramBytes; searchSourceBytes += snapshot.preview.searchSources.estimatedBytes;
      objectUrls += snapshot.images.objectUrls;
      if (views.length < 16) views.push(snapshot);
    });
    return { device: this.runtimePlatform.device, storage: this.vaultCacheIdentity, settingsStorage: this.settingsStore.getPersistenceDiagnostics(), resourceBudget: this.resourceBudget, activity: this.runtimeActivity.getDiagnostics(),
      search: this.searchCoordinator.getResourceDiagnostics(), thumbnails: this.thumbnails?.service.getDiagnostics() ?? null,
      totals: { viewCount, activePreviewReads, previewCacheEntries, diagramBytes, searchSourceBytes, objectUrls }, views, omittedViews: Math.max(0, viewCount - views.length) };
  }

  getThumbnailService(): { service: ThumbnailService; vault: string } | null {
    if (this.disposed || this.getSettings().cardImageMode === "off") return null;
    if (!this.thumbnails) {
      const vault = this.vaultCacheNamespace;
      const service = new ThumbnailService({
        workGate: this.runtimeActivity.background,
        resourceBudget: this.resourceBudget,
        storage: new ThumbnailStore(vault, this.vaultCacheIdentity.persistent ? undefined : null, this.resourceBudget.thumbnails.diskEntries, this.resourceBudget.thumbnails.diskBytes),
        generator: new ThumbnailWorker(this.resourceBudget.image),
        isCurrent: (fingerprint) => {
          const file = this.app.vault.getAbstractFileByPath(fingerprint.path);
          return file instanceof TFile && file.stat.mtime === fingerprint.mtime && file.stat.size === fingerprint.size;
        },
        read: async (fingerprint) => {
          const file = this.app.vault.getAbstractFileByPath(fingerprint.path);
          if (!(file instanceof TFile) || file.stat.mtime !== fingerprint.mtime || file.stat.size !== fingerprint.size) throw new Error("Image changed");
          return this.app.vault.readBinary(file);
        },
      });
      this.thumbnails = { service, vault };
    }
    return this.thumbnails;
  }

  onload(): void {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") this.trackActivityWindow(window);
    this.registerVaultEventListeners();
    this.registerCustomIcons();
    this.register(() => this.disposeRuntime());
    this.registerView(FOLDER_CARD_VIEW, (leaf) => new FolderCardView(leaf, this));
    this.addRibbonIcon(CARD_WORKSPACE_ICON, this.getUiStrings().app.ribbonTooltip, () => {
      this.runDetached(this.activateAndEnsureScope(true), "View activation failed.");
    });
    this.workspaceSettingTab = new CardWorkspaceSettingTab(this.app, this);
    this.addSettingTab(this.workspaceSettingTab);
    this.registerHoverLinkSource("card-workspace", {
      display: this.getUiStrings().app.hoverSourceDisplay,
      defaultMod: true,
    });

    this.addCommand({
      id: "open-view",
      name: this.getUiStrings().app.openCardWorkspaceViewCommand,
      callback: () => {
        this.runDetached(this.activateAndEnsureScope(true), "View activation failed.");
      },
    });
    this.registerView(QUICK_INPUT_VIEW, (leaf) => new QuickInputView(leaf, {
      getTitle: () => this.getUiStrings().noteInput.quickInput,
      discard: (view) => this.app.workspace.onLayoutReady(() => { view.leaf.detach(); }),
    }));
    const templateActions = new TemplateActions({
      app: this.app, getSettings: () => this.getSettings(),
      saveSettings: async (patch) => { await this.saveSettings(patch); await this.flushSettings(); },
      openNote: (path, selectTitle) => this.openTemplateEditor(path, selectTitle),
      runOperation: (work) => this.runTemplateOperation(work),
      notify: (message) => { if (!this.disposed) new Notice(message); }, getStrings: () => this.getUiStrings(),
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!this.disposed && file instanceof TFile) templateActions.appendFileMenu(menu, file);
    }));
    this.registerEvent(this.app.workspace.on("quit", () => this.disposeRuntime()));
    this.registerEvent(this.app.workspace.on("window-close", (_workspaceWindow, win) => {
      this.popoutEvents.get(win)?.unload(); this.popoutEvents.delete(win);
      this.activityWindows.get(win)?.(); this.activityWindows.delete(win);
    }));
    this.registerDomEvent(window, "unload", () => this.disposeRuntime());
    if (this.runtimePlatform.capabilities.quickInput) this.addCommand({ id: "quick-input", name: this.getUiStrings().noteInput.quickInputCommand,
      callback: () => { void this.openQuickInput(typeof activeWindow !== "undefined" ? activeWindow : window); } });
    this.registerSearchCommands();
    this.registerEvent(this.app.workspace.on("layout-change", () => this.runtimeActivity.refresh()));
    if (this.runtimePlatform.capabilities.editorDrop && typeof document !== "undefined") {
      this.registerDomEvent(document, "dragstart", (event) => this.editorDropController.handleDragStart(event));
    }
    this.registerEvent(this.app.workspace.on("window-open", (_workspaceWindow, win) => {
      this.trackActivityWindow(win);
      this.popoutEvents.get(win)?.unload();
      const events = new Component(); events.load();
      if (this.runtimePlatform.capabilities.editorDrop) events.registerDomEvent(win.document, "dragstart", (event) => this.editorDropController.handleDragStart(event));
      this.popoutEvents.set(win, events);
    }));
    if (this.runtimePlatform.capabilities.editorDrop) this.registerEditorExtension([
      dropCursor(),
      Prec.highest(EditorView.domEventHandlers({
        dragover: (event) => this.editorDropController.handleDragOver(event),
        drop: (event, view) => this.editorDropController.handleDomDrop(event, view),
      })),
    ]);
    this.registerEvent(
      this.app.workspace.on("editor-drop", (event, editor, info) => {
        if (!this.runtimePlatform.capabilities.editorDrop || event.defaultPrevented) return;
        if (this.editorDropController.handleWorkspaceEditorDrop(event, editor, info)) event.preventDefault();
      }),
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        this.editorDropController.handleEditorChange(editor, info);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.editorDropController.handleActiveLeafChange(leaf);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.editorDropController.handleTargetChange();
        this.syncSelection(file instanceof TFile ? file.path : null);
      }),
    );

    this.settingsReadyPromise = this.loadSettings();
    this.startupPromise = this.settingsReadyPromise.catch((error: unknown) =>
      console.error("[Card Workspace] Plugin load failed.", error));
    this.app.workspace.onLayoutReady(() => {
      this.layoutReadyTask = this.runLayoutReadyStartup().catch((error: unknown) =>
        { if (!this.disposed) console.error("[Card Workspace] Plugin startup failed.", error); });
      this.startupPromise = this.layoutReadyTask;
    });
  }
  private async runLayoutReadyStartup(): Promise<void> {
    await this.settingsReadyPromise;
    if (this.disposed) return;
    // Includes deferred restored views: tokens are runtime-only, never revive drafts.
    for (const leaf of this.app.workspace.getLeavesOfType(QUICK_INPUT_VIEW)) {
      leaf.detach();
    }
    if (this.runtimePlatform.capabilities.globalShortcut) await this.quickInputShortcut.start(this.getSettings().quickInputGlobalShortcut);
    if (this.disposed) return;
    this.app.workspace.iterateAllLeaves?.((leaf) => {
      if (leaf.view.getViewType() !== QUICK_INPUT_VIEW) {
        const win = leaf.view.containerEl?.ownerDocument?.defaultView;
        if (win) this.trackActivityWindow(win);
      }
    });
    this.registerVaultObservers(); this.registerMetadataObservers();
    this.syncSelection(this.app.workspace.getActiveFile()?.path ?? null);
    // Session restore never creates a leaf: it only reloads a view the user left open.
    await this.activateAndEnsureScope(false);
    if (this.disposed) return;
    this.runDetached(this.navigationWorkspaceReconciler.reconcileInitial(),
      "Initial navigation reconciliation failed.");
    await this.searchCoordinator.initialize(); if (this.disposed) return;
    this.searchCoordinator.flushDeferredStartupWork();
  }

  private trackActivityWindow(win: Window): void {
    if (!this.activityWindows.has(win) && typeof win.document?.addEventListener === "function") {
      this.activityWindows.set(win, this.runtimeActivity.trackDocument(win.document));
    }
  }

  private registerCustomIcons(): void {
    addIcon(CARD_WORKSPACE_ICON, CARD_WORKSPACE_ICON_SVG);
    addIcon(PLAIN_FOLDER_ICON, PLAIN_FOLDER_ICON_SVG);
    addIcon(BULK_ADD_TO_BOX_ICON, BULK_ADD_TO_BOX_ICON_SVG);
    addIcon(BULK_REMOVE_FROM_BOX_ICON, BULK_REMOVE_FROM_BOX_ICON_SVG);
  }

  onunload(): void {
    this.disposeRuntime(); this.runDetached(
      this.settingsStore.flushPendingWrites(), "Settings flush failed.");
  }

  private disposeRuntime(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtimeActivity.dispose(); this.activityWindows.clear();
    this.popoutEvents.forEach((events) => events.unload()); this.popoutEvents.clear();
    this.quickInputShortcut.dispose();
    this.quickInputManager?.dispose();
    this.app.workspace.getLeavesOfType(QUICK_INPUT_VIEW).forEach((leaf) => leaf.detach());
    this.quickInputManager = null;
    this.quickInputInitialization = null;
    this.noteCreationService = null;
    this.templateNoteFocusAbort?.abort();
    this.templateNoteFocusAbort = null;
    this.workspaceSettingTab = null;
    this.mobileQuickInput?.dispose(); this.mobileQuickInput = null;
    this.editorDropController.dispose();
    this.nativeFileDragController.dispose();
    this.cancelLinkCorrection?.();
    this.cancelLinkCorrection = null;
    this.vaultEventBus.dispose();
    this.metadataEventBus.dispose();
    const navStateRefresh = this.debouncedNavStateRefresh as (() => void) & {
      cancel?: () => void;
    };
    navStateRefresh.cancel?.();
    this.favoriteReconciler.dispose();
    this.navigationWorkspaceReconciler.dispose();
    for (const unsubscribe of this.vaultEventUnsubscribers) {
      unsubscribe();
    }
    this.vaultEventUnsubscribers = [];
    this.vaultEventListenersRegistered = false;
    this.searchCoordinator.dispose();
    this.thumbnails?.service.dispose();
    this.thumbnails = null;
    this.withFolderViews((view) => {
      view.cleanupLifecycle();
    });
  }
  private runDetached(work: Promise<unknown>, detail: string): void {
    void work.catch((error: unknown) =>
      { if (!this.disposed) console.warn(`[Card Workspace] ${detail}`, error); });
  }

  private getNoteCreationService(): NoteCreationService {
    return this.noteCreationService ??= new NoteCreationService(this.app, (request) => validateQuickInputBoxes(this.getSettings(), request));
  }

  async createNoteInFolder(folderPath: string, tags: string[] = [], properties: Record<string, string | number | boolean> = {}, boxId?: string): Promise<void> {
    if (boxId !== undefined && !findCardBox(this.getSettings().boxes, boxId)) throw new NoteInputError("missing-box");
    const result = await this.getNoteCreationService().createScopeNote({
      folderPath: normalizeFolderScopePath(folderPath), tags: [...tags], properties: { ...properties },
      baseName: this.getUiStrings().app.untitledNoteBaseName,
      emptyTags: this.getSettings().newNoteTemplate === "tags-frontmatter",
    });
    if (this.disposed) return;
    if (boxId !== undefined) {
      const settings = this.getSettings();
      const box = findCardBox(settings.boxes, boxId);
      if (!box) throw new NoteInputError("missing-box");
      await this.saveSettings({ boxes: upsertCardBox(settings.boxes, addManualPaths(box, [result.file.path])) });
    }
    if (!this.disposed) await this.openNoteFromCard(result.file.path, "new-tab");
  }

  async createNoteFromTemplate(id: string): Promise<void> {
    const template = this.getSettings().noteTemplates.find((entry) => entry.id === id);
    if (!template) { new Notice(this.getUiStrings().noteInput.templateNotFound); return; }
    this.templateNoteFocusAbort?.abort();
    const controller = new AbortController();
    this.templateNoteFocusAbort = controller;
    const openSeq = this.cardOpenSeq;
    const doc = this.app.workspace.getActiveViewOfType(View)?.containerEl?.ownerDocument ?? window.document;
    const cancel = () => controller.abort();
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
    for (const event of events) doc?.addEventListener(event, cancel, true);
    const leafChange = this.app.workspace.on("active-leaf-change", cancel);
    let watchingLeaf = true;
    const stopWatchingLeaf = () => {
      if (watchingLeaf) this.app.workspace.offref?.(leafChange);
      watchingLeaf = false;
    };
    const cleanup = () => {
      stopWatchingLeaf();
      for (const event of events) doc?.removeEventListener(event, cancel, true);
    };
    controller.signal.addEventListener("abort", cleanup, { once: true });
    try {
      const result = await this.getNoteCreationService().createTemplateNote({ ...template }, new Date());
      if (this.disposed || controller.signal.aborted || openSeq !== this.cardOpenSeq) return;
      stopWatchingLeaf(); // Opening our own target is an intentional leaf change.
      await this.openTemplateNoteFile(result.file.path, result.cursor, controller.signal);
    } catch (error) { new Notice(this.getUiStrings().noteInput.createFailed(this.describeNoteInputError(error))); }
    finally {
      controller.abort();
      cleanup();
      if (this.templateNoteFocusAbort === controller) this.templateNoteFocusAbort = null;
    }
  }

  async openTemplateNoteFile(path: string, cursor?: TemplateNoteCursor, signal?: AbortSignal): Promise<void> {
    this.templateOpenDepth += 1;
    try {
      const opening = this.openNoteFromCard(path, "new-tab");
      const openSeq = this.cardOpenSeq;
      await opening;
      if (!cursor || !signal || signal.aborted || this.disposed || openSeq !== this.cardOpenSeq) return;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      const current = () => !this.disposed && openSeq === this.cardOpenSeq
        && this.app.workspace.getActiveViewOfType(MarkdownView) === view && view?.file?.path === path;
      if (view && current()) await focusTemplateNote(view, cursor, current, signal);
    }
    finally { this.templateOpenDepth -= 1; }
  }

  async openTemplateEditor(path: string, selectTitle = false): Promise<void> {
    await this.openTemplateNoteFile(path);
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view || view.file?.path !== path || this.disposed) return;
    await view.leaf.setViewState({ ...view.leaf.getViewState(), state: { ...view.getState(), mode: "source" } });
    if (this.disposed || this.app.workspace.getActiveViewOfType(MarkdownView) !== view || view.file?.path !== path) return;
    focusTemplateEditor(view, selectTitle, () => !this.disposed && this.app.workspace.getActiveViewOfType(MarkdownView) === view && view.file?.path === path);
  }

  runTemplateOperation(work: () => Promise<boolean>): Promise<boolean> { return this.templateStorageService.runExclusive(work); }
  changeTemplateStorageFolder(path: string): Promise<void> { return this.templateStorageService.changeFolder(path); }

  private describeNoteInputError(error: unknown): string {
    const strings = this.getUiStrings().noteInput;
    if (error instanceof NoteInputError) {
      switch (error.code) {
        case "missing-template-folder": return strings.targetFolderRequired;
        case "missing-folder": case "invalid-folder": return strings.targetFolderNotFound;
        case "missing-template": case "invalid-template": return strings.templateNotFound;
        case "target-conflict": return strings.targetConflict;
        case "invalid-filename": return strings.invalidFilename;
        case "unedited-template-title": return strings.editTitleRequired;
        case "invalid-config": case "empty-input": return strings.invalidQuickInputConfig;
        case "target-changed": return strings.targetChanged;
        case "pending-save-unavailable": return strings.pendingSaveUnavailable;
        case "moment-unavailable": case "invalid-date": return strings.dateFormatUnavailable;
        case "target-missing": return strings.targetNoteMissing;
        case "target-mode-changed": return strings.targetModeChanged;
        case "missing-box": return strings.missingBox;
      }
    }
    return error instanceof Error ? error.message : String(error);
  }

  appendMobileInsertMenu(menu: import("obsidian").Menu, path: string): void {
    if (this.runtimePlatform.device !== "desktop") this.editorDropController.appendMobileMenu(menu, path);
  }

  private submitQuickInput(request: QuickInputRequest) {
    this.quickInputSubmissions ??= new QuickInputSubmissionCoordinator({
      notes: this.getNoteCreationService(), getSettings: () => this.getSettings(),
      saveSettings: async (patch) => { await this.saveSettings(patch); await this.flushSettings(); },
    });
    return this.quickInputSubmissions.submit(request);
  }

  async openQuickInput(win?: Window): Promise<RuntimeActionResult> {
    if (this.runtimePlatform.quickInputPresentation === "modal") {
      await this.settingsReadyPromise;
      if (this.disposed) return { outcome: "unavailable", reason: "host" };
      if (this.mobileQuickInput?.isOpen()) { this.mobileQuickInput.focusDraft(); return { outcome: "ok", value: undefined }; }
      if (this.mobileQuickInputOpening) return this.mobileQuickInputOpening;
      this.mobileQuickInputOpening = import("./input/MobileQuickInput").then(({ MobileQuickInput }) => {
        if (this.disposed) return { outcome: "unavailable", reason: "host" } as const;
        this.mobileQuickInput = new MobileQuickInput({ app: this.app, phone: this.runtimePlatform.device === "phone",
          getSettings: () => this.getSettings(), getStrings: () => this.getUiStrings(), notify: message => { new Notice(message); },
          describeError: error => this.describeNoteInputError(error),
          submit: request => this.submitQuickInput(request),
        });
        this.mobileQuickInput.open(); return { outcome: "ok", value: undefined } as const;
      }).finally(() => { this.mobileQuickInputOpening = null; });
      return this.mobileQuickInputOpening;
    }
    const desktop = this.runtimePlatform.quickInputDesktop();
    if (desktop.outcome === "unavailable") return desktop;
    await this.settingsReadyPromise;
    if (this.disposed || win?.closed) return { outcome: "unavailable", reason: "host" };
    if (!this.quickInputInitialization) {
      this.quickInputInitialization = import("./input/QuickInputWindowManager").then(({ QuickInputWindowManager }) => {
        if (this.disposed) return null;
        this.quickInputManager = new QuickInputWindowManager({
          app: this.app, desktop: desktop.value, getSettings: () => this.getSettings(), getStrings: () => this.getUiStrings().noteInput,
          submit: request => this.submitQuickInput(request),
          describeError: (error) => this.describeNoteInputError(error),
          notify: (message) => { new Notice(message); },
        });
        return this.quickInputManager;
      }).catch((error: unknown) => {
        this.quickInputInitialization = null;
        if (!this.disposed) new Notice(this.getUiStrings().noteInput.openQuickInputFailed);
        console.warn("[Card Workspace] Quick input initialization failed.", error);
        return null;
      });
    }
    const manager = await this.quickInputInitialization;
    if (!this.disposed && !win?.closed && manager) {
      return await manager.open(win);
    }
    return { outcome: "unavailable", reason: "host" };
  }

  async openNoteFromCard(path: string, destination?: OpenDestination, location?: CardOpenLocation): Promise<void | RuntimeUnavailable> {
    if (destination === "new-window" && !this.runtimePlatform.capabilities.newWindow) return { outcome: "unavailable", reason: "platform" };
    const openSeq = ++this.cardOpenSeq;
    this.cancelLinkCorrection?.();
    this.cancelLinkCorrection = null;
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) {
      return;
    }

    if (!canOpenFileInObsidian(this.app, target)) {
      const result = await this.runtimePlatform.openExternal(target.path, this.getUiStrings().desktopShell);
      if (!result.ok) new Notice(result.error ?? this.getUiStrings().desktopShell.unavailable);
      return;
    }
    const leaf = await this.resolveOpenDestinationLeaf(destination);
    if (!leaf || openSeq !== this.cardOpenSeq) {
      if (!leaf && destination === "new-window") return { outcome: "unavailable", reason: "host" };
      return;
    }

    let requestedJump = location && "kind" in location
      ? location : this.getSettings().locateLinkCardOnOpen ? location : undefined;
    // Observe input across openFile too: file-open can synchronously re-point
    // the originating links view and replace its cards before opening settles.
    let inputDuringOpen = false;
    const markInput = (): void => { inputDuringOpen = true; };
    const inputEvents = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
    const inputTarget = leaf.view?.containerEl?.ownerDocument ?? leaf.view?.containerEl;
    const snippetJump = requestedJump && "kind" in requestedJump ? requestedJump : null;
    const leafChange = snippetJump ? this.app.workspace.on("active-leaf-change", (active) => {
      if (active !== leaf) inputDuringOpen = true;
    }) : null;
    if (snippetJump) {
      for (const event of inputEvents) inputTarget?.addEventListener(event, markInput, { capture: true, passive: true });
      requestedJump = { ...snippetJump, isCurrent: () => !inputDuringOpen && snippetJump.isCurrent?.() !== false };
    }
    try {
      await leaf.openFile(target, { active: true });
      if (openSeq !== this.cardOpenSeq || this.disposed) return;
      const jump = requestedJump && "query" in requestedJump
        ? leaf.view instanceof MarkdownView
          ? findSearchContextLocation(leaf.view.getViewData(), requestedJump.query)
          : null
        : requestedJump;
      if (jump && this.isCardOpenLeafActive(leaf)) {
        const positioned = "kind" in jump && jump.kind === "search-snippet"
          ? await this.positionSearchSnippet(leaf, target, jump, openSeq)
          : "kind" in jump && jump.kind === "link-reference"
            ? this.positionLinkReference(leaf, target, jump) : this.positionLinkCard(leaf, target, jump);
        if (positioned && openSeq === this.cardOpenSeq && !this.disposed) {
          this.scheduleLinkCorrection(leaf, target, jump, openSeq);
        }
      }
      if (openSeq === this.cardOpenSeq && !this.disposed) this.syncSelection(target.path);
    } finally {
      if (snippetJump) for (const event of inputEvents) inputTarget?.removeEventListener(event, markInput, { capture: true });
      if (leafChange) this.app.workspace.offref?.(leafChange);
    }
  }

  private positionLinkReference(leaf: WorkspaceLeaf, file: TFile, request: LinkReferenceCardLocation): boolean {
    if (!request.isCurrent()) return false;
    const view = leaf.view;
    const location = request.location;
    if (view instanceof MarkdownView && location.ch !== undefined && location.expectedText
      && !view.getViewData().split(/\r?\n/)[location.line]?.startsWith(location.expectedText, location.ch)) return false;
    return this.positionLinkCard(leaf, file, location);
  }

  private isCardOpenLeafActive(leaf: WorkspaceLeaf): boolean {
    const activeView = this.app.workspace.getActiveViewOfType(View);
    return !activeView || activeView === leaf.view;
  }

  private positionLinkCard(leaf: WorkspaceLeaf, file: TFile, location: LinkCardLocation): boolean {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file?.path !== file.path
      || !locationExistsInText(view.getViewData(), location)) return false;
    if (view.getMode() === "source") {
      const pos = { line: location.line, ch: location.ch ?? 0 };
      view.editor.setCursor(pos);
      view.editor.scrollIntoView({ from: pos, to: pos }, true);
    } else {
      view.setEphemeralState({ line: location.line });
    }
    return true;
  }

  private async positionSearchSnippet(
    leaf: WorkspaceLeaf, file: TFile, location: SearchSnippetCardLocation, openSeq: number,
  ): Promise<boolean> {
    const view = leaf.view;
    if (!(view instanceof MarkdownView) || view.file?.path !== file.path
      || this.app.vault.getAbstractFileByPath(file.path) !== file || location.isCurrent?.() === false) return false;
    const source = view.getViewData();
    let userInput = false;
    const markInput = (): void => { userInput = true; };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
    for (const event of events) view.containerEl?.addEventListener(event, markInput, { capture: true, passive: true });
    const leafChange = this.app.workspace.on("active-leaf-change", (active) => { if (active !== leaf) userInput = true; });
    const isCurrent = (): boolean => !this.disposed && !userInput && openSeq === this.cardOpenSeq
      && location.isCurrent?.() !== false && view.file?.path === file.path && leaf.view === view
      && this.app.vault.getAbstractFileByPath(file.path) === file
      && this.isCardOpenLeafActive(leaf)
      && view.getViewData() === source;
    try {
      const resolved = await resolveSearchSnippetLocation(source, location.snippet, isCurrent);
      if (!resolved || !isCurrent()) return false;
      if (view.getMode() === "source") {
        view.editor.setSelection(resolved.from, resolved.to);
        view.editor.scrollIntoView(resolved, true);
      } else {
        view.setEphemeralState({ line: resolved.from.line });
      }
      return true;
    } finally {
      for (const event of events) view.containerEl?.removeEventListener(event, markInput, { capture: true });
      this.app.workspace.offref?.(leafChange);
    }
  }

  private scheduleLinkCorrection(
    leaf: WorkspaceLeaf, file: TFile, location: LinkCardLocation | SearchSnippetCardLocation | LinkReferenceCardLocation, openSeq: number,
  ): void {
    let userInput = false;
    const target = leaf.view.containerEl;
    const markInput = (): void => { userInput = true; };
    const inputEvents = ["pointerdown", "keydown", "wheel", "touchstart", "input"] as const;
    for (const event of inputEvents) target?.addEventListener(event, markInput, { capture: true, passive: true });
    const leafChange = this.app.workspace.on("active-leaf-change", (active) => {
      if (active !== leaf) userInput = true;
    });
    const timerWindow = target?.ownerDocument?.defaultView ?? window;
    const timer = timerWindow.setTimeout(() => {
      cleanup();
      if (this.disposed || userInput || openSeq !== this.cardOpenSeq
        || (!("kind" in location) && !this.getSettings().locateLinkCardOnOpen)
        || !this.isCardOpenLeafActive(leaf)) return;
      if ("kind" in location && location.kind === "search-snippet") void this.positionSearchSnippet(leaf, file, location, openSeq);
      else if ("kind" in location && location.kind === "link-reference") this.positionLinkReference(leaf, file, location);
      else this.positionLinkCard(leaf, file, location);
    }, 400);
    const cleanup = (): void => {
      timerWindow.clearTimeout(timer);
      for (const event of inputEvents) target?.removeEventListener(event, markInput, { capture: true });
      this.app.workspace.offref?.(leafChange);
      if (this.cancelLinkCorrection === cleanup) this.cancelLinkCorrection = null;
    };
    this.cancelLinkCorrection = cleanup;
  }

  private async resolveOpenDestinationLeaf(destination?: OpenDestination): Promise<WorkspaceLeaf | null> {
    if (destination === undefined) {
      return this.resolveDefaultCardOpenLeaf();
    }

    if (destination === "current-area") {
      return this.resolveTargetLeaf();
    }

    if (destination === "new-tab") {
      return this.app.workspace.getLeaf(true);
    }

    if (destination === "split-right") {
      const existingTargetLeaf = this.findExistingRootEditorLeaf();
      if (existingTargetLeaf) {
        return this.app.workspace.createLeafBySplit(existingTargetLeaf, "vertical");
      }

      return this.app.workspace.getLeaf(true);
    }

    const result = await this.runtimePlatform.openWindow();
    if (result.outcome === "unavailable") {
      new Notice(this.getUiStrings().app.openInNewWindowDesktopOnly);
      return null;
    }
    return result.value;
  }

  private async resolveDefaultCardOpenLeaf(): Promise<WorkspaceLeaf | null> {
    const defaultCardOpenBehavior = resolveRuntimeOpenBehavior(this.getSettings().defaultCardOpenBehavior, this.runtimePlatform.capabilities);
    if (defaultCardOpenBehavior !== "smart") {
      return this.resolveOpenDestinationLeaf(defaultCardOpenBehavior);
    }

    return this.resolveSmartDefaultCardOpenLeaf();
  }

  private resolveSmartDefaultCardOpenLeaf(): WorkspaceLeaf {
    const currentMainEditorLeaf = this.findCurrentMainEditorLeaf();
    if (!currentMainEditorLeaf) {
      return this.app.workspace.getLeaf(true);
    }

    return this.isLeafPinned(currentMainEditorLeaf)
      ? this.app.workspace.getLeaf(true)
      : currentMainEditorLeaf;
  }

  private findCurrentMainEditorLeaf(): WorkspaceLeaf | null {
    const rootSplit = this.app.workspace.rootSplit;
    const recentRootLeaf = this.app.workspace.getMostRecentLeaf(rootSplit);
    if (recentRootLeaf && this.isFileCapableRootLeaf(recentRootLeaf, rootSplit)) {
      return recentRootLeaf;
    }

    const activeRootMarkdownLeaf = this.findActiveRootMarkdownLeaf();
    if (activeRootMarkdownLeaf) {
      return activeRootMarkdownLeaf;
    }

    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    const rootMarkdownLeaf = existingMarkdown.find((leaf) => leaf.getRoot() === rootSplit);
    return rootMarkdownLeaf ?? null;
  }

  private isFileCapableRootLeaf(leaf: WorkspaceLeaf, rootSplit: unknown): boolean {
    const viewType = leaf.getViewState()?.type;
    return leaf.getRoot() === rootSplit && typeof viewType === "string" && viewType !== "empty";
  }

  private findActiveRootMarkdownLeaf(): WorkspaceLeaf | null {
    const rootSplit = this.app.workspace.rootSplit;
    const activeLeaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
    if (!activeLeaf || activeLeaf.getRoot() !== rootSplit) {
      return null;
    }

    return activeLeaf;
  }

  private isLeafPinned(leaf: WorkspaceLeaf): boolean {
    const pinnedState = (leaf as WorkspaceLeaf & {
      getViewState?: () => { pinned?: boolean };
      pinned?: boolean;
    }).getViewState?.()?.pinned;
    if (typeof pinnedState === "boolean") {
      return pinnedState;
    }

    return (leaf as WorkspaceLeaf & { pinned?: boolean }).pinned === true;
  }

  async selectFolderByPath(path: string, source: FolderSelectionSource): Promise<void> {
    await this.settingsReadyPromise;
    if (this.disposed) return;
    const normalizedPath = normalizeFolderScopePath(path);
    const folder = normalizedPath === ""
      ? this.app.vault.getRoot()
      : this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(folder instanceof TFolder)) {
      return;
    }
    await this.selectFolder(folder, source);
  }


  private async selectFolder(
    folder: TFolder,
    source: FolderSelectionSource,
  ): Promise<void> {
    const request = this.createSelectionRequest(createFolderScope(folder.path, this.getSettings().includeSubfolders), source);
    const primaryView = await this.activateView();
    if (!primaryView || this.disposed) return;
    if (request.requestId !== this.latestHandledRequestId) {
      return;
    }
    await this.dispatchSelectionRequest(request);
  }

  getSettings(): PluginSettings {
    return this.settingsStore.getFlat();
  }

  getUiLanguage(): UiLanguage {
    return this.uiLanguage;
  }

  getUiStrings(): UiStrings {
    return getUiStrings(this.uiLanguage);
  }

  getSearchService(): SearchService | null {
    return this.searchCoordinator.getService();
  }

  getSearchSnapshot(): SearchServiceSnapshot | null {
    return this.searchCoordinator.getSnapshot();
  }

  getSearchIndexObservabilitySnapshot(): SearchIndexObservabilitySnapshot | null {
    return this.searchCoordinator.getObservabilitySnapshot();
  }

  subscribeSearchSnapshots(listener: SearchSnapshotListener): () => void {
    return this.searchCoordinator.subscribe(listener);
  }

  subscribeVaultEvents(listener: VaultEventListener): () => void {
    return this.vaultEventBus.subscribe(listener);
  }

  subscribeMetadataEvents(listener: MetadataEventListener): () => void {
    return this.metadataEventBus.subscribe(listener);
  }

  flushSettings(): Promise<void> {
    return this.settingsStore.flushPendingWrites();
  }

  async saveSettings(patch: PartialPluginSettings): Promise<void> {
    if (!hasPatchValues(patch)) {
      return;
    }
    if (this.settingsStore.getCompatibility() === "unsupported-schema") {
      this.showUnsupportedSchemaNotice();
    }
    const previous = this.getSettings();
    const write = this.settingsStore.updateFlat(patch);

    // Render synchronous memory now; the returned promise still waits for persistence.
    const next = this.getSettings();
    this.withFolderViews((view) => {
      const intent = resolveSettingsUpdateIntent(previous, next, view.getCardScope());
      if (intent !== null) {
        this.runDetached(view.applyUpdateIntent(intent, "settings-change"), "Settings view update failed.");
      }
    });

    await write;
  }

  private resolveTargetLeaf(): WorkspaceLeaf {
    const existingTargetLeaf = this.findExistingRootEditorLeaf();
    if (existingTargetLeaf) {
      return existingTargetLeaf;
    }

    return this.app.workspace.getLeaf(true);
  }

  private findExistingRootEditorLeaf(): WorkspaceLeaf | null {
    const rootSplit = this.app.workspace.rootSplit;
    const activeRootMarkdownLeaf = this.findActiveRootMarkdownLeaf();
    if (activeRootMarkdownLeaf) {
      return activeRootMarkdownLeaf;
    }

    const recentRootLeaf = this.app.workspace.getMostRecentLeaf(rootSplit);
    if (recentRootLeaf) {
      return recentRootLeaf;
    }

    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    const rootMarkdownLeaf = existingMarkdown.find((leaf) => leaf.getRoot() === rootSplit);
    return rootMarkdownLeaf ?? null;
  }

  private async activateView(allowCreate = true): Promise<FolderCardView | null> {
    try {
      if (this.disposed) return null;
      if (this.runtimePlatform.device !== "desktop") this.editorDropController.captureMenuTargetBeforeActivation();
      return await activateDeferredView(this.app.workspace, FOLDER_CARD_VIEW,
        (value): value is FolderCardView => value instanceof FolderCardView, () => !this.disposed, allowCreate, this.runtimePlatform.device !== "desktop");
    } catch (error) {
      if (!this.disposed) console.warn("[Card Workspace] View activation failed.", error);
      return null;
    }
  }

  /**
   * Opening the view and loading its scope are one operation: a view that has
   * never loaded a scope would otherwise render empty on the ribbon and command
   * paths, which no longer piggyback on a startup restore.
   */
  private async activateAndEnsureScope(allowCreate: boolean): Promise<FolderCardView | null> {
    await this.settingsReadyPromise;
    if (this.disposed) return null;
    const handledBeforeActivation = this.latestHandledRequestId;
    const view = await this.activateView(allowCreate);
    if (!view || this.disposed) return null;
    // A selection created while we were activating is newer, so it owns the scope.
    if (view.hasLoadedScope() || this.latestHandledRequestId !== handledBeforeActivation) return view;
    const settings = this.getSettings();
    const lastPath = normalizeFolderScopePath(settings.lastFolderPath);
    const folder = lastPath === "" ? this.app.vault.getRoot() : this.app.vault.getAbstractFileByPath(lastPath);
    if (!(folder instanceof TFolder)) return view;
    await this.dispatchSelectionRequest(this.createSelectionRequest(
      createFolderScope(folder.path, settings.includeSubfolders), "restore"));
    return view;
  }

  private withFolderViews(callback: (view: FolderCardView) => void): void {
    this.app.workspace.getLeavesOfType(FOLDER_CARD_VIEW).forEach((leaf) => {
      if (leaf.view instanceof FolderCardView) {
        callback(leaf.view);
      }
    });
  }

  private syncSelection(path: string | null): void {
    this.withFolderViews((view) => {
      if (this.templateOpenDepth > 0) view.setSelectedFile(path, true);
      else view.setSelectedFile(path);
    });
  }

  private registerSearchCommands(): void {
    const strings = this.getUiStrings().app;
    this.addCommand({
      id: "show-folder-card-search-index-status",
      name: strings.showSearchStatusCommand,
      callback: () => {
        this.searchCoordinator.showStatus();
      },
    });

    this.addCommand({
      id: "recover-folder-card-search-index",
      name: strings.recoverSearchIndexCommand,
      callback: () => {
        this.runDetached(this.searchCoordinator.recover("Manual recover command requested full local search index rebuild."), "Search recovery failed.");
      },
    });

    this.addCommand({
      id: "rebuild-folder-card-search-index",
      name: strings.rebuildSearchIndexCommand,
      callback: () => {
        this.runDetached(this.searchCoordinator.rebuildManually("Manual rebuild command requested local search index rebuild."), "Search rebuild failed.");
      },
    });

    this.addCommand({
      id: "clear-reset-folder-card-search-index",
      name: strings.clearResetSearchIndexCommand,
      callback: () => {
        this.runDetached(this.searchCoordinator.clearAndReset(), "Search reset failed.");
      },
    });
  }

  private registerMetadataObservers(): void {
    if (this.metadataObserversRegistered) {
      return;
    }

    this.metadataObserversRegistered = true;
    const publish = (kind: "changed" | "resolved", path: string) => {
      if (this.disposed) return;
      this.runDetached(this.metadataEventBus.publish({ kind, path }), "Metadata event publication failed.");
    };
    this.registerEvent(this.app.metadataCache.on("changed", (file) => publish("changed", file.path)));
    this.registerEvent(this.app.metadataCache.on("resolved", (file?: TFile) => publish("resolved", file?.path ?? "")));
  }

  private registerVaultObservers(): void {
    if (this.vaultObserversRegistered) {
      return;
    }

    this.vaultObserversRegistered = true;
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("create", file, null));
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("modify", file, null));
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("delete", file, null));
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.dispatchVaultMutation(this.buildVaultMutationEvent("rename", file, oldPath));
      }),
    );
  }

  private async loadSettings(): Promise<void> {
    const status = await this.settingsStore.init();
    if (!this.vaultCacheIdentity.persistent) new Notice(this.getUiStrings().mobile.cacheUnavailable);
    if (status === "unsupported-schema") {
      this.showUnsupportedSchemaNotice();
    }
    // Card boxes always start collapsed to browse mode on launch.
    this.settingsStore.applyLaunchOverride();
  }

  /** Degrade to defaults read-only mode without aborting plugin startup. */
  private showUnsupportedSchemaNotice(): void {
    try {
      new Notice(this.getUiStrings().app.settingsSchemaUnsupportedNotice);
    } catch (error) {
      console.warn("[Card Workspace] Failed to show the unsupported settings schema notice.", error);
    }
  }

  private createSelectionRequest(scope: CardScope, source: FolderSelectionSource, forceRefresh = false): FolderSelectionRequest {
    this.selectionRequestSeq += 1;
    const request: FolderSelectionRequest = {
      requestId: this.selectionRequestSeq,
      scope,
      source,
      requestedAtMs: Date.now(),
      forceRefresh,
    };

    this.latestHandledRequestId = request.requestId;
    return request;
  }

  /** Returns the first accepted result, the final rejection, or null when no views exist. */
  private async dispatchSelectionRequest(request: FolderSelectionRequest): Promise<SelectionResult | null> {
    const views: FolderCardView[] = [];
    this.withFolderViews((view) => {
      views.push(view);
    });

    let fallback: SelectionResult | null = null;
    let accepted: SelectionResult | null = null;
    for (const view of views) {
      const result = await this.handleSelectionResult(view, request);
      fallback = result;
      if (accepted === null && result.action !== "rejected_invalid") {
        accepted = result;
      }
    }
    return accepted ?? fallback;
  }

  private async handleSelectionResult(
    view: FolderCardView,
    request: FolderSelectionRequest,
  ): Promise<SelectionResult> {
    return view.handleScopeSelection(request);
  }

  private buildVaultMutationEvent(
    eventType: VaultMutationEventType,
    file: TAbstractFile,
    oldPath: string | null,
  ): VaultMutationEvent {
    return {
      eventType,
      path: file.path,
      oldPath,
      isFolder: file instanceof TFolder,
      fileKind: file instanceof TFile ? resolveCardFileKind(file) : null,
    };
  }

  private registerVaultEventListeners(): void {
    if (this.vaultEventListenersRegistered) {
      return;
    }

    this.vaultEventListenersRegistered = true;
    // Plugin order: navigation workspace → global pins → templates → boxes → favorites/tag prune → search. Views subscribe later.
    this.vaultEventUnsubscribers = [
      this.subscribeVaultEvents((event) => this.reconcileLastFolderPath(event)),
      this.subscribeVaultEvents((event) => this.pinnedPathReconciler.handleVaultMutation(event)),
      this.subscribeVaultEvents((event) => this.templateReferenceReconciler.handleVaultMutation(event)),
      this.subscribeVaultEvents((event) => this.boxReconciler.handleVaultMutation(event)),
      this.subscribeVaultEvents((event) => this.favoriteReconciler.handleVaultMutation(event)),
      this.subscribeVaultEvents((event) => this.editorDropController.handleVaultMutation(event)),
    ];
    this.searchCoordinator.subscribeTo(this.vaultEventBus);
  }

  private dispatchVaultMutation(event: VaultMutationEvent): void {
    if (this.disposed) return;
    if (event.isFolder || isSupportedImagePath(event.path) || (event.oldPath !== null && isSupportedImagePath(event.oldPath))) {
      this.thumbnails?.service.invalidate([event.path, ...(event.oldPath === null ? [] : [event.oldPath])], event.isFolder);
    }
    this.runDetached(this.vaultEventBus.publish(event), "Vault event publication failed.");
  }

  private reconcileLastFolderPath(event: VaultMutationEvent): Promise<void> {
    return this.navigationWorkspaceReconciler.handleVaultMutation(event);
  }
}
