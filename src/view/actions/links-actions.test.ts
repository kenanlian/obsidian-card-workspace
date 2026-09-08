import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {
    path = "";
  },
  TFolder: class TFolder {},
}));

import { TFile } from "obsidian";
import { getUiStrings } from "../../i18n";
import { createFolderScope, createLinksScope, serializeScopeKey } from "../scope";
import type { NoteCardRecord } from "../types";
import { createViewStateStore } from "../view-state-store";
import { LinksActions } from "./links-actions";

const SORT = { field: "mtime" as const, direction: "desc" as const };
const NOTE_A = "notes/A.md";
const NOTE_B = "notes/B.md";
const NOTE_C = "notes/C.md";

function createFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  return file;
}

function createCard(path: string): NoteCardRecord {
  return {
    file: {} as never,
    fileKind: "markdown",
    path,
    title: path,
    ctime: 1,
    mtime: 1,
    excerpt: "",
    previewHtml: "",
    previewMode: "text",
    hydrated: false,
    taskSummary: null,
  };
}

function createActions(options: {
  scope?: ReturnType<typeof createFolderScope> | ReturnType<typeof createLinksScope>;
  activeFile?: TFile | null;
  files?: Record<string, TFile>;
  visiblePaths?: string[];
  linksPinned?: boolean;
  locale?: "en" | "zh";
} = {}) {
  const store = createViewStateStore(options.scope ?? createFolderScope("notes", true));
  if (options.linksPinned) {
    store.setLinksPinned(true);
  }
  if (options.visiblePaths) {
    store.replaceVisibleCards(options.visiblePaths.map(createCard));
  }
  const notify = vi.fn();
  const createProgrammaticSelectionRequest = vi.fn((scope, forceRefresh) => ({
    requestId: 1,
    scope,
    source: "programmatic" as const,
    requestedAtMs: 0,
    forceRefresh,
  }));
  const handleScopeSelection = vi.fn(async () => ({
    action: "started" as const,
    scope: store.getScope(),
    generationChanged: true,
    preserveUiState: false,
  }));
  const openCreateBoxModalWithPaths = vi.fn();
  const publishGroups = vi.fn();
  const files = options.files ?? {};
  const actions = new LinksActions({
    context: {
      getApp: () => ({
        workspace: { getActiveFile: () => options.activeFile ?? null },
        vault: { getAbstractFileByPath: (path: string) => files[path] ?? null },
      }),
      store,
      getUiStrings: () => getUiStrings(options.locale ?? "en"),
      notify,
      publishGroups,
    } as never,
    createProgrammaticSelectionRequest,
    handleScopeSelection,
    openCreateBoxModalWithPaths,
  });
  return {
    actions,
    store,
    notify,
    createProgrammaticSelectionRequest,
    handleScopeSelection,
    openCreateBoxModalWithPaths,
    publishGroups,
  };
}

describe("LinksActions", () => {
  it("recognizes the four toolbar command ids and ignores others", () => {
    const { actions, handleScopeSelection, notify } = createActions({ activeFile: createFile(NOTE_A) });

    expect(actions.handleToolbarCommand("links-backlinks")).toBe(true);
    expect(actions.handleToolbarCommand("links-outgoing")).toBe(true);
    expect(actions.handleToolbarCommand("links-pin-toggle")).toBe(true);
    expect(actions.handleToolbarCommand("links-save-snapshot")).toBe(true);
    expect(actions.handleToolbarCommand("bulk")).toBe(false);
    expect(actions.handleToolbarCommand("new-note")).toBe(false);

    expect(handleScopeSelection).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
  });

  it("enters links from the active file and notifies when none is open", () => {
    const missing = createActions();
    expect(missing.actions.handleToolbarCommand("links-backlinks")).toBe(true);
    expect(missing.notify).toHaveBeenCalledWith(getUiStrings("en").links.noActiveFileNotice);
    expect(missing.handleScopeSelection).not.toHaveBeenCalled();
    expect(missing.store.getLinksPinned()).toBe(false);

    const zh = createActions({ locale: "zh" });
    zh.actions.enterOrSwitchLinks("outgoing");
    expect(zh.notify).toHaveBeenCalledWith(getUiStrings("zh").links.noActiveFileNotice);

    const file = createFile(NOTE_A);
    const entered = createActions({ activeFile: file, linksPinned: true });
    entered.actions.handleToolbarCommand("links-outgoing");
    expect(entered.store.getLinksPinned()).toBe(false);
    expect(entered.createProgrammaticSelectionRequest).toHaveBeenCalledWith(
      createLinksScope(NOTE_A, "outgoing"),
      false,
    );
    expect(entered.handleScopeSelection).toHaveBeenCalledTimes(1);
  });

  it("switches direction using the current links notePath and changes the load key", () => {
    const source = createFile(NOTE_A);
    const active = createFile(NOTE_B);
    const { actions, createProgrammaticSelectionRequest, store } = createActions({
      scope: createLinksScope(NOTE_A, "backlinks"),
      activeFile: active,
      files: { [NOTE_A]: source },
      linksPinned: true,
    });

    const previousKey = serializeScopeKey(store.getScope(), SORT);
    actions.handleToolbarCommand("links-outgoing");

    const nextScope = createProgrammaticSelectionRequest.mock.calls[0]?.[0];
    expect(nextScope).toEqual(createLinksScope(NOTE_A, "outgoing"));
    expect(serializeScopeKey(nextScope, SORT)).not.toBe(previousKey);
    expect(serializeScopeKey(nextScope, SORT)).toBe(
      serializeScopeKey(createLinksScope(NOTE_A, "outgoing"), SORT),
    );
    expect(store.getLinksPinned()).toBe(true);
  });

  it("resets the pin flag on fresh entry and preserves it across a direction switch", () => {
    const file = createFile(NOTE_A);
    const fresh = createActions({ activeFile: file, linksPinned: true });
    expect(fresh.store.getLinksPinned()).toBe(true);
    fresh.actions.enterOrSwitchLinks("backlinks");
    expect(fresh.store.getLinksPinned()).toBe(false);

    const switcher = createActions({
      scope: createLinksScope(NOTE_A, "backlinks"),
      files: { [NOTE_A]: file },
      linksPinned: true,
    });
    switcher.actions.enterOrSwitchLinks("outgoing");
    expect(switcher.store.getLinksPinned()).toBe(true);
  });

  it("pins without re-pointing and unpins by following the active file when it differs", () => {
    const source = createFile(NOTE_A);
    const active = createFile(NOTE_B);
    const { actions, store, createProgrammaticSelectionRequest, handleScopeSelection } = createActions({
      scope: createLinksScope(NOTE_A, "backlinks"),
      activeFile: active,
      files: { [NOTE_A]: source },
    });

    expect(store.getLinksPinned()).toBe(false);
    actions.togglePinned();
    expect(store.getLinksPinned()).toBe(true);
    expect(handleScopeSelection).not.toHaveBeenCalled();

    actions.togglePinned();
    expect(store.getLinksPinned()).toBe(false);
    expect(createProgrammaticSelectionRequest).toHaveBeenCalledWith(
      createLinksScope(NOTE_B, "backlinks"),
      false,
    );

    const sameNote = createActions({
      scope: createLinksScope(NOTE_A, "outgoing"),
      activeFile: source,
      files: { [NOTE_A]: source },
      linksPinned: true,
    });
    sameNote.actions.togglePinned();
    expect(sameNote.store.getLinksPinned()).toBe(false);
    expect(sameNote.handleScopeSelection).not.toHaveBeenCalled();
  });

  it("publishes the scope group on pin and unpin-same-note, but not on the re-point path", () => {
    const source = createFile(NOTE_A);
    const pinned = createActions({
      scope: createLinksScope(NOTE_A, "outgoing"),
      activeFile: source,
      files: { [NOTE_A]: source },
    });
    pinned.actions.togglePinned();
    expect(pinned.store.getLinksPinned()).toBe(true);
    expect(pinned.publishGroups).toHaveBeenCalledWith("scope");

    const sameNoteUnpin = createActions({
      scope: createLinksScope(NOTE_A, "outgoing"),
      activeFile: source,
      files: { [NOTE_A]: source },
      linksPinned: true,
    });
    sameNoteUnpin.actions.togglePinned();
    expect(sameNoteUnpin.store.getLinksPinned()).toBe(false);
    expect(sameNoteUnpin.handleScopeSelection).not.toHaveBeenCalled();
    expect(sameNoteUnpin.publishGroups).toHaveBeenCalledWith("scope");

    // The re-point path publishes the scope group through scope selection.
    const follow = createActions({
      scope: createLinksScope(NOTE_A, "backlinks"),
      activeFile: createFile(NOTE_B),
      files: { [NOTE_A]: source },
      linksPinned: true,
    });
    follow.actions.togglePinned();
    expect(follow.store.getLinksPinned()).toBe(false);
    expect(follow.handleScopeSelection).toHaveBeenCalledTimes(1);
    expect(follow.publishGroups).not.toHaveBeenCalled();
  });

  it("snapshots visible card paths and no-ops with a notice when the set is empty", () => {
    const source = createFile(NOTE_A);
    const empty = createActions({
      scope: createLinksScope(NOTE_A, "backlinks"),
      files: { [NOTE_A]: source },
    });
    empty.actions.handleToolbarCommand("links-save-snapshot");
    expect(empty.notify).toHaveBeenCalledWith(getUiStrings("en").links.emptySnapshotNotice);
    expect(empty.openCreateBoxModalWithPaths).not.toHaveBeenCalled();

    const zhEmpty = createActions({
      scope: createLinksScope(NOTE_A, "outgoing"),
      files: { [NOTE_A]: source },
      locale: "zh",
    });
    zhEmpty.actions.saveSnapshot();
    expect(zhEmpty.notify).toHaveBeenCalledWith(getUiStrings("zh").links.emptySnapshotNotice);

    const filled = createActions({
      scope: createLinksScope(NOTE_A, "outgoing"),
      files: { [NOTE_A]: source },
      visiblePaths: [NOTE_B, NOTE_C],
    });
    filled.actions.saveSnapshot();
    expect(filled.openCreateBoxModalWithPaths).toHaveBeenCalledWith([NOTE_B, NOTE_C]);
    expect(filled.notify).not.toHaveBeenCalled();
  });

  it("no-ops pin and snapshot commands when the live scope is not links", () => {
    const { actions, store, handleScopeSelection, openCreateBoxModalWithPaths, notify } = createActions({
      visiblePaths: [NOTE_B],
    });

    actions.togglePinned();
    actions.saveSnapshot();

    expect(store.getLinksPinned()).toBe(false);
    expect(handleScopeSelection).not.toHaveBeenCalled();
    expect(openCreateBoxModalWithPaths).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
