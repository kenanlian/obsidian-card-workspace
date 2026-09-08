import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { TFile } from "obsidian";
import { createBoxScope, createFolderScope, createLinksScope, isBoxScope, isLinksScope } from "../scope";
import type { NoteCardRecord } from "../types";
import {
  reconcileBoxMembershipForPath,
  reconcileLinksMembershipForPath,
  reconcileLinksScopeForVaultEvent,
  reconcileSymmetricPathMembership,
  shouldDeferLinksIncrementalMutation,
  type PathMembershipReconcileDeps,
} from "./scope-membership";

function liveFile(path: string, extras: { ctime?: number; mtime?: number } = {}): TFile {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return Object.assign(new TFile(), {
    path,
    name,
    basename: dot === -1 ? name : name.slice(0, dot),
    extension: dot === -1 ? "" : name.slice(dot + 1),
    stat: { ctime: extras.ctime ?? 1, mtime: extras.mtime ?? 1 },
  });
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

function createDeps(options: {
  cards?: NoteCardRecord[];
  files?: Record<string, TFile | null>;
  resolvedLinks?: Record<string, Record<string, number>>;
} = {}) {
  let cards = options.cards ?? [];
  const prepareRecordsFromCache = vi.fn();
  const deletePendingHydration = vi.fn(() => true);
  const files = options.files ?? {};
  const app = {
    vault: { getAbstractFileByPath: vi.fn((path: string) => files[path] ?? null) },
    metadataCache: {
      getFileCache: vi.fn(() => null),
      resolvedLinks: options.resolvedLinks ?? {},
    },
  };
  const deps: PathMembershipReconcileDeps = {
    getBaseCards: () => cards,
    replaceBaseCards: (next) => { cards = next; },
    prepareRecordsFromCache,
    deletePendingHydration,
    getApp: () => app as never,
    resolveSort: () => ({ field: "mtime", direction: "desc" }),
  };
  return { deps, getCards: () => cards, prepareRecordsFromCache, deletePendingHydration, app };
}

describe("reconcileSymmetricPathMembership", () => {
  it("leaves a loaded non-member and reports unchanged on the repeat", () => {
    const path = "notes/leaving.md";
    const { deps, getCards, deletePendingHydration } = createDeps({
      cards: [membershipRecord(path), membershipRecord("notes/keep.md")],
    });

    expect(reconcileSymmetricPathMembership(path, false, deps)).toBe("left");
    expect(getCards().map((card) => card.path)).toEqual(["notes/keep.md"]);
    expect(deletePendingHydration).toHaveBeenCalledWith(path);
    expect(reconcileSymmetricPathMembership(path, false, deps)).toBe("unchanged");
  });

  it("enters an absent matching file under the active sort", () => {
    const entering = liveFile("notes/entering.md", { mtime: 50 });
    const { deps, getCards, prepareRecordsFromCache } = createDeps({
      cards: [membershipRecord("notes/existing.md")],
      files: { [entering.path]: entering },
    });

    expect(reconcileSymmetricPathMembership(entering.path, true, deps)).toBe("entered");
    expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
    expect(getCards().map((card) => card.path)).toEqual([entering.path, "notes/existing.md"]);
    expect(reconcileSymmetricPathMembership(entering.path, true, deps)).toBe("unchanged");
  });

  it("no-ops when the live file is missing or unsupported", () => {
    const unsupported = liveFile("notes/board.sketch");
    const { deps, getCards } = createDeps({
      files: { [unsupported.path]: unsupported },
    });

    expect(reconcileSymmetricPathMembership("notes/missing.md", true, deps)).toBe("unchanged");
    expect(reconcileSymmetricPathMembership(unsupported.path, true, deps)).toBe("unchanged");
    expect(getCards()).toEqual([]);
  });
});

describe("reconcileBoxMembershipForPath", () => {
  it("delegates membership to isPathInBox", () => {
    const path = "notes/member.md";
    const { deps, getCards } = createDeps({ cards: [membershipRecord(path)] });
    const isPathInBox = vi.fn((candidate: string) => candidate !== path);
    const scope = createBoxScope("box-1");
    if (!isBoxScope(scope)) {
      throw new Error("expected box scope");
    }

    expect(reconcileBoxMembershipForPath(scope, path, { ...deps, isPathInBox }))
      .toBe("left");
    expect(isPathInBox).toHaveBeenCalledWith(path, "box-1");
    expect(getCards()).toEqual([]);
  });
});

describe("reconcileLinksMembershipForPath", () => {
  const NOTE_A = "notes/A.md";
  const NOTE_C = "notes/C.md";

  it("enters and leaves a backlink using the extracted machinery", () => {
    const entering = liveFile(NOTE_C, { mtime: 40 });
    const { deps, getCards, deletePendingHydration } = createDeps({
      cards: [membershipRecord("notes/B.md")],
      files: { [NOTE_A]: liveFile(NOTE_A), [NOTE_C]: entering, "notes/B.md": liveFile("notes/B.md") },
      resolvedLinks: { [NOTE_C]: { [NOTE_A]: 1 }, "notes/B.md": { [NOTE_A]: 1 } },
    });
    const scope = createLinksScope(NOTE_A, "backlinks");
    if (!isLinksScope(scope)) {
      throw new Error("expected links scope");
    }

    expect(reconcileLinksMembershipForPath(scope, NOTE_C, deps, vi.fn())).toBe("entered");
    expect(getCards().map((card) => card.path)).toEqual([NOTE_C, "notes/B.md"]);

    deps.getApp().metadataCache.resolvedLinks = { "notes/B.md": { [NOTE_A]: 1 } };
    expect(reconcileLinksMembershipForPath(scope, NOTE_C, deps, vi.fn())).toBe("left");
    expect(deletePendingHydration).toHaveBeenCalledWith(NOTE_C);
    expect(getCards().map((card) => card.path)).toEqual(["notes/B.md"]);
  });

  it("reloads the scope when the outgoing source note changes and no-ops otherwise", () => {
    const { deps } = createDeps();
    const scope = createLinksScope(NOTE_A, "outgoing");
    if (!isLinksScope(scope)) {
      throw new Error("expected links scope");
    }
    const requestScopeReload = vi.fn();

    expect(reconcileLinksMembershipForPath(scope, NOTE_A, deps, requestScopeReload)).toBe("unchanged");
    expect(requestScopeReload).toHaveBeenCalledTimes(1);
    expect(reconcileLinksMembershipForPath(scope, NOTE_C, deps, requestScopeReload)).toBe("unchanged");
    expect(requestScopeReload).toHaveBeenCalledTimes(1);
  });
});

describe("reconcileLinksScopeForVaultEvent", () => {
  const NOTE_A = "notes/A.md";

  it("rewrites notePath, refreshes the load key, and schedules a reload on source rename", () => {
    const setScope = vi.fn();
    const refreshLoadKey = vi.fn();
    const requestScopeReload = vi.fn();
    const fallbackToFolder = vi.fn();
    const handled = reconcileLinksScopeForVaultEvent(
      createLinksScope(NOTE_A, "backlinks"),
      { eventType: "rename", path: "notes/A2.md", oldPath: NOTE_A, isFolder: false, fileKind: "markdown" },
      { setScope, refreshLoadKey, requestScopeReload, fallbackToFolder, lastFolderPath: "notes" },
    );

    expect(handled).toBe(true);
    expect(setScope).toHaveBeenCalledWith(createLinksScope("notes/A2.md", "backlinks"));
    expect(refreshLoadKey).toHaveBeenCalledTimes(1);
    expect(requestScopeReload).toHaveBeenCalledTimes(1);
    expect(fallbackToFolder).not.toHaveBeenCalled();
  });

  it("falls back to the last folder on source delete and marks the event handled", () => {
    const setScope = vi.fn();
    const refreshLoadKey = vi.fn();
    const fallbackToFolder = vi.fn();
    const handled = reconcileLinksScopeForVaultEvent(
      createLinksScope(NOTE_A, "outgoing"),
      { eventType: "delete", path: NOTE_A, oldPath: null, isFolder: false, fileKind: "markdown" },
      { setScope, refreshLoadKey, requestScopeReload: vi.fn(), fallbackToFolder, lastFolderPath: "inbox" },
    );

    expect(handled).toBe(true);
    expect(fallbackToFolder).toHaveBeenCalledWith("inbox");
    expect(setScope).not.toHaveBeenCalled();
    expect(refreshLoadKey).not.toHaveBeenCalled();
  });

  it("ignores folder events, other files, and non-links scopes", () => {
    const hooks = {
      setScope: vi.fn(),
      refreshLoadKey: vi.fn(),
      requestScopeReload: vi.fn(),
      fallbackToFolder: vi.fn(),
      lastFolderPath: "notes",
    };

    expect(reconcileLinksScopeForVaultEvent(
      createFolderScope("notes", true),
      { eventType: "delete", path: NOTE_A, oldPath: null, isFolder: false, fileKind: "markdown" },
      hooks,
    )).toBe(false);
    expect(reconcileLinksScopeForVaultEvent(
      createLinksScope(NOTE_A, "backlinks"),
      { eventType: "rename", path: "other", oldPath: "notes", isFolder: true, fileKind: null },
      hooks,
    )).toBe(false);
    expect(reconcileLinksScopeForVaultEvent(
      createLinksScope(NOTE_A, "backlinks"),
      { eventType: "delete", path: "notes/B.md", oldPath: null, isFolder: false, fileKind: "markdown" },
      hooks,
    )).toBe(false);
    expect(hooks.setScope).not.toHaveBeenCalled();
    expect(hooks.requestScopeReload).not.toHaveBeenCalled();
    expect(hooks.fallbackToFolder).not.toHaveBeenCalled();
  });
});

describe("shouldDeferLinksIncrementalMutation", () => {
  const createEvent = {
    eventType: "create", path: "notes/B.md", oldPath: null, isFolder: false, fileKind: "markdown",
  } as const;
  const renameEvent = {
    eventType: "rename", path: "notes/B2.md", oldPath: "notes/B.md", isFolder: false, fileKind: "markdown",
  } as const;

  it("defers create and rename-into under a links scope (C11 relevance is not membership)", () => {
    const scope = createLinksScope("notes/A.md", "outgoing");

    expect(shouldDeferLinksIncrementalMutation(scope, createEvent, false)).toBe(true);
    expect(shouldDeferLinksIncrementalMutation(scope, renameEvent, false)).toBe(true);
  });

  it("keeps member renames, deletes, and modifies incremental under a links scope", () => {
    const scope = createLinksScope("notes/A.md", "backlinks");

    expect(shouldDeferLinksIncrementalMutation(scope, renameEvent, true)).toBe(false);
    expect(shouldDeferLinksIncrementalMutation(scope, {
      eventType: "delete", path: "notes/B.md", oldPath: null, isFolder: false, fileKind: "markdown",
    }, true)).toBe(false);
    expect(shouldDeferLinksIncrementalMutation(scope, {
      eventType: "modify", path: "notes/B.md", oldPath: null, isFolder: false, fileKind: "markdown",
    }, true)).toBe(false);
  });

  it("never defers folder or box scopes", () => {
    expect(shouldDeferLinksIncrementalMutation(createFolderScope("notes", true), createEvent, false)).toBe(false);
    expect(shouldDeferLinksIncrementalMutation(createBoxScope("box-1"), renameEvent, false)).toBe(false);
  });
});
