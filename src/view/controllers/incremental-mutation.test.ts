import { TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";

const obsidianTypes = vi.hoisted(() => {
  class MockTFile {
    path = "";
    name = "";
    basename = "";
    extension = "md";
    stat = { ctime: 1, mtime: 2 };
  }
  return { MockTFile };
});

vi.mock("obsidian", () => ({ TFile: obsidianTypes.MockTFile }));

import type { CardFileKind } from "../file-kind";
import type {
  IncrementalMutationDeps,
  IncrementalMutationOutcome,
} from "./incremental-mutation";
import type { NoteCardRecord, VaultMutationEvent } from "../types";
import { applyIncrementalMutation } from "./incremental-mutation";

function file(path: string, stat = { ctime: 1, mtime: 2 }): TFile {
  const value = new TFile() as any;
  value.path = path;
  value.name = path.slice(path.lastIndexOf("/") + 1);
  value.basename = value.name.replace(/\.md$/, "");
  value.stat = stat;
  return value as TFile;
}

function record(
  path: string,
  fileKind: CardFileKind = "markdown",
  overrides: Partial<NoteCardRecord> = {},
): NoteCardRecord {
  const value = file(path);
  return {
    file: value,
    fileKind,
    path,
    title: value.basename,
    ctime: value.stat.ctime,
    mtime: value.stat.mtime,
    excerpt: "",
    previewHtml: "",
    previewMode: "empty",
    hydrated: false,
    taskSummary: null,
    ...overrides,
  };
}

/** Mirrors HydrationController's non-Markdown placeholder preparation. */
function placeholderPreparation(records: NoteCardRecord[]): void {
  for (const item of records) {
    if (item.fileKind === "markdown") continue;
    item.excerpt = "";
    item.previewHtml = `<p class="fce-preview-placeholder">${item.fileKind}</p>`;
    item.previewMode = "placeholder";
    item.hydrated = true;
  }
}

function createDeps(options: {
  live?: Array<[string, TFile]>;
  pending?: string[];
  sort?: { field: "name" | "ctime" | "mtime"; direction: "asc" | "desc" };
  getFileCache?: () => unknown;
  getBulkSelection?: () => { selectedPaths: Set<string>; anchorPath: string | null };
  isPathInActiveScope?: (path: string) => boolean;
} = {}) {
  const liveFiles = new Map<string, TFile>(options.live ?? []);
  const setBulkSelection = vi.fn();
  const prepareRecordsFromCache = vi.fn(placeholderPreparation);
  const getFileCache = vi.fn(options.getFileCache ?? (() => null));
  const deps: IncrementalMutationDeps = {
    app: {
      vault: { getAbstractFileByPath: (path: string) => liveFiles.get(path) ?? null },
      metadataCache: { getFileCache },
    } as any,
    sort: options.sort ?? { field: "name", direction: "asc" },
    pendingHydration: new Set<string>(options.pending ?? []),
    prepareRecordsFromCache,
    getBulkSelection: options.getBulkSelection
      ?? (() => ({ selectedPaths: new Set<string>(), anchorPath: null })),
    setBulkSelection,
    isPathInActiveScope: options.isPathInActiveScope ?? (() => true),
  };
  return { deps, liveFiles, setBulkSelection, prepareRecordsFromCache, getFileCache };
}

function mutate(
  event: VaultMutationEvent,
  baseCards: NoteCardRecord[],
  deps: IncrementalMutationDeps,
): IncrementalMutationOutcome {
  return applyIncrementalMutation(event, baseCards, deps);
}

describe("applyIncrementalMutation", () => {
  const cases: Array<{
    eventType: VaultMutationEvent["eventType"];
    event: VaultMutationEvent;
    cardPaths: string[];
    action: string;
  }> = [
    { eventType: "create", event: { eventType: "create", path: "scope/new.md", oldPath: null, isFolder: false, fileKind: "markdown" }, cardPaths: [], action: "inserted" },
    { eventType: "modify", event: { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" }, cardPaths: ["scope/old.md"], action: "hydration_reset" },
    { eventType: "delete", event: { eventType: "delete", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" }, cardPaths: ["scope/old.md"], action: "removed" },
    { eventType: "rename", event: { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" }, cardPaths: ["scope/old.md"], action: "updated" },
  ];

  for (const scopeKind of ["folder", "box"] as const) {
    for (const testCase of cases) {
      it(`${testCase.eventType} reports ${testCase.action} in ${scopeKind} scope`, () => {
        const { deps } = createDeps({ live: [[testCase.event.path, file(testCase.event.path)]] });
        const outcome = mutate(
          testCase.event,
          testCase.cardPaths.map((path) => record(path)),
          deps,
        );
        expect(outcome.result.action).toBe(testCase.action);
      });
    }
  }

  it("distinguishes an unchanged collection from a collection emptied by delete", () => {
    const { deps } = createDeps();
    const event: VaultMutationEvent = { eventType: "delete", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" };
    expect(mutate(event, [], deps).nextCards).toBeNull();
    expect(mutate(event, [record(event.path)], deps).nextCards).toEqual([]);
  });

  it("returns create and modify hydration paths while clearing a modified pending path", () => {
    const { deps } = createDeps({
      live: [["scope/new.md", file("scope/new.md")], ["scope/old.md", file("scope/old.md")]],
      pending: ["scope/old.md"],
    });

    const created = mutate(
      { eventType: "create", path: "scope/new.md", oldPath: null, isFolder: false, fileKind: "markdown" },
      [record("scope/old.md")],
      deps,
    );
    expect(created.hydrationPaths).toEqual(["scope/new.md"]);

    const modified = mutate(
      { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" },
      [record("scope/old.md")],
      deps,
    );
    expect(modified.hydrationPaths).toEqual(["scope/old.md"]);
    expect((deps.pendingHydration as Set<string>).has("scope/old.md")).toBe(false);
  });

  it("migrates pending rename hydration through the outcome without pre-marking the new path", () => {
    const { deps } = createDeps({
      live: [["scope/new.md", file("scope/new.md")]],
      pending: ["scope/old.md"],
    });
    const renamed = mutate(
      { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
      [record("scope/old.md")],
      deps,
    );

    expect(renamed.hydrationPaths).toEqual(["scope/new.md"]);
    expect((deps.pendingHydration as Set<string>).has("scope/old.md")).toBe(false);
    expect((deps.pendingHydration as Set<string>).has("scope/new.md")).toBe(false);
  });

  it("populates taskSummary from the injected metadata stub on create", () => {
    const { deps, getFileCache } = createDeps({
      live: [["scope/new.md", file("scope/new.md")]],
      getFileCache: () => ({ listItems: [{ task: " " }, { task: "x" }] }),
    });
    const created = mutate(
      { eventType: "create", path: "scope/new.md", oldPath: null, isFolder: false, fileKind: "markdown" },
      [],
      deps,
    );

    expect(created.nextCards?.[0]?.taskSummary).toEqual({ total: 2, incomplete: 1 });
    expect(getFileCache).toHaveBeenCalledTimes(1);
  });

  describe("modify", () => {
    it("replaces the published record object with live stats while preserving display fields", () => {
      const liveFile = file("scope/old.md", { ctime: 41, mtime: 97 });
      const { deps } = createDeps({ live: [["scope/old.md", liveFile]] });
      const published = record("scope/old.md", "markdown", {
        excerpt: "kept excerpt",
        previewHtml: "<p>kept</p>",
        previewMode: "text",
        hydrated: true,
        taskSummary: { total: 3, incomplete: 2 },
      });
      const outcome = mutate(
        { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [published],
        deps,
      );

      const installed = outcome.nextCards?.[0];
      expect(installed).toBeDefined();
      expect(installed).not.toBe(published);
      expect(installed?.file).toBe(liveFile);
      expect(installed?.ctime).toBe(41);
      expect(installed?.mtime).toBe(97);
      expect(installed?.excerpt).toBe("kept excerpt");
      expect(installed?.previewHtml).toBe("<p>kept</p>");
      expect(installed?.previewMode).toBe("text");
      expect(installed?.taskSummary).toEqual({ total: 3, incomplete: 2 });
      expect(installed?.hydrated).toBe(false);
      // The previously published record object is never mutated.
      expect(published.mtime).toBe(2);
      expect(published.ctime).toBe(1);
      expect(published.hydrated).toBe(true);
      expect(outcome.hydrationPaths).toEqual(["scope/old.md"]);
    });

    it("reinserts a modified card by ascending mtime", () => {
      const { deps } = createDeps({
        live: [["a.md", file("a.md", { ctime: 1, mtime: 10 })]],
        sort: { field: "mtime", direction: "asc" },
      });
      const outcome = mutate(
        { eventType: "modify", path: "a.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("a.md", "markdown", { ctime: 1, mtime: 1 }), record("b.md", "markdown", { ctime: 1, mtime: 5 })],
        deps,
      );
      expect(outcome.nextCards?.map((card) => card.path)).toEqual(["b.md", "a.md"]);
    });

    it("reinserts a modified card by descending mtime", () => {
      const { deps } = createDeps({
        live: [["a.md", file("a.md", { ctime: 1, mtime: 10 })]],
        sort: { field: "mtime", direction: "desc" },
      });
      const outcome = mutate(
        { eventType: "modify", path: "a.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("a.md", "markdown", { ctime: 1, mtime: 1 }), record("b.md", "markdown", { ctime: 1, mtime: 5 })],
        deps,
      );
      expect(outcome.nextCards?.map((card) => card.path)).toEqual(["a.md", "b.md"]);
    });

    it("reinserts a modified card by ascending and descending ctime", () => {
      const asc = createDeps({
        live: [["a.md", file("a.md", { ctime: 9, mtime: 2 })]],
        sort: { field: "ctime", direction: "asc" as const },
      });
      expect(mutate(
        { eventType: "modify", path: "a.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("a.md", "markdown", { ctime: 1, mtime: 2 }), record("b.md", "markdown", { ctime: 5, mtime: 2 })],
        asc.deps,
      ).nextCards?.map((card) => card.path)).toEqual(["b.md", "a.md"]);

      const desc = createDeps({
        live: [["a.md", file("a.md", { ctime: 9, mtime: 2 })]],
        sort: { field: "ctime", direction: "desc" as const },
      });
      expect(mutate(
        { eventType: "modify", path: "a.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("a.md", "markdown", { ctime: 1, mtime: 2 }), record("b.md", "markdown", { ctime: 5, mtime: 2 })],
        desc.deps,
      ).nextCards?.map((card) => card.path)).toEqual(["a.md", "b.md"]);
    });

    it("keeps name-sorted order stable when only timestamps change", () => {
      const { deps } = createDeps({
        live: [["b.md", file("b.md", { ctime: 50, mtime: 60 })]],
        sort: { field: "name", direction: "asc" },
      });
      const outcome = mutate(
        { eventType: "modify", path: "b.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("a.md"), record("b.md")],
        deps,
      );
      expect(outcome.nextCards?.map((card) => card.path)).toEqual(["a.md", "b.md"]);
      expect(outcome.nextCards?.[1]?.mtime).toBe(60);
    });

    it("falls back to an authoritative reload when the live file is missing", () => {
      const { deps } = createDeps();
      const outcome = mutate(
        { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("scope/old.md")],
        deps,
      );
      expect(outcome.result).toEqual({ handled: false, action: "deferred_full_reload" });
      expect(outcome.nextCards).toBeNull();
    });

    it("falls back to an authoritative reload when the live file is unsupported", () => {
      // The vault still resolves the lookup key, but the live entry's own path
      // no longer maps to a supported card kind.
      const { deps } = createDeps({ live: [["scope/old.md", file("scope/old.png")]] });
      const outcome = mutate(
        { eventType: "modify", path: "scope/old.md", oldPath: null, isFolder: false, fileKind: "markdown" },
        [record("scope/old.md")],
        deps,
      );
      expect(outcome.result).toEqual({ handled: false, action: "deferred_full_reload" });
    });
  });

  describe("rename within scope", () => {
    it("replaces the record with live identity and stats while preserving same-kind previews", () => {
      const liveFile = file("scope/new.md", { ctime: 31, mtime: 77 });
      const { deps, getFileCache } = createDeps({
        live: [["scope/new.md", liveFile]],
        getFileCache: () => ({ listItems: [{ task: " " }] }),
      });
      const published = record("scope/old.md", "markdown", {
        excerpt: "kept",
        previewHtml: "<p>kept html</p>",
        previewMode: "text",
        hydrated: true,
        taskSummary: { total: 5, incomplete: 5 },
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
        [published],
        deps,
      );

      const merged = outcome.nextCards?.[0];
      expect(merged).toBeDefined();
      expect(merged).not.toBe(published);
      expect(merged?.file).toBe(liveFile);
      expect(merged?.path).toBe("scope/new.md");
      expect(merged?.title).toBe("new");
      expect(merged?.ctime).toBe(31);
      expect(merged?.mtime).toBe(77);
      expect(merged?.excerpt).toBe("kept");
      expect(merged?.previewHtml).toBe("<p>kept html</p>");
      expect(merged?.previewMode).toBe("text");
      expect(merged?.hydrated).toBe(true);
      expect(merged?.taskSummary).toEqual({ total: 1, incomplete: 1 });
      expect(getFileCache).toHaveBeenCalledTimes(1);
      expect(getFileCache).toHaveBeenCalledWith(liveFile);
      // An already-hydrated same-kind rename needs no hydration work.
      expect(outcome.hydrationPaths).toEqual([]);
      // The previously published record object is never mutated.
      expect(published.path).toBe("scope/old.md");
      expect(published.mtime).toBe(2);
    });

    it("offers hydration when the renamed card was never hydrated", () => {
      const { deps } = createDeps({ live: [["scope/new.md", file("scope/new.md")]] });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
        [record("scope/old.md")],
        deps,
      );
      expect(outcome.hydrationPaths).toEqual(["scope/new.md"]);
      expect(outcome.nextCards?.[0]?.hydrated).toBe(false);
    });

    it("reinserts by the effective name sort using the live title", () => {
      const { deps } = createDeps({
        live: [["scope/a.md", file("scope/a.md")]],
        sort: { field: "name", direction: "asc" },
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/a.md", oldPath: "scope/z.md", isFolder: false, fileKind: "markdown" },
        [record("scope/b.md"), record("scope/z.md")],
        deps,
      );
      expect(outcome.nextCards?.map((card) => [card.path, card.title])).toEqual([
        ["scope/a.md", "a"],
        ["scope/b.md", "b"],
      ]);
    });

    it("resets previews through placeholder preparation when markdown becomes canvas", () => {
      const { deps, prepareRecordsFromCache } = createDeps({
        live: [["scope/new.canvas", file("scope/new.canvas")]],
      });
      const published = record("scope/old.md", "markdown", {
        excerpt: "text excerpt",
        previewHtml: "<p>markdown html</p>",
        previewMode: "text",
        hydrated: true,
        taskSummary: { total: 2, incomplete: 1 },
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.canvas", oldPath: "scope/old.md", isFolder: false, fileKind: "canvas" },
        [published],
        deps,
      );

      const merged = outcome.nextCards?.[0];
      expect(merged?.fileKind).toBe("canvas");
      expect(merged?.taskSummary).toBeNull();
      expect(merged?.previewHtml).not.toBe("<p>markdown html</p>");
      expect(merged?.previewHtml).toContain("fce-preview-placeholder");
      expect(merged?.previewMode).toBe("placeholder");
      expect(merged?.hydrated).toBe(true);
      expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
      expect(prepareRecordsFromCache.mock.calls[0]?.[0]).toHaveLength(1);
      expect(prepareRecordsFromCache.mock.calls[0]?.[0]?.[0]?.path).toBe("scope/new.canvas");
      // The placeholder satisfies hydration; no read is required.
      expect(outcome.hydrationPaths).toEqual([]);
    });

    it("resets previews and requests hydration when canvas becomes markdown", () => {
      const { deps, prepareRecordsFromCache } = createDeps({
        live: [["scope/new.md", file("scope/new.md")]],
        getFileCache: () => ({ listItems: [{ task: "x" }] }),
      });
      const published = record("scope/old.canvas", "canvas", {
        previewHtml: '<p class="fce-preview-placeholder">canvas</p>',
        previewMode: "placeholder",
        hydrated: true,
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.canvas", isFolder: false, fileKind: "markdown" },
        [published],
        deps,
      );

      const merged = outcome.nextCards?.[0];
      expect(merged?.fileKind).toBe("markdown");
      expect(merged?.taskSummary).toEqual({ total: 1, incomplete: 0 });
      expect(merged?.previewHtml).toBe("");
      expect(merged?.previewMode).toBe("empty");
      expect(merged?.hydrated).toBe(false);
      expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
      expect(outcome.hydrationPaths).toEqual(["scope/new.md"]);
    });

    it("falls back to an authoritative reload when the rename destination is missing", () => {
      const { deps } = createDeps();
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
        [record("scope/old.md")],
        deps,
      );
      expect(outcome.result).toEqual({ handled: false, action: "deferred_full_reload" });
      expect(outcome.nextCards).toBeNull();
    });

    it("removes the card and prunes selection when the rename leaves the scope", () => {
      let selection = { selectedPaths: new Set(["scope/old.md"]), anchorPath: "scope/old.md" };
      const { deps, setBulkSelection } = createDeps({
        live: [["scope/new.md", file("scope/new.md")]],
        getBulkSelection: () => selection,
        isPathInActiveScope: (path) => path === "scope/old.md",
      });
      setBulkSelection.mockImplementation((next) => {
        selection = next;
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
        [record("scope/old.md")],
        deps,
      );

      expect(outcome.result).toEqual({ handled: true, action: "removed" });
      expect(outcome.nextCards).toEqual([]);
      expect(selection.selectedPaths.size).toBe(0);
      expect(selection.anchorPath).toBeNull();
    });

    it("migrates selection and anchor with Set semantics", () => {
      let selection = { selectedPaths: new Set(["scope/old.md"]), anchorPath: "scope/old.md" };
      const { deps, setBulkSelection } = createDeps({
        live: [["scope/new.md", file("scope/new.md")]],
        getBulkSelection: () => selection,
      });
      setBulkSelection.mockImplementation((next) => {
        selection = next;
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
        [record("scope/old.md")],
        deps,
      );

      expect(outcome.result.action).toBe("updated");
      expect(Array.from(selection.selectedPaths)).toEqual(["scope/new.md"]);
      expect(selection.anchorPath).toBe("scope/new.md");
    });
  });

  describe("metadata-first rename-destination collision", () => {
    it("merges a same-kind destination into one record with live values and deduped selection", () => {
      const liveFile = file("scope/new.md", { ctime: 21, mtime: 22 });
      let selection = {
        selectedPaths: new Set(["scope/old.md", "scope/new.md"]),
        anchorPath: "scope/old.md",
      };
      const { deps, setBulkSelection, getFileCache } = createDeps({
        live: [["scope/new.md", liveFile]],
        pending: ["scope/old.md", "scope/new.md"],
        getFileCache: () => ({ listItems: [{ task: " " }, { task: " " }] }),
        getBulkSelection: () => selection,
      });
      setBulkSelection.mockImplementation((next) => {
        selection = next;
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.md", oldPath: "scope/old.md", isFolder: false, fileKind: "markdown" },
        [
          record("scope/old.md", "markdown", {
            previewHtml: "<p>survives</p>",
            previewMode: "text",
            hydrated: true,
          }),
          record("scope/new.md"),
        ],
        deps,
      );

      // One final path: exactly one destination record, old path fully removed.
      expect(outcome.nextCards?.map((card) => card.path)).toEqual(["scope/new.md"]);
      const merged = outcome.nextCards?.[0];
      expect(merged?.file).toBe(liveFile);
      expect(merged?.ctime).toBe(21);
      expect(merged?.mtime).toBe(22);
      expect(merged?.previewHtml).toBe("<p>survives</p>");
      expect(merged?.previewMode).toBe("text");
      expect(merged?.hydrated).toBe(true);
      expect(merged?.taskSummary).toEqual({ total: 2, incomplete: 2 });
      expect(getFileCache).toHaveBeenCalledTimes(1);
      // Both pending keys are canceled.
      const pending = deps.pendingHydration as Set<string>;
      expect(pending.has("scope/old.md")).toBe(false);
      expect(pending.has("scope/new.md")).toBe(false);
      // Set semantics: an already-selected destination does not duplicate.
      expect(Array.from(selection.selectedPaths)).toEqual(["scope/new.md"]);
      expect(selection.anchorPath).toBe("scope/new.md");
      // Canceled pending reads stay candidates; the caller filters by visibility.
      expect(outcome.hydrationPaths).toEqual(["scope/new.md"]);
    });

    it("merges a kind-changing collision through fresh preparation", () => {
      const liveFile = file("scope/new.canvas", { ctime: 33, mtime: 34 });
      const { deps, prepareRecordsFromCache } = createDeps({
        live: [["scope/new.canvas", liveFile]],
        pending: ["scope/old.md", "scope/new.canvas"],
      });
      const outcome = mutate(
        { eventType: "rename", path: "scope/new.canvas", oldPath: "scope/old.md", isFolder: false, fileKind: "canvas" },
        [
          record("scope/old.md", "markdown", {
            previewHtml: "<p>markdown</p>",
            previewMode: "text",
            hydrated: true,
            taskSummary: { total: 4, incomplete: 1 },
          }),
          record("scope/new.canvas", "canvas", {
            previewMode: "placeholder",
            hydrated: true,
          }),
        ],
        deps,
      );

      expect(outcome.nextCards?.map((card) => card.path)).toEqual(["scope/new.canvas"]);
      const merged = outcome.nextCards?.[0];
      expect(merged?.fileKind).toBe("canvas");
      expect(merged?.file).toBe(liveFile);
      expect(merged?.ctime).toBe(33);
      expect(merged?.mtime).toBe(34);
      expect(merged?.taskSummary).toBeNull();
      expect(merged?.previewMode).toBe("placeholder");
      expect(merged?.hydrated).toBe(true);
      expect(prepareRecordsFromCache).toHaveBeenCalledTimes(1);
      const pending = deps.pendingHydration as Set<string>;
      expect(pending.has("scope/old.md")).toBe(false);
      expect(pending.has("scope/new.canvas")).toBe(false);
      // The canceled destination read stays a candidate; the caller drops it
      // because the merged record is already hydrated by preparation.
      expect(outcome.hydrationPaths).toEqual(["scope/new.canvas"]);
    });
  });

  it("inserts a renamed-in card with factory defaults", () => {
    const liveFile = file("scope/arrived.md", { ctime: 12, mtime: 13 });
    const { deps } = createDeps({ live: [["scope/arrived.md", liveFile]] });
    const outcome = mutate(
      { eventType: "rename", path: "scope/arrived.md", oldPath: "elsewhere/gone.md", isFolder: false, fileKind: "markdown" },
      [record("scope/stays.md")],
      deps,
    );

    expect(outcome.result).toEqual({ handled: true, action: "inserted" });
    const inserted = outcome.nextCards?.find((card) => card.path === "scope/arrived.md");
    expect(inserted?.file).toBe(liveFile);
    expect(inserted?.ctime).toBe(12);
    expect(inserted?.mtime).toBe(13);
    expect(inserted?.previewMode).toBe("empty");
    expect(inserted?.hydrated).toBe(false);
    expect(outcome.hydrationPaths).toEqual(["scope/arrived.md"]);
  });
});
