import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, type App, type CachedMetadata } from "obsidian";
import { RuntimeWorkGate } from "../runtime/work-gate";
import { NavigationMetadataCatalog } from "./NavigationMetadataCatalog";

function harness(count = 1) {
  const files = Array.from({ length: count }, (_, index) => {
    const file = new TFile(); file.path = `folder/${index}.md`; file.extension = "md"; return file;
  });
  const live = new Map(files.map(file => [file.path, file]));
  const caches = new Map<string, CachedMetadata | null>();
  const getMarkdownFiles = vi.fn(() => files);
  const getFileCache = vi.fn((file: TFile) => caches.get(file.path) ?? null);
  const app = { vault: { getMarkdownFiles, getAbstractFileByPath: (path: string) => live.get(path) ?? null }, metadataCache: { getFileCache } } as unknown as App;
  const idle: { task?: () => void } = {};
  const scheduleIdle = vi.fn((task: () => void, _timeout: number) => { idle.task = task; return vi.fn(); });
  const scheduleTimer = (task: () => void, ms: number) => { const id = setTimeout(task, ms); return () => clearTimeout(id); };
  return { files, live, caches, getMarkdownFiles, getFileCache, app, idle, scheduleIdle, scheduleTimer };
}

afterEach(() => vi.useRealTimers());

describe("NavigationMetadataCatalog", () => {
  it("seeds scope identities without cache reads or file enumeration and skips unchanged snapshots", () => {
    const h = harness();
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer });
    const tags = ["Work/Now"];
    const facets = [{ key: "status", label: "Status", valuedCount: 1, missingCount: 2, values: [
      { ref: { kind: "number" as const, value: 1 }, label: "1", count: 1 },
      { ref: { kind: "missing" as const }, label: "Unassigned", count: 2 },
    ] }];
    catalog.seedScope(tags, facets);
    const snapshot = catalog.getSnapshot();
    catalog.seedScope(tags, facets);
    expect(catalog.getSnapshot()).toBe(snapshot);
    expect(snapshot).toEqual({ ready: false, tags, properties: [{ key: "status", label: "Status", values: [{ kind: "number", value: 1 }] }] });
    expect(h.getFileCache).not.toHaveBeenCalled(); expect(h.getMarkdownFiles).not.toHaveBeenCalled();
    catalog.seedScope(["Elsewhere"], [{ ...facets[0]!, label: "STATUS", values: [{ ref: { kind: "text", value: "1" }, label: "1", count: 0 }] }]);
    expect(catalog.getSnapshot()).toMatchObject({ tags: ["Elsewhere", "Work/Now"], properties: [{ key: "status", label: "STATUS", values: [{ kind: "number", value: 1 }, { kind: "text", value: "1" }] }] });
    catalog.dispose();
  });

  it("replaces foreground scope seeds with the scanned vault and does no scope seeding after ready", () => {
    const h = harness(); const file = h.files[0]!;
    h.caches.set(file.path, { tags: [{ tag: "#live" }] } as unknown as CachedMetadata);
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer, scheduleIdle: h.scheduleIdle });
    catalog.seedScope(["deleted", "live"], [{ key: "obsolete", label: "Obsolete", valuedCount: 1, missingCount: 0,
      values: [{ ref: { kind: "text", value: "gone" }, label: "gone", count: 1 }] }]);
    catalog.handleVaultMutation({ eventType: "delete", path: "deleted.md", oldPath: null, isFolder: false, fileKind: "markdown" });
    catalog.start(); h.idle.task!();
    const ready = catalog.getSnapshot();
    expect(ready).toEqual({ ready: true, tags: ["live"], properties: [] });
    const reads = h.getFileCache.mock.calls.length;
    catalog.seedScope(["late-stale"], []);
    expect(catalog.getSnapshot()).toBe(ready); expect(h.getFileCache).toHaveBeenCalledTimes(reads);
    catalog.dispose();
  });

  it("seeds encountered files without enumerating and coalesces identity notifications", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.caches.set(h.files[0]!.path, { tags: [{ tag: "#Work/Now" }], frontmatter: { Status: [1, "1", true] } } as unknown as CachedMetadata);
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer, scheduleIdle: h.scheduleIdle });
    const listener = vi.fn(); catalog.subscribe(listener);
    catalog.seedFiles(h.files); catalog.seedFiles(h.files);
    expect(h.getMarkdownFiles).not.toHaveBeenCalled(); expect(h.getFileCache).toHaveBeenCalledTimes(1);
    expect(catalog.getSnapshot()).toMatchObject({ ready: false, tags: ["Work/Now"], properties: [{ key: "status", label: "Status", values: [{ kind: "number", value: 1 }, { kind: "text", value: "1" }, { kind: "boolean", value: true }] }] });
    await vi.advanceTimersByTimeAsync(249); expect(listener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(listener).toHaveBeenCalledTimes(1);
    catalog.dispose();
  });

  it("starts once after idle, yields every 200 files, and skips deleted identities", async () => {
    const h = harness(401); let finish!: () => void;
    const pause = new Promise<void>(resolve => { finish = resolve; });
    const yieldTask = vi.fn().mockImplementationOnce(() => pause).mockResolvedValue(undefined);
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer, scheduleIdle: h.scheduleIdle, yieldTask });
    catalog.start(); catalog.start();
    expect(h.scheduleIdle).toHaveBeenCalledTimes(1); expect(h.scheduleIdle).toHaveBeenCalledWith(expect.any(Function), 10_000);
    expect(h.getMarkdownFiles).not.toHaveBeenCalled(); h.idle.task!();
    expect(h.getFileCache).toHaveBeenCalledTimes(200);
    h.live.delete(h.files[200]!.path); finish();
    await vi.waitFor(() => expect(catalog.getSnapshot().ready).toBe(true));
    expect(h.getFileCache).toHaveBeenCalledTimes(400); expect(yieldTask).toHaveBeenCalledTimes(2);
    catalog.dispose();
  });

  it("pauses full scans while hidden but processes incremental changes and global cache resolution", async () => {
    const h = harness(); const workGate = new RuntimeWorkGate(); workGate.setActive(false);
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer, scheduleIdle: h.scheduleIdle, workGate });
    catalog.start(); h.idle.task!();
    expect(h.getMarkdownFiles).not.toHaveBeenCalled();
    catalog.handleMetadataChange({ kind: "changed", path: h.files[0]!.path });
    h.caches.set(h.files[0]!.path, { frontmatter: { status: "new" } } as unknown as CachedMetadata);
    catalog.handleMetadataChange({ kind: "resolved", path: "" });
    expect(catalog.getSnapshot().properties[0]?.values).toEqual([{ kind: "text", value: "new" }]);
    workGate.setActive(true);
    await vi.waitFor(() => expect(catalog.getSnapshot().ready).toBe(true)); catalog.dispose();
  });

  it("keeps shared identities until their last file disappears and reconciles folder rename boundaries", () => {
    const h = harness(2);
    for (const file of h.files) h.caches.set(file.path, { tags: [{ tag: "#shared" }], frontmatter: { Status: "draft" } } as unknown as CachedMetadata);
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer }); catalog.seedFiles(h.files);
    const first = h.files[0]!; const oldPath = first.path;
    h.live.delete(oldPath); h.caches.delete(oldPath);
    catalog.handleVaultMutation({ eventType: "delete", path: oldPath, oldPath: null, isFolder: false, fileKind: "markdown" });
    expect(catalog.getSnapshot().tags).toEqual(["shared"]);
    const file = h.files[1]!; const cache = h.caches.get(file.path)!;
    h.live.delete(file.path); file.path = "moved/1.md"; h.live.set(file.path, file); h.caches.set(file.path, cache);
    catalog.handleVaultMutation({ eventType: "rename", path: "moved", oldPath: "folder", isFolder: true, fileKind: null });
    expect(catalog.getSnapshot().properties[0]?.values).toEqual([{ kind: "text", value: "draft" }]);
    catalog.handleVaultMutation({ eventType: "delete", path: "moved", oldPath: null, isFolder: true, fileKind: null });
    expect(catalog.getSnapshot()).toMatchObject({ tags: [], properties: [] }); catalog.dispose();
  });

  it("cancels a paused scan and pending notifications on disposal", async () => {
    vi.useFakeTimers(); const h = harness(); const workGate = new RuntimeWorkGate(); workGate.setActive(false);
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer, scheduleIdle: h.scheduleIdle, workGate });
    const listener = vi.fn(); catalog.subscribe(listener); catalog.seedFiles(h.files); catalog.start(); h.idle.task!(); catalog.dispose();
    workGate.setActive(true); await vi.runAllTimersAsync(); expect(h.getMarkdownFiles).not.toHaveBeenCalled(); expect(listener).not.toHaveBeenCalled();
  });

  it("retains known identities during cache absence and refreshes them when caches resolve", () => {
    const h = harness(); const path = h.files[0]!.path;
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer });
    h.caches.set(path, { tags: [{ tag: "#known" }] } as unknown as CachedMetadata); catalog.seedFiles(h.files);
    h.caches.set(path, null); catalog.handleMetadataChange({ kind: "changed", path });
    expect(catalog.getSnapshot().tags).toEqual(["known"]);
    h.caches.set(path, { tags: [{ tag: "#updated" }] } as unknown as CachedMetadata);
    catalog.handleMetadataChange({ kind: "resolved", path: "" });
    expect(catalog.getSnapshot().tags).toEqual(["updated"]); catalog.dispose();
  });

  it("migrates known contributions through a rename before the target cache is ready", () => {
    const h = harness(); const file = h.files[0]!; const oldPath = file.path;
    const catalog = new NavigationMetadataCatalog({ getApp: () => h.app, scheduleTimer: h.scheduleTimer });
    h.caches.set(oldPath, { tags: [{ tag: "#known" }] } as unknown as CachedMetadata); catalog.seedFiles(h.files);
    h.live.delete(oldPath); file.path = "new.md"; h.live.set(file.path, file);
    catalog.handleVaultMutation({ eventType: "rename", path: file.path, oldPath, isFolder: false, fileKind: "markdown" });
    expect(catalog.getSnapshot().tags).toEqual(["known"]);
    catalog.handleVaultMutation({ eventType: "delete", path: file.path, oldPath: null, isFolder: false, fileKind: "markdown" });
    expect(catalog.getSnapshot().tags).toEqual([]); catalog.dispose();
  });
});
