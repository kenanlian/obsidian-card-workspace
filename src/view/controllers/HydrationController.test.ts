import { RuntimeWorkGate } from "../../runtime/work-gate";
import { createRuntimeResourceBudget, type RuntimeResourceBudget } from "../../runtime/resource-budget";
import { describe, expect, it, vi, type Mock } from "vitest";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS } from "../../settings";
import { createFolderScope, createLinksScope } from "../scope";
import type { NoteCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { HydrationController } from "./HydrationController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function card(path: string, fileKind: NoteCardRecord["fileKind"] = "markdown"): NoteCardRecord {
  return {
    file: { path, stat: { mtime: 2 } }, fileKind, path, title: path,
    ctime: 1, mtime: 2, excerpt: "", previewHtml: "", previewMode: "empty", hydrated: false,
    taskSummary: null,
  } as NoteCardRecord;
}

type ReadMock = Mock<(file: { path: string }) => Promise<string>>;

function harness(
  records: NoteCardRecord[],
  read: ReadMock = vi.fn(async () => "preview"),
  listItemsByPath: Record<string, Array<{ task?: string }>> = {},
  getCommittedQuery?: () => string,
  resourceBudget?: RuntimeResourceBudget,
  workGate?: RuntimeWorkGate,
) {
  const store = createViewStateStore(createFolderScope("", true));
  store.replaceBaseCards(records);
  store.replaceVisibleCards(records);
  const getFileCache = vi.fn((file: { path: string }) => {
    const listItems = listItemsByPath[file.path];
    return listItems ? { listItems } : null;
  });
  const context = {
    resourceBudget, workGate,
    getApp: () => ({ vault: { cachedRead: read, getAbstractFileByPath: () => null }, metadataCache: { getFileCache } }),
    store, epochs: createViewEpochs(),
    getSettings: () => ({ ...DEFAULT_SETTINGS, previewLines: 5 }),
    getUiStrings: () => getUiStrings("en"), publishGroups: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  return {
    context, controller: new HydrationController({ context, isLoading: () => false, getCommittedQuery }),
    read, getFileCache,
  };
}

function request(context: ViewContext, records: NoteCardRecord[]) {
  return {
    generation: context.epochs.load.value,
    hydrationRevision: context.store.getHydrationRevision(),
    start: 0, end: records.length, paths: records.map((item) => item.path),
  };
}

async function ticks(count = 4): Promise<void> {
  for (let index = 0; index < count; index += 1) await Promise.resolve();
}

describe("HydrationController", () => {
  it("rebuilds cached opening previews when skipping leading tags is toggled", async () => {
    const record = card("tags.md");
    const { context, controller } = harness([record], vi.fn(async () => "#读书\n正文"));
    let skipLeadingTags = false;
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, previewLines: 1, skipLeadingTags });
    for (const enabled of [false, true, false]) {
      skipLeadingTags = enabled;
      const fresh = card(record.path);
      context.store.replaceBaseCards([fresh]);
      context.store.replaceVisibleCards([fresh]);
      controller.resetForLoad();
      await controller.hydrateStartupCardPaths([record.path], context.epochs.load.token());
      expect(context.store.getBaseCard(record.path)?.previewHtml).toBe(enabled ? "<p>正文</p>" : "<p>#读书</p>");
    }
    controller.dispose();
  });

  it("allows the explicit reference expansion to complete while automatic work is paused", async () => {
    const gate = new RuntimeWorkGate(); gate.setActive(false);
    const record = card("note.md"), { controller, context, read } = harness([record], undefined, {}, undefined, undefined, gate);
    context.store.setScope(createLinksScope("source.md", "backlinks"));
    await controller.toggleReferences(record.path);
    expect(read).toHaveBeenCalledOnce(); controller.dispose(); gate.close();
  });

  it("drops paused startup prewarm that no longer belongs to the latest viewport", async () => {
    const gate = new RuntimeWorkGate(); gate.setActive(false);
    const records = [card("startup.md"), card("scrolled.md")];
    const { controller, context, read } = harness(records, undefined, {}, undefined, undefined, gate);
    const startup = controller.hydrateStartupCardPaths([records[0].path], context.epochs.load.token());
    const viewport = controller.hydrateViewport({ ...request(context, records), start: 1, paths: [records[1].path] });
    gate.setActive(true); await Promise.all([startup, viewport]);
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(["scrolled.md"]);
    controller.dispose(); gate.close();
  });

  it("starts no automatic preview while hidden and resumes only the latest viewport", async () => {
    const gate = new RuntimeWorkGate(); gate.setActive(false);
    const records = [card("old.md"), card("latest.md")];
    const { controller, context, read } = harness(records, undefined, {}, undefined, undefined, gate);
    const old = controller.hydrateViewport(request(context, [records[0]]));
    const latest = controller.hydrateViewport({ ...request(context, records), start: 1, paths: [records[1].path] });
    expect(read).not.toHaveBeenCalled(); gate.setActive(true);
    await Promise.all([old, latest]);
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(["latest.md"]);
    gate.setActive(false); context.store.advanceHydrationRevision();
    const closing = controller.hydrateViewport(request(context, records));
    controller.dispose(); await closing; gate.close();
    expect(controller.getDiagnostics()).toMatchObject({ queued: 0, cacheEntries: 0 });
  });

  it("uses a small injected read pool, prewarm and preview cache", async () => {
    const records = Array.from({ length: 5 }, (_, i) => card(`${i}.md`));
    const pending = deferred<string>();
    const { controller, context, read } = harness(records, vi.fn(() => pending.promise), {}, undefined,
      createRuntimeResourceBudget({ preview: { concurrency: 1, startupCards: 2, entries: 2 } }));
    const hydration = controller.hydrateViewport(request(context, records));
    expect(read).toHaveBeenCalledTimes(1);
    expect(controller.startupCardCount).toBe(2);
    expect(controller.getDiagnostics()).toMatchObject({ active: 1, queued: 4 });
    pending.resolve("preview"); await hydration;
    expect(read).toHaveBeenCalledTimes(5);
    expect(controller.getDiagnostics()).toMatchObject({ active: 0, queued: 0, cacheEntries: 2 });
    controller.dispose();
  });

  it.each([1, 2, 3, 4, 5])("hydrates %i independent snippets with a three-line ordinary preview", async (limit) => {
    const record = card("search.md");
    const source = Array.from({ length: 8 }, (_, index) => `section ${index} needle`).join("\n\n");
    const { controller, context } = harness([record], vi.fn(async () => source), {}, () => "needle");
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, previewLines: 3, searchPreviewSnippetCount: limit });
    await controller.hydrateViewport(request(context, [record]));
    const preview = context.store.getBaseCard(record.path)?.searchPreview;
    expect(preview?.snippets).toHaveLength(limit);
    expect(preview?.snippetLimit).toBe(limit);
    expect(preview?.previewLines).toBe(3);
    controller.dispose();
  });

  it("does not reuse snippets after the limit changes and restores the ordinary preview on clear", async () => {
    const record = card("search.md");
    let query = "needle";
    let limit = 2;
    const { controller, context, read } = harness([record], vi.fn(async () => "needle\n\nneedle\n\nneedle\n\nneedle\n\nneedle"), {}, () => query);
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, searchPreviewSnippetCount: limit });
    await controller.hydrateViewport(request(context, [record]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.snippets).toHaveLength(2);
    limit = 5;
    const replacement = card(record.path);
    context.store.replaceBaseCards([replacement]);
    context.store.replaceVisibleCards([replacement]);
    controller.prepareRecordsFromCache([replacement]);
    expect(replacement.searchPreview).toBeUndefined();
    await controller.hydrateViewport(request(context, [replacement]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.snippets).toHaveLength(5);
    query = "";
    const ordinary = card(record.path);
    controller.prepareRecordsFromCache([ordinary]);
    expect(ordinary.hydrated).toBe(true);
    expect(ordinary.searchPreview).toBeUndefined();
    expect(read).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("drops pending reads after the snippet preference changes", async () => {
    const record = card("search.md");
    const pending = deferred<string>();
    let limit = 2;
    const { controller, context } = harness([record], vi.fn(() => pending.promise), {}, () => "needle");
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, searchPreviewSnippetCount: limit });
    const hydration = controller.hydrateViewport(request(context, [record]));
    limit = 5;
    pending.resolve("needle");
    await hydration;
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    const replacement = card(record.path);
    controller.prepareRecordsFromCache([replacement]);
    expect(replacement.hydrated).toBe(false);
    controller.dispose();
  });

  it("caches search snippets in the shared preview entry and rebinds IDs after a load", async () => {
    const record = card("search.md");
    const { controller, context, read } = harness([record], vi.fn(async () => "needle\nsecond needle"), {}, () => "needle");
    await controller.hydrateViewport(request(context, [record]));
    const originalId = context.store.getBaseCard(record.path)!.searchPreview!.snippets[0].id;
    context.epochs.load.bump();
    controller.resetForLoad();
    const replacement = card(record.path);
    context.store.replaceBaseCards([replacement]);
    context.store.replaceVisibleCards([replacement]);
    controller.prepareRecordsFromCache([replacement]);
    await controller.hydrateViewport(request(context, [replacement]));
    expect(read).toHaveBeenCalledTimes(1);
    expect(replacement.searchPreview!.snippets[0].id).not.toBe(originalId);
  });

  it.each(["folder", "box", "links"] as const)("hydrates body snippets in %s scope", async (kind) => {
    const record = card("search.md");
    const { controller, context } = harness([record], vi.fn(async () => "needle"), {}, () => "needle");
    if (kind === "box") context.store.setScope({ kind, boxId: "box" });
    if (kind === "links") context.store.setScope({ kind, notePath: "source.md", direction: "backlinks" });
    await controller.hydrateViewport(request(context, [record]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("hits");
    controller.dispose();
  });

  it("settles failed body reads as unavailable and non-Markdown hits as title-only", async () => {
    const records = [card("failed.md"), card("diagram.canvas", "canvas")];
    const { controller, context, read } = harness(records, vi.fn(async () => { throw new Error("read failed"); }), {}, () => "needle");
    await controller.hydrateViewport(request(context, records));
    expect(context.store.getBaseCard("failed.md")?.searchPreview?.status).toBe("unavailable");
    expect(context.store.getBaseCard("diagram.canvas")?.searchPreview?.status).toBe("title-only");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reads missing title-only previews and reuses the ordinary entry after search changes", async () => {
    const record = card("title.md");
    let query = "";
    const { context, read } = harness([record], vi.fn(async () => "ordinary opening"));
    const controller = new HydrationController({
      context, isLoading: () => false, getCommittedQuery: () => query, getMatchFields: () => ["title"],
    });
    query = "needle";
    await controller.hydrateViewport(request(context, [record]));
    expect(read).toHaveBeenCalledTimes(1);
    expect(context.store.getBaseCard(record.path)).toMatchObject({searchPreview: {status: "title-only"}, previewHtml: expect.stringContaining("ordinary opening")});
    for (const next of ["other", ""]) {
      query = next;
      context.store.advanceHydrationRevision();
      await controller.hydrateViewport(request(context, [record]));
      expect(read).toHaveBeenCalledTimes(1);
      expect(context.store.getBaseCard(record.path)?.previewHtml).toContain("ordinary opening");
    }
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    controller.dispose();
  });

  it("shows unavailable when a missing title-only body cannot be read", async () => {
    const record = card("title.md");
    const { context, read } = harness([record], vi.fn(async () => { throw new Error("inaccessible"); }));
    const controller = new HydrationController({
      context, isLoading: () => false, getCommittedQuery: () => "needle", getMatchFields: () => ["title"],
    });
    await controller.hydrateViewport(request(context, [record]));
    expect(read).toHaveBeenCalledOnce();
    expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("unavailable");
    controller.dispose();
  });

  it("keeps the ordinary preview from the same body-hit read when search is cleared", async () => {
    const record = card("body.md");
    let query = "needle";
    const { controller, context, read } = harness([record], vi.fn(async () => "ordinary opening\n\nneedle"), {}, () => query);
    await controller.hydrateViewport(request(context, [record]));
    query = "";
    context.store.advanceHydrationRevision();
    await controller.hydrateViewport(request(context, [record]));
    expect(read).toHaveBeenCalledOnce();
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    expect(context.store.getBaseCard(record.path)?.previewHtml).toContain("ordinary opening");
    controller.dispose();
  });

  it("invalidates snippets immediately on modify and rename, even with unchanged mtime", async () => {
    const record = card("search.md");
    const { controller, context } = harness([record], vi.fn(async () => "needle"), {}, () => "needle");
    for (const eventType of ["modify", "rename"] as const) {
      await controller.hydrateViewport(request(context, [record]));
      expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("hits");
      controller.invalidateForVaultMutation({ eventType, path: eventType === "rename" ? "renamed.md" : record.path,
        oldPath: eventType === "rename" ? record.path : null, isFolder: false, fileKind: "markdown" });
      expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    }
  });

  it.each(["", "needle"])("rejects a body read after a same-mtime file mutation for query %s", async (query) => {
    const record = card("changed.md");
    const old = deferred<string>();
    const read = vi.fn(async () => "new needle body").mockImplementationOnce(() => old.promise);
    const {context, controller} = harness([record], read, {}, () => query);
    const hydration = controller.hydrateViewport(request(context, [record]));
    controller.invalidateForVaultMutation({eventType: "modify", path: record.path, oldPath: null, isFolder: false, fileKind: "markdown"});
    old.resolve("old needle body");
    await hydration;
    expect(read).toHaveBeenCalledTimes(2);
    expect(context.store.getBaseCard(record.path)?.previewHtml).toContain("new needle body");
    const replacement = {...card(record.path), file: record.file};
    controller.prepareRecordsFromCache([replacement]);
    expect(replacement.previewHtml).toContain("new needle body");
    expect(replacement.previewHtml).not.toContain("old needle body");
    controller.dispose();
  });

  it("does not discard an active read when a different file changes", async () => {
    const record = card("current.md");
    const pending = deferred<string>();
    const {context, controller, read} = harness([record], vi.fn(() => pending.promise), {}, () => "needle");
    const hydration = controller.hydrateViewport(request(context, [record]));
    controller.invalidateForVaultMutation({eventType: "modify", path: "other.md", oldPath: null, isFolder: false, fileKind: "markdown"});
    pending.resolve("current needle body");
    await hydration;
    expect(read).toHaveBeenCalledOnce();
    expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("hits");
    controller.dispose();
  });

  it("never publishes or caches a search extraction invalidated while yielding", async () => {
    const record = card("long.md");
    let query = "old";
    const read = vi.fn(async () => "word ".repeat(40_000) + "old\nnew");
    const { controller, context } = harness([record], read, {}, () => query);
    const hydration = controller.hydrateViewport(request(context, [record]));
    setTimeout(() => { query = "new"; context.store.advanceHydrationRevision(); }, 0);
    await hydration;
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    await controller.hydrateViewport(request(context, [record]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.query).toBe("new");
    expect(read).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("hydrates viewport context and a bounded lookahead after a committed query change", async () => {
    const records = Array.from({ length: 30 }, (_, index) => card(`${index}.md`));
    const read = vi.fn(async () => "opening\nfirst needle here\nsecond target here");
    let query = "needle";
    const { context, controller } = harness(records, read, {}, () => query);

    await controller.hydrateViewport(request(context, records.slice(0, 1)));
    await vi.waitFor(() => expect(controller.getDiagnostics()).toMatchObject({ active: 0, queued: 0 }));
    expect(read).toHaveBeenCalledTimes(25);
    expect(context.store.getBaseCard("0.md")?.searchPreview?.snippets[0].text).toContain("needle");
    expect(context.store.getBaseCard("1.md")?.hydrated).toBe(false);
    expect(controller.getDiagnostics().searchSources.entries).toBe(1);

    query = "target";
    context.store.advanceHydrationRevision();
    await controller.hydrateViewport(request(context, records.slice(0, 1)));
    await vi.waitFor(() => expect(controller.getDiagnostics()).toMatchObject({ active: 0, queued: 0 }));
    expect(read).toHaveBeenCalledTimes(49);
    expect(context.store.getBaseCard("0.md")?.searchPreview?.snippets[0].text).toContain("target");
    query = "needle";
    context.store.advanceHydrationRevision();
    await controller.hydrateViewport(request(context, records.slice(0, 1)));
    await vi.waitFor(() => expect(controller.getDiagnostics()).toMatchObject({ active: 0, queued: 0 }));
    expect(read).toHaveBeenCalledTimes(73);
    expect(context.store.getBaseCard("0.md")?.searchPreview?.snippets[0].location.from.line).toBe(1);
    controller.dispose();
  });

  it("rebuilds prepared sources after same-mtime mutations, prefix invalidation, and cache clearing", async () => {
    const record = card("folder/search.md");
    let source = "opening\nneedle old";
    let query = "needle";
    const { context, controller, read } = harness([record], vi.fn(async () => source), {}, () => query);
    await controller.hydrateViewport(request(context, [record]));
    const opening = context.store.getBaseCard(record.path)!.previewHtml;
    for (const isFolder of [false, true]) {
      source = `new opening\n\nneedle changed ${isFolder}`;
      controller.invalidateForVaultMutation({ eventType: "modify", path: record.path, oldPath: null, isFolder: false, fileKind: "markdown" });
      if (isFolder) controller.invalidateForVaultMutation({ eventType: "rename", path: "renamed", oldPath: "folder", isFolder: true, fileKind: null });
      await controller.hydrateViewport(request(context, [record]));
      const snippet = context.store.getBaseCard(record.path)!.searchPreview!.snippets[0];
      expect(snippet.text).toBe(`needle changed ${isFolder}`);
      expect(snippet.location.from.line).toBe(2);
    }
    expect(read).toHaveBeenCalledTimes(3);
    controller.clearPreviewCache();
    query = "changed";
    context.store.advanceHydrationRevision();
    await controller.hydrateViewport(request(context, [record]));
    expect(read).toHaveBeenCalledTimes(4);
    expect(context.store.getBaseCard(record.path)!.previewHtml).not.toBe(opening);
    controller.dispose();
  });

  it("prepares non-Markdown placeholders synchronously without reads", () => {
    const records = [card("diagram.canvas", "canvas")];
    const { controller, read } = harness(records);
    controller.prepareRecordsFromCache(records);
    expect(HydrationController.startupCardCount).toBe(6);
    expect(records[0]).toMatchObject({ hydrated: true, previewMode: "placeholder" });
    expect(read).not.toHaveBeenCalled();
  });

  it("V30 attaches the task summary when a card hydrates and when the cache serves it", async () => {
    const original = card("tasks.md");
    const listItems = { "tasks.md": [{ task: " " }, { task: " " }, { task: "x" }] };
    const { context, controller, getFileCache } = harness(
      [original], vi.fn(async () => "- [ ] one"), listItems,
    );

    await controller.hydrateViewport(request(context, [original]));

    expect(context.store.getBaseCard("tasks.md")?.taskSummary).toEqual({ total: 3, incomplete: 2 });
    expect(getFileCache).toHaveBeenCalledTimes(1);

    // Preview-cache hit: the record is rebuilt with a null summary by a lazy
    // load, and the synchronous prepare path must still give it one back.
    const rebuilt = card("tasks.md");
    context.store.replaceBaseCards([rebuilt]);
    context.store.replaceVisibleCards([rebuilt]);
    controller.resetForLoad();
    controller.prepareRecordsFromCache([rebuilt]);

    expect(rebuilt.hydrated).toBe(true);
    expect(rebuilt.taskSummary).toEqual({ total: 3, incomplete: 2 });
    expect(getFileCache).toHaveBeenCalledTimes(2);
  });

  it("V30 attaches the task summary even when the preview read fails", async () => {
    const record = card("unreadable.md");
    const { context, controller } = harness(
      [record], vi.fn(async () => { throw new Error("bad"); }), { "unreadable.md": [{ task: " " }] },
    );

    await controller.hydrateViewport(request(context, [record]));

    expect(context.store.getBaseCard("unreadable.md")).toMatchObject({
      hydrated: true, previewMode: "empty", taskSummary: { total: 1, incomplete: 1 },
    });
  });

  it("V30 never consults metadata for a non-Markdown placeholder", () => {
    const records = [card("diagram.canvas", "canvas")];
    const { controller, getFileCache } = harness(records, vi.fn(async () => "preview"),
      { "diagram.canvas": [{ task: " " }] });

    controller.prepareRecordsFromCache(records);

    expect(records[0]?.taskSummary).toBeNull();
    expect(getFileCache).not.toHaveBeenCalled();
  });

  it("bounds all reads at five and deduplicates paths", async () => {
    const records = Array.from({ length: 12 }, (_, index) => card(`${index}.md`));
    const reads = new Map<string, ReturnType<typeof deferred<string>>>();
    let active = 0;
    let peak = 0;
    const read = vi.fn((file: { path: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      const pending = deferred<string>();
      reads.set(file.path, pending);
      return pending.promise.finally(() => { active -= 1; });
    });
    const { context, controller } = harness(records, read);
    const hydration = controller.hydrateViewport(request(context, records));
    void controller.hydrateViewport(request(context, records));
    await ticks();
    expect(peak).toBe(5);
    while (read.mock.calls.length < records.length || reads.size > 0) {
      for (const [path, pending] of reads) {
        reads.delete(path);
        pending.resolve(path);
      }
      await ticks(8);
    }
    await hydration;
    expect(read).toHaveBeenCalledTimes(12);
    expect(peak).toBe(5);
  });

  it("prioritizes forced visible work and drops obsolete queued viewport jobs", async () => {
    const records = Array.from({ length: 8 }, (_, index) => card(`${index}.md`));
    const pending = new Map<string, ReturnType<typeof deferred<string>>>();
    const starts: string[] = [];
    const read = vi.fn((file: { path: string }) => {
      starts.push(file.path);
      const item = deferred<string>();
      pending.set(file.path, item);
      return item.promise;
    });
    const { context, controller } = harness(records, read);
    void controller.hydrateViewport(request(context, records.slice(0, 7)));
    await ticks();
    controller.schedulePath("7.md");
    void controller.hydrateViewport({ ...request(context, [records[0]]), end: 1 });
    pending.get("0.md")?.resolve("zero");
    await ticks(8);
    expect(starts[5]).toBe("7.md");
    expect(starts).not.toContain("5.md");
    expect(starts).not.toContain("6.md");
    controller.dispose();
    for (const item of pending.values()) item.resolve("done");
  });

  it("caches obsolete in-flight success without patching until requested", async () => {
    const records = [card("a.md"), card("b.md")];
    const a = deferred<string>();
    const read = vi.fn((file: { path: string }) => file.path === "a.md" ? a.promise : Promise.resolve("b"));
    const { context, controller } = harness(records, read);
    void controller.hydrateViewport(request(context, [records[0]]));
    await ticks();
    await controller.hydrateViewport({ ...request(context, [records[1]]), end: 1, paths: ["b.md"] });
    a.resolve("cached a");
    await ticks(8);
    expect(context.store.getBaseCard("a.md")?.hydrated).toBe(false);
    expect(context.publishGroups).not.toHaveBeenCalled();
    await controller.hydrateViewport({ ...request(context, [records[0]]), end: 1, paths: ["a.md"] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(context.store.getBaseCard("a.md")?.hydrated).toBe(true);
  });

  it("drops stale revision/fingerprint completion without caching or writing", async () => {
    const record = card("stale.md");
    const first = deferred<string>();
    const read = vi.fn().mockImplementationOnce(() => first.promise).mockResolvedValueOnce("fresh");
    const { context, controller } = harness([record], read);
    void controller.hydrateViewport(request(context, [record]));
    await ticks();
    context.epochs.load.bump();
    context.store.advanceHydrationRevision();
    record.mtime += 1;
    first.resolve("stale");
    await ticks(8);
    expect(context.store.getBaseCard(record.path)?.hydrated).toBe(false);
    await controller.hydrateViewport(request(context, [record]));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("rejects stale identities and never reinterprets mismatched ordered paths", async () => {
    const records = [card("first.md"), card("second.md")];
    const { context, controller, read } = harness(records);
    await controller.hydrateViewport({ ...request(context, records), generation: 9 });
    await controller.hydrateViewport({ ...request(context, records), hydrationRevision: 9 });
    await controller.hydrateViewport({ ...request(context, records), paths: ["second.md", "first.md"] });
    expect(read).not.toHaveBeenCalled();
  });

  it("retains successful cache entries across loads, clears explicitly, and never caches errors", async () => {
    const original = card("cached.md");
    const read = vi.fn().mockResolvedValueOnce("saved").mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValueOnce("retry");
    const { context, controller } = harness([original], read);
    await controller.hydrateViewport(request(context, [original]));
    const replacement = card("cached.md");
    context.store.replaceBaseCards([replacement]);
    context.store.replaceVisibleCards([replacement]);
    controller.resetForLoad();
    controller.prepareRecordsFromCache([replacement]);
    expect(replacement.hydrated).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);

    controller.clearPreviewCache();
    const failed = card("failed.md");
    context.store.replaceBaseCards([failed]);
    context.store.replaceVisibleCards([failed]);
    await controller.hydrateViewport(request(context, [failed]));
    const retry = card("failed.md");
    context.store.replaceBaseCards([retry]);
    context.store.replaceVisibleCards([retry]);
    await controller.hydrateViewport(request(context, [retry]));
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keys the preview fingerprint on the record's live mtime", async () => {
    const original = card("fingerprint.md");
    const read = vi.fn(async () => "preview");
    const { context, controller } = harness([original], read);
    await controller.hydrateViewport(request(context, [original]));
    expect(read).toHaveBeenCalledTimes(1);

    // A modify-style replacement carries a live mtime; the new fingerprint must
    // miss the old cache entry and trigger a fresh read.
    const refreshed = { ...card("fingerprint.md"), mtime: 3 };
    context.store.replaceBaseCards([refreshed]);
    context.store.replaceVisibleCards([refreshed]);
    await controller.hydrateViewport(request(context, [refreshed]));
    expect(read).toHaveBeenCalledTimes(2);

    // Same live mtime: the second read's fingerprint is cached and reused.
    const cached = { ...card("fingerprint.md"), mtime: 3 };
    context.store.replaceBaseCards([cached]);
    context.store.replaceVisibleCards([cached]);
    await controller.hydrateViewport(request(context, [cached]));
    expect(read).toHaveBeenCalledTimes(2);
    expect(context.store.getBaseCard("fingerprint.md")?.hydrated).toBe(true);
  });

  it("re-reads an already hydrated card when a forced path is scheduled", async () => {
    const record = card("forced.md");
    const read = vi.fn(async () => "preview");
    const { context, controller } = harness([record], read);
    await controller.hydrateViewport(request(context, [record]));
    expect(context.store.getBaseCard(record.path)?.hydrated).toBe(true);
    expect(read).toHaveBeenCalledTimes(1);

    controller.schedulePath(record.path);
    await ticks(8);
    expect(read).toHaveBeenCalledTimes(2);
    expect(context.store.getBaseCard(record.path)?.hydrated).toBe(true);
  });

  it("invalidates file and both boundary-safe folder rename prefixes", async () => {
    const paths = ["old/a.md", "new/b.md", "oldish/c.md"];
    const records = paths.map((path) => card(path));
    const { context, controller, read } = harness(records);
    await controller.hydrateViewport(request(context, records));
    expect(read).toHaveBeenCalledTimes(3);
    controller.invalidateForVaultMutation({
      eventType: "rename", path: "new", oldPath: "old", isFolder: true, fileKind: null,
    });
    const cold = paths.map((path) => card(path));
    context.store.replaceBaseCards(cold);
    context.store.replaceVisibleCards(cold);
    controller.prepareRecordsFromCache(cold);
    expect(cold.map((item) => item.hydrated)).toEqual([false, false, true]);
    controller.invalidateForVaultMutation({
      eventType: "delete", path: "oldish/c.md", oldPath: null,
      isFolder: false, fileKind: "markdown",
    });
    const boundary = card("oldish/c.md");
    controller.prepareRecordsFromCache([boundary]);
    expect(boundary.hydrated).toBe(false);
  });

  it("publishes a fast sibling before a slow one and coalesces simultaneous work", async () => {
    const records = [card("fast.md"), card("slow.md")];
    const fast = deferred<string>();
    const slow = deferred<string>();
    const read = vi.fn((file: { path: string }) => file.path === "fast.md" ? fast.promise : slow.promise);
    const { context, controller } = harness(records, read);
    const hydration = controller.hydrateViewport(request(context, records));
    fast.resolve("fast");
    await ticks(8);
    expect(context.store.getBaseCard("fast.md")?.hydrated).toBe(true);
    expect(context.store.getBaseCard("slow.md")?.hydrated).toBe(false);
    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    slow.resolve("slow");
    await hydration;
    expect(context.publishGroups).toHaveBeenCalledTimes(2);

    const next = [card("one.md"), card("two.md")];
    context.store.replaceBaseCards(next);
    context.store.replaceVisibleCards(next);
    (context.publishGroups as ReturnType<typeof vi.fn>).mockClear();
    await controller.hydrateViewport(request(context, next));
    expect(context.publishGroups).toHaveBeenCalledTimes(1);
  });

  it("publishes and coalesces fast startup previews without viewport demand", async () => {
    const records = [card("startup-a.md"), card("startup-b.md")];
    const { context, controller } = harness(records);

    await controller.hydrateStartupCardPaths(records.map((item) => item.path), context.epochs.load.token());

    expect(context.store.getBaseCard("startup-a.md")?.hydrated).toBe(true);
    expect(context.store.getBaseCard("startup-b.md")?.hydrated).toBe(true);
    expect(context.publishGroups).toHaveBeenCalledTimes(1);
    expect(context.publishGroups).toHaveBeenCalledWith("cards");
  });

  it("publishes startup-owned cache hits and non-Markdown placeholders", async () => {
    const first = card("cached-startup.md");
    const { context, controller } = harness([first]);
    await controller.hydrateViewport(request(context, [first]));
    const cached = card("cached-startup.md");
    context.store.replaceBaseCards([cached]);
    context.store.replaceVisibleCards([cached]);
    controller.resetForLoad();
    (context.publishGroups as ReturnType<typeof vi.fn>).mockClear();

    await controller.hydrateStartupCardPaths([cached.path], context.epochs.load.token());

    expect(context.store.getBaseCard(cached.path)?.hydrated).toBe(true);
    expect(context.publishGroups).toHaveBeenCalledTimes(1);

    const canvas = card("startup.canvas", "canvas");
    context.store.replaceBaseCards([canvas]);
    context.store.replaceVisibleCards([canvas]);
    controller.resetForLoad();
    (context.publishGroups as ReturnType<typeof vi.fn>).mockClear();

    await controller.hydrateStartupCardPaths([canvas.path], context.epochs.load.token());

    expect(context.store.getBaseCard(canvas.path)).toMatchObject({
      hydrated: true, previewMode: "placeholder",
    });
    expect(context.publishGroups).toHaveBeenCalledTimes(1);
  });

  it("returns at 120ms and publishes guarded late startup work", async () => {
    vi.useFakeTimers();
    try {
      const record = card("startup.md");
      const pending = deferred<string>();
      const { context, controller } = harness([record], vi.fn(() => pending.promise));
      const startup = controller.hydrateStartupCardPaths([record.path], context.epochs.load.token());
      await vi.advanceTimersByTimeAsync(119);
      let returned = false;
      void startup.then(() => { returned = true; });
      await ticks();
      expect(returned).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await startup;
      expect(returned).toBe(true);
      pending.resolve("late");
      await ticks(8);
      expect(context.publishGroups).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears ownership on dispose without bumping the shared load epoch", async () => {
    const record = card("pending.md");
    const pending = deferred<string>();
    const { context, controller } = harness([record], vi.fn(() => pending.promise));
    const token = context.epochs.load.token();
    void controller.hydrateViewport(request(context, [record]));
    await ticks();
    expect(controller.dispose()).toEqual({ clearedPendingHydration: true });
    expect(context.epochs.load.isCurrent(token)).toBe(true);
    pending.resolve("late");
    await ticks(8);
    expect(context.publishGroups).not.toHaveBeenCalled();
  });

  it("cancels the startup timer and settles without late publication on dispose", async () => {
    vi.useFakeTimers();
    try {
      const record = card("disposed-startup.md");
      const pending = deferred<string>();
      const { context, controller } = harness([record], vi.fn(() => pending.promise));
      const startup = controller.hydrateStartupCardPaths([record.path], context.epochs.load.token());
      expect(controller.dispose()).toEqual({
        clearedPendingHydration: true, cancelledDebounce: true,
      });
      pending.resolve("late");
      await startup;
      await vi.runAllTimersAsync();
      expect(context.publishGroups).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops startup results after the load generation changes", async () => {
    const record = card("stale-startup.md");
    const pending = deferred<string>();
    const { context, controller } = harness([record], vi.fn(() => pending.promise));
    const startup = controller.hydrateStartupCardPaths([record.path], context.epochs.load.token());
    await ticks();
    context.epochs.load.bump();
    pending.resolve("stale startup");

    await startup;
    await ticks(8);

    expect(context.store.getBaseCard(record.path)?.hydrated).toBe(false);
    expect(context.publishGroups).not.toHaveBeenCalled();
  });
});

describe("bounded search preparation and append expansion", () => {
  it("prepares the real visible window using an immutable query and installs one coherent snapshot", async () => {
    const records = Array.from({ length: 5 }, (_, index) => card(`${index}.md`));
    let query = "";
    const { controller, context, read } = harness(records, vi.fn(async () => "old opening\n\nnew needle body"), {}, () => query,
      createRuntimeResourceBudget({ searchPreview: { prepareCards: 2 } }));
    await controller.hydrateViewport({ ...request(context, []), visibleStart: 2, visibleEnd: 4 });
    const installer = await controller.prepareSearchProjection(records, {
      query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true,
    });
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(["2.md", "3.md"]);
    expect(records.every(record => record.searchPreview === undefined)).toBe(true);
    expect(context.publishGroups).not.toHaveBeenCalled();
    query = "needle";
    context.store.advanceHydrationRevision();
    installer();
    expect(context.store.getBaseCard("2.md")?.searchPreview).toMatchObject({ query: "needle", status: "hits" });
    expect(context.store.getBaseCard("0.md")?.searchPreview).toMatchObject({ query: "needle", status: "pending", expectedSnippetCount: DEFAULT_SETTINGS.searchPreviewSnippetCount });
    expect(context.publishGroups).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("keeps same-query preparation staged until its explicit installer runs", async () => {
    const record = card("same.md");
    const { controller, context } = harness([record], vi.fn(async () => "needle body"), {}, () => "needle");
    const install = await controller.prepareSearchProjection([record], {
      query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true,
    });
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    expect(context.publishGroups).not.toHaveBeenCalled();
    install();
    expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("hits");
    expect(context.publishGroups).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("stops queued preparation on timeout and shares the active read with post-commit viewport demand", async () => {
    vi.useFakeTimers();
    try {
      const records = Array.from({ length: 3 }, (_, index) => card(`${index}.md`));
      const pending = deferred<string>();
      let query = "";
      const { controller, context, read } = harness(records, vi.fn(() => pending.promise), {}, () => query,
        createRuntimeResourceBudget({ preview: { concurrency: 1 }, searchPreview: { prepareCards: 3, prepareWaitMs: 10, lookaheadCards: 1 } }));
      const preparation = controller.prepareSearchProjection(records, {
        query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true,
      });
      expect(read).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(10);
      const install = await preparation;
      expect(controller.getDiagnostics()).toMatchObject({ active: 1, queued: 0, searchPreview: { prepareTimedOut: 1 } });
      query = "needle";
      context.store.advanceHydrationRevision();
      install();
      expect(context.store.getBaseCard("0.md")?.searchPreview?.status).toBe("pending");
      const viewport = controller.hydrateViewport(request(context, [records[0]]));
      pending.resolve("opening\n\nneedle body");
      await viewport;
      expect(read.mock.calls.filter(([file]) => file.path === "0.md")).toHaveLength(1);
      expect(context.store.getBaseCard("0.md")?.searchPreview?.status).toBe("hits");
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });

  it("installs pending rows while hidden without starting preparation or prefetch", async () => {
    const gate = new RuntimeWorkGate(); gate.setActive(false);
    const record = card("hidden.md");
    let query = "";
    const { controller, context, read } = harness([record], undefined, {}, () => query, undefined, gate);
    const install = await controller.prepareSearchProjection([record], {
      query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true,
    });
    query = "needle";
    install();
    expect(read).not.toHaveBeenCalled();
    expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("pending");
    expect(controller.getDiagnostics()).toMatchObject({ active: 0, queued: 0 });
    controller.dispose(); gate.close();
  });

  it("does not install previews from a preparation whose query lost the race", async () => {
    const record = card("race.md");
    let current = true;
    const { controller, context } = harness([record], vi.fn(async () => "needle body"), {}, () => "needle");
    const install = await controller.prepareSearchProjection([record], {
      query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => current,
    });
    current = false;
    install();
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBeUndefined();
    expect(context.publishGroups).not.toHaveBeenCalled();
    controller.dispose();
  });

  it("appends twenty snippets at a time, preserves the prefix, and restores configured compactness", async () => {
    const record = card("many.md");
    const source = Array.from({ length: 55 }, (_, index) => `section ${index} needle`).join("\n\n");
    const { controller, context, read } = harness([record], vi.fn(async () => source), {}, () => "needle");
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, searchPreviewSnippetCount: 2 });
    await controller.hydrateViewport(request(context, [record]));
    const first = context.store.getBaseCard(record.path)!.searchPreview!;
    expect(first).toMatchObject({ totalSnippets: 55, expanded: false, snippetLimit: 2 });
    await controller.changeSearchSnippets(record.path, "expand");
    const expanded = context.store.getBaseCard(record.path)!.searchPreview!;
    expect(expanded.snippets).toHaveLength(22);
    expect(expanded.snippets.slice(0, 2)).toEqual(first.snippets);
    expect(expanded).toMatchObject({ totalSnippets: 55, expanded: true, snippetLimit: 2, requestedSnippetCount: 22 });
    await controller.changeSearchSnippets(record.path, "more");
    expect(context.store.getBaseCard(record.path)!.searchPreview!.snippets).toHaveLength(42);
    await controller.changeSearchSnippets(record.path, "collapse");
    expect(context.store.getBaseCard(record.path)!.searchPreview!).toMatchObject({ expanded: false, requestedSnippetCount: 2, snippetLimit: 2 });
    expect(context.store.getBaseCard(record.path)!.searchPreview!.snippets).toEqual(first.snippets);
    expect(read).toHaveBeenCalledOnce();
    const replacement = card(record.path);
    controller.prepareRecordsFromCache([replacement]);
    expect(replacement.searchPreview?.snippets).toEqual(first.snippets);
    controller.dispose();
  });

  it("retains the displayed prefix while an explicit append is pending and permits retry after failure", async () => {
    const record = card("retry.md");
    const source = Array.from({ length: 30 }, (_, index) => `${index} needle`).join("\n\n");
    const { controller, context, read } = harness([record], vi.fn(async () => source), {}, () => "needle");
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, searchPreviewSnippetCount: 2 });
    await controller.hydrateViewport(request(context, [record]));
    const original = context.store.getBaseCard(record.path)!.searchPreview!;
    controller.clearPreviewCache();
    const pending = deferred<string>();
    read.mockImplementationOnce(() => pending.promise);
    const append = controller.changeSearchSnippets(record.path, "more");
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBe(original);
    pending.reject(new Error("read failed"));
    await append;
    expect(context.store.getBaseCard(record.path)?.searchPreview?.snippets).toEqual(original.snippets);
    await controller.changeSearchSnippets(record.path, "more");
    expect(context.store.getBaseCard(record.path)?.searchPreview?.snippets).toHaveLength(22);
    controller.dispose();
  });
});

describe("search preparation owner replacement", () => {
  it("adopts an identical active read when a newer same-query request replaces its owner", async () => {
    vi.useFakeTimers();
    try {
      const record = card("adopt.md"), pending = deferred<string>();
      const { controller, context, read } = harness([record], vi.fn(() => pending.promise), {}, () => "needle",
        createRuntimeResourceBudget({ searchPreview: { prepareWaitMs: 10 } }));
      let oldCurrent = true;
      const first = controller.prepareSearchProjection([record], {
        query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => oldCurrent,
      });
      await vi.advanceTimersByTimeAsync(10);
      const installFirst = await first;
      installFirst();
      oldCurrent = false;
      const second = controller.prepareSearchProjection([record], {
        query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true,
      });
      pending.resolve("needle body");
      const installSecond = await second;
      expect(read).toHaveBeenCalledOnce();
      installSecond();
      expect(context.store.getBaseCard(record.path)?.searchPreview?.status).toBe("hits");
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });

  it("uses a prefetched result without another read and keeps automatic work gated", async () => {
    const records = Array.from({ length: 5 }, (_, index) => card(`${index}.md`));
    const gate = new RuntimeWorkGate();
    const { controller, context, read } = harness(records, vi.fn(async () => "needle body"), {}, () => "needle",
      createRuntimeResourceBudget({ searchPreview: { lookaheadCards: 1 } }), gate);
    await controller.hydrateViewport(request(context, [records[0]]));
    await vi.waitFor(() => expect(controller.getDiagnostics()).toMatchObject({ active: 0, queued: 0 }));
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getDiagnostics().searchSources.entries).toBe(1);
    gate.setActive(false);
    await controller.hydrateViewport({ ...request(context, records), start: 1, end: 2, paths: [records[1].path] });
    expect(read).toHaveBeenCalledTimes(2);
    expect(controller.getDiagnostics().searchPreview.prefetchHits).toBe(1);
    expect(controller.getDiagnostics().searchSources.entries).toBe(1);
    controller.dispose(); gate.close();
  });
});

describe("bounded preparation window clamping", () => {
  it("fills the clamped final visible window when a shorter result replaces a far-down stream", async () => {
    const records = Array.from({ length: 6 }, (_, index) => card(`${index}.md`));
    const { controller, context, read } = harness(records, vi.fn(async () => "needle body"));
    await controller.hydrateViewport({ ...request(context, []), visibleStart: 80, visibleEnd: 90 });
    await controller.prepareSearchProjection(records, { query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true });
    expect(read.mock.calls.map(([file]) => file.path)).toEqual(records.map(record => record.path));
    controller.dispose();
  });
});

describe("search expansion scope ownership", () => {
  it("does not project an old scope's expanded cache into a new scope while preserving the committed scope", async () => {
    const record = card("shared.md");
    const source = Array.from({ length: 30 }, (_, index) => `${index} needle`).join("\n\n");
    const { controller, context } = harness([record], vi.fn(async () => source), {}, () => "needle");
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, searchPreviewSnippetCount: 2 });
    await controller.hydrateViewport(request(context, [record]));
    await controller.changeSearchSnippets(record.path, "expand");
    const committed = context.store.getBaseCard(record.path)!.searchPreview!;
    expect(committed.snippets).toHaveLength(22);
    const incomingScope = createFolderScope("different", true);
    const incoming = card(record.path);
    controller.prepareRecordsFromCache([incoming], incomingScope);
    expect(incoming.searchPreview).toBeUndefined();
    expect(context.store.getBaseCard(record.path)?.searchPreview).toBe(committed);
    const oldScopeRecord = card(record.path);
    controller.prepareRecordsFromCache([oldScopeRecord]);
    expect(oldScopeRecord.searchPreview?.snippets).toHaveLength(22);
    context.store.setScope(incomingScope);
    context.store.replaceBaseCards([incoming]);
    context.store.replaceVisibleCards([incoming]);
    await controller.hydrateViewport(request(context, [incoming]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.snippets).toHaveLength(2);
    expect(context.store.getBaseCard(record.path)?.searchPreview?.expanded).toBe(false);
    controller.dispose();
  });
});

describe("prefetch demand priority", () => {
  it("defers lookahead until foreground demand settles and cancels obsolete scheduled windows", async () => {
    vi.useFakeTimers();
    try {
      const records = Array.from({ length: 5 }, (_, index) => card(`${index}.md`));
      const { controller, context, read } = harness(records, vi.fn(async () => "needle body"), {}, () => "needle",
        createRuntimeResourceBudget({ searchPreview: { lookaheadCards: 1 } }));
      await controller.hydrateViewport(request(context, [records[0]]));
      expect(read.mock.calls.map(([file]) => file.path)).toEqual(["0.md"]);
      await controller.hydrateViewport({ ...request(context, records), start: 3, end: 4, paths: [records[3].path] });
      expect(read.mock.calls.map(([file]) => file.path)).toEqual(["0.md", "3.md"]);
      await vi.runAllTimersAsync();
      expect(read.mock.calls.map(([file]) => file.path)).toEqual(["0.md", "3.md", "4.md"]);
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });

  it("retains a prepared source when viewport demand promotes an active prefetch", async () => {
    vi.useFakeTimers();
    try {
      const records = [card("0.md"), card("1.md")], pending = deferred<string>();
      let query = "needle";
      const source = "needle and target";
      const read = vi.fn(async (file: { path: string }) => file.path === "1.md" ? pending.promise : source);
      const { controller, context } = harness(records, read, {}, () => query,
        createRuntimeResourceBudget({ searchPreview: { lookaheadCards: 1 } }));
      await controller.hydrateViewport(request(context, [records[0]]));
      await vi.advanceTimersByTimeAsync(0);
      expect(read).toHaveBeenCalledTimes(2);
      const promoted = controller.hydrateViewport({ ...request(context, records), start: 1, end: 2, paths: [records[1].path] });
      pending.resolve(source);
      await promoted;
      expect(controller.getDiagnostics().searchSources.entries).toBe(2);
      query = "target";
      context.store.advanceHydrationRevision();
      await controller.hydrateViewport({ ...request(context, records), start: 1, end: 2, paths: [records[1].path] });
      expect(read).toHaveBeenCalledTimes(2);
      expect(context.store.getBaseCard("1.md")?.searchPreview?.query).toBe("target");
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });
});

describe("satisfied viewport fast path", () => {
  it("keeps an identical satisfied window's scheduled lookahead and still validates live file versions", async () => {
    vi.useFakeTimers();
    try {
      const records = [card("0.md"), card("1.md")];
      const { controller, context, read } = harness(records, vi.fn(async () => "needle body"), {}, () => "needle",
        createRuntimeResourceBudget({ searchPreview: { lookaheadCards: 1 } }));
      await controller.hydrateViewport(request(context, [records[0]]));
      const timerCount = vi.getTimerCount();
      const pendingTimer = (controller as unknown as { lookaheadTimer: number }).lookaheadTimer;
      await controller.hydrateViewport(request(context, [records[0]]));
      expect(vi.getTimerCount()).toBe(timerCount);
      expect((controller as unknown as { lookaheadTimer: number }).lookaheadTimer).toBe(pendingTimer);
      expect(read).toHaveBeenCalledOnce();
      records[0].file.stat.mtime++;
      await controller.hydrateViewport(request(context, [records[0]]));
      expect(read).toHaveBeenCalledTimes(2);
      expect(context.store.getBaseCard(records[0].path)?.searchPreview?.mtime).toBe(records[0].file.stat.mtime);
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });

  it("revalidates snippet settings and the committed query for identical viewport bounds", async () => {
    const record = card("same-bounds.md");
    let query = "needle", limit = 2;
    const source = Array.from({ length: 6 }, (_, index) => `${index} needle target`).join("\n\n");
    const { controller, context, read } = harness([record], vi.fn(async () => source), {}, () => query);
    context.getSettings = () => ({ ...DEFAULT_SETTINGS, searchPreviewSnippetCount: limit });
    await controller.hydrateViewport(request(context, [record]));
    limit = 5;
    await controller.hydrateViewport(request(context, [record]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.snippets).toHaveLength(5);
    query = "target";
    await controller.hydrateViewport(request(context, [record]));
    expect(context.store.getBaseCard(record.path)?.searchPreview?.query).toBe("target");
    expect(read).toHaveBeenCalledOnce();
    controller.dispose();
  });
});

describe("directional search lookahead", () => {
  it("reverses beyond the overscan window when real visible motion reverses", async () => {
    vi.useFakeTimers();
    try {
      const records = Array.from({ length: 12 }, (_, index) => card(`${index}.md`));
      const { controller, context, read } = harness(records, vi.fn(async () => "needle body"), {}, () => "needle",
        createRuntimeResourceBudget({ searchPreview: { lookaheadCards: 2 } }));
      const demand = (start: number, end: number, visibleStart: number, visibleEnd: number) => ({
        ...request(context, records), start, end, visibleStart, visibleEnd, paths: records.slice(start, end).map(record => record.path),
      });
      await controller.hydrateViewport(demand(7, 10, 8, 9));
      await vi.runAllTimersAsync();
      expect(read.mock.calls.map(([file]) => file.path)).toEqual(["7.md", "8.md", "9.md", "10.md", "11.md"]);
      read.mockClear();
      await controller.hydrateViewport(demand(4, 7, 5, 6));
      await vi.runAllTimersAsync();
      expect(read.mock.calls.map(([file]) => file.path)).toEqual(["4.md", "5.md", "6.md", "3.md", "2.md"]);
      controller.dispose();
    } finally { vi.useRealTimers(); }
  });
});

describe("preparation commit projection revalidation", () => {
  it("installs pending previews for cards added by browse filters while preparation waits", async () => {
    const records = [card("prepared.md"), card("newly-visible.md")];
    const pending = deferred<string>();
    let query = "";
    let projected = records.slice(0, 1);
    const { controller, context } = harness(records, vi.fn(() => pending.promise), {}, () => query);
    const preparation = controller.prepareSearchProjection(projected, {
      query: "needle", revision: 0, matchFieldsByPath: {}, isCurrent: () => true,
      getCards: () => projected,
    });
    projected = records;
    // The commit reads current host records as well as the latest projection.
    context.store.patchCardPreviews([{ path: records[1].path, patch: { previewHtml: "current ordinary body" } }]);
    pending.resolve("needle body");
    const install = await preparation;
    query = "needle";
    install();
    expect(context.store.getBaseCard(records[0].path)?.searchPreview?.status).toBe("hits");
    expect(context.store.getBaseCard(records[1].path)).toMatchObject({ previewHtml: "current ordinary body",
      searchPreview: { query: "needle", status: "pending", expectedSnippetCount: DEFAULT_SETTINGS.searchPreviewSnippetCount } });
    expect(context.publishGroups).not.toHaveBeenCalled();
    controller.dispose();
  });
});
