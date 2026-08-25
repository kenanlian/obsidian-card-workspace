import { describe, expect, it, vi, type Mock } from "vitest";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS } from "../../settings";
import { createFolderScope } from "../scope";
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
  } as NoteCardRecord;
}

type ReadMock = Mock<(file: { path: string }) => Promise<string>>;

function harness(
  records: NoteCardRecord[],
  read: ReadMock = vi.fn(async () => "preview"),
) {
  const store = createViewStateStore(createFolderScope("", true));
  store.replaceBaseCards(records);
  store.replaceVisibleCards(records);
  const context = {
    getApp: () => ({ vault: { cachedRead: read } }), store, epochs: createViewEpochs(),
    getSettings: () => ({ ...DEFAULT_SETTINGS, previewLines: 5 }),
    getUiStrings: () => getUiStrings("en"), publishGroups: vi.fn(),
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  return { context, controller: new HydrationController({ context, isLoading: () => false }), read };
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
  it("prepares non-Markdown placeholders synchronously without reads", () => {
    const records = [card("diagram.canvas", "canvas")];
    const { controller, read } = harness(records);
    controller.prepareRecordsFromCache(records);
    expect(HydrationController.startupCardCount).toBe(6);
    expect(records[0]).toMatchObject({ hydrated: true, previewMode: "placeholder" });
    expect(read).not.toHaveBeenCalled();
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
});
