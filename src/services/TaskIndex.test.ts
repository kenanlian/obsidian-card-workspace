import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

import { RuntimeWorkGate } from "../runtime/work-gate";
import type { MetadataChangeEvent } from "./MetadataEventBus";
import { TaskIndex } from "./TaskIndex";
import type { VaultMutationEvent } from "./vault-events";

interface FakeFile {
  path: string;
  extension: string;
  stat: { mtime: number; ctime: number; size: number };
}

interface ListItem {
  position: { start: { line: number }; end: { line: number } };
  parent: number;
  task?: string;
}

function markdown(path: string, mtime = 10): FakeFile {
  return { path, extension: path.toLowerCase().endsWith(".md") ? "md" : path.split(".").pop() ?? "", stat: { mtime, ctime: 1, size: 1 } };
}

function listItem(line: number, parent: number, task?: string): ListItem {
  return { position: { start: { line }, end: { line } }, parent, task };
}

function mutation(event: Pick<VaultMutationEvent, "eventType" | "path"> & Partial<VaultMutationEvent>): VaultMutationEvent {
  return { oldPath: null, isFolder: false, fileKind: null, ...event };
}

function settle(): Promise<void> {
  return new Promise((resolve) => queueMicrotask(resolve));
}

function createHarness(options: {
  readers?: number;
  gate?: RuntimeWorkGate;
  files?: FakeFile[];
  cache?: Map<string, { listItems?: ListItem[] } | null>;
  read?: (file: FakeFile) => Promise<string>;
} = {}) {
  const files = new Map((options.files ?? []).map((file) => [file.path, file]));
  const caches = options.cache ?? new Map<string, { listItems?: ListItem[] } | null>();
  const cachedRead = vi.fn(options.read ?? (async () => ""));
  const getFileCache = vi.fn((file: FakeFile) => (caches.has(file.path) ? caches.get(file.path) ?? null : null));
  const app = {
    vault: {
      getFileByPath: (path: string) => files.get(path) ?? null,
      cachedRead,
    },
    metadataCache: { getFileCache },
  };
  const gate = options.gate ?? new RuntimeWorkGate();
  const index = new TaskIndex(app as unknown as App, gate, options.readers ?? 4);
  return { index, files, caches, cachedRead, getFileCache, gate };
}

function taskCache(path: string, items: ListItem[] | null = [listItem(0, -1, " ")]): [string, { listItems: ListItem[] } | null] {
  return [path, items === null ? null : { listItems: items }];
}

const PARENT_AND_CHILD = "- [ ] parent\n  - [x] child\n";

describe("TaskIndex", () => {
  it("skips missing and non-markdown paths, skips the read when nothing is a task, and builds a tree when tasks exist", async () => {
    const plain = markdown("notes/plain.md", 10);
    const task = markdown("notes/task.md", 20);
    const image = markdown("notes/pic.png", 30);
    const { index, cachedRead } = createHarness({
      files: [plain, task, image],
      cache: new Map<string, { listItems?: ListItem[] } | null>([
        ["notes/plain.md", { listItems: [listItem(0, -1)] }],
        ["notes/task.md", { listItems: [listItem(0, -1, " "), listItem(1, 0, "x")] }],
      ]),
      read: async () => PARENT_AND_CHILD,
    });
    const listener = vi.fn();
    index.subscribe(listener);

    await index.ensure(["notes/plain.md", "notes/missing.md", "notes/pic.png", "notes/task.md", "notes/task.md"]);
    await settle();

    expect(cachedRead).toHaveBeenCalledTimes(1);
    expect(cachedRead).toHaveBeenCalledWith(task);
    expect(index.get("notes/plain.md")).toEqual({ path: "notes/plain.md", mtime: 10, roots: [] });
    expect(index.get("notes/missing.md")).toBeNull();
    expect(index.get("notes/pic.png")).toBeNull();
    expect(index.get("notes/task.md")).toMatchObject({
      path: "notes/task.md",
      mtime: 20,
      roots: [{ line: 0, lineText: "- [ ] parent", children: [{ line: 1, lineText: "  - [x] child", children: [] }] }],
    });
    const notified = listener.mock.calls.flatMap((call) => [...(call[0].paths as Set<string>)]);
    expect(notified.sort()).toEqual(["notes/plain.md", "notes/task.md"]);
  });

  it("tracks an unparsed cache without reading and recomputes on the next metadata change", async () => {
    const file = markdown("notes/a.md", 5);
    const caches = new Map<string, { listItems?: ListItem[] } | null>([taskCache(file.path, null)]);
    const { index, cachedRead } = createHarness({
      files: [file],
      cache: caches,
      read: async () => "- [ ] later\n",
    });

    await index.ensure([file.path]);
    expect(cachedRead).not.toHaveBeenCalled();
    expect(index.get(file.path)).toEqual({ path: file.path, mtime: 5, roots: [] });

    caches.set(file.path, { listItems: [listItem(0, -1, " ")] });
    await index.handleMetadataEvent({ kind: "changed", path: file.path });
    expect(cachedRead).toHaveBeenCalledTimes(1);
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] later");
  });

  it("does not re-read a tracked file whose mtime is unchanged", async () => {
    const file = markdown("notes/a.md", 8);
    const { index, cachedRead } = createHarness({
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => "- [ ] stay\n",
    });

    await index.ensure([file.path]);
    cachedRead.mockClear();
    await index.ensure([file.path]);
    expect(cachedRead).not.toHaveBeenCalled();
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] stay");
  });

  it("shares one in-flight read across concurrent ensure calls", async () => {
    const file = markdown("notes/a.md");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { index, cachedRead } = createHarness({
      readers: 1,
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => { await held; return "- [ ] shared\n"; },
    });

    const first = index.ensure([file.path]);
    const second = index.ensure([file.path]);
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(1));
    await settle();
    expect(cachedRead).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    expect(cachedRead).toHaveBeenCalledTimes(1);
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] shared");
  });

  it("never runs more file reads than the reader budget", async () => {
    const files = Array.from({ length: 6 }, (_, index) => markdown(`notes/${index}.md`));
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const { index, cachedRead } = createHarness({
      readers: 2,
      files,
      cache: new Map(files.map((file) => taskCache(file.path))),
      read: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return "- [ ] item\n";
      },
    });

    const pending = index.ensure(files.map((file) => file.path));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    expect(cachedRead).toHaveBeenCalledTimes(2);
    expect(peak).toBe(2);
    while (cachedRead.mock.calls.length < files.length) {
      const batch = releases.splice(0);
      expect(batch.length).toBeGreaterThan(0);
      expect(batch.length).toBeLessThanOrEqual(2);
      for (const release of batch) release();
      await vi.waitFor(() => expect(releases.length > 0 || cachedRead.mock.calls.length === files.length).toBe(true));
    }
    for (const release of releases.splice(0)) release();
    await pending;
    expect(peak).toBe(2);
    expect(cachedRead).toHaveBeenCalledTimes(files.length);
  });

  it("waits for the work gate before touching the vault", async () => {
    const gate = new RuntimeWorkGate();
    gate.setActive(false);
    const file = markdown("notes/a.md");
    const { index, cachedRead, getFileCache } = createHarness({
      gate,
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => "- [ ] gated\n",
    });

    const pending = index.ensure([file.path]);
    await settle();
    await settle();
    expect(cachedRead).not.toHaveBeenCalled();
    expect(getFileCache).not.toHaveBeenCalled();
    gate.setActive(true);
    await pending;
    expect(cachedRead).toHaveBeenCalledTimes(1);
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] gated");
  });

  it("rejects an already-aborted ensure without reading", async () => {
    const file = markdown("notes/a.md");
    const { index, cachedRead } = createHarness({
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => "- [ ] item\n",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(index.ensure([file.path], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(cachedRead).not.toHaveBeenCalled();
    expect(index.get(file.path)).toBeNull();
  });

  it("stops scheduling further reads when the caller aborts", async () => {
    const files = [0, 1, 2].map((index) => markdown(`notes/${index}.md`));
    const controller = new AbortController();
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { index, cachedRead } = createHarness({
      readers: 1,
      files,
      cache: new Map(files.map((file) => taskCache(file.path))),
      read: async () => {
        controller.abort();
        await held;
        return "- [ ] item\n";
      },
    });

    const pending = index.ensure(files.map((file) => file.path), controller.signal);
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(1));
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(cachedRead).toHaveBeenCalledTimes(1);
  });

  it("rejects when aborted while the work gate is paused", async () => {
    const gate = new RuntimeWorkGate();
    gate.setActive(false);
    const file = markdown("notes/a.md");
    const controller = new AbortController();
    const { index, cachedRead } = createHarness({
      gate,
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => "- [ ] item\n",
    });
    const pending = index.ensure([file.path], controller.signal);
    await settle();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    gate.setActive(true);
    await settle();
    expect(cachedRead).not.toHaveBeenCalled();
  });

  it("recomputes a tracked file on metadata change and notifies once for the new roots", async () => {
    const file = markdown("notes/a.md", 4);
    const listener = vi.fn();
    const { index, cachedRead } = createHarness({
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => "- [ ] before\n",
    });
    index.subscribe(listener);
    await index.ensure([file.path]);
    await settle();
    listener.mockClear();
    cachedRead.mockImplementation(async () => "- [ ] after\n");

    await index.handleMetadataEvent({ kind: "changed", path: file.path });
    await settle();

    expect(cachedRead).toHaveBeenCalledTimes(2);
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] after");
    expect(listener).toHaveBeenCalledTimes(1);
    expect([...(listener.mock.calls[0]?.[0].paths as Set<string>)]).toEqual([file.path]);
  });

  it("discards a stale in-flight read when a newer metadata change wins", async () => {
    const file = markdown("notes/a.md", 7);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    const { index, cachedRead } = createHarness({
      readers: 1,
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => {
        reads += 1;
        if (reads === 1) {
          await held;
          return "- [ ] old\n";
        }
        return "- [ ] new\n";
      },
    });

    const pending = index.ensure([file.path]);
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(1));
    const changed: MetadataChangeEvent = { kind: "changed", path: file.path };
    const meta = index.handleMetadataEvent(changed);
    await settle();
    release();
    await pending;
    await meta;

    expect(reads).toBe(2);
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] new");
  });

  it("does not resurrect a path deleted while its read is in flight", async () => {
    const file = markdown("notes/a.md");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const { index, files, cachedRead } = createHarness({
      readers: 1,
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => { await held; return "- [ ] ghost\n"; },
    });
    const pending = index.ensure([file.path]);
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(1));
    files.delete(file.path);
    await index.handleVaultMutation(mutation({ eventType: "delete", path: file.path }));
    release();
    await pending;
    expect(index.get(file.path)).toBeNull();
  });

  it("ignores modify and create, deletes tracked files, and moves a renamed file", async () => {
    const file = markdown("dir/a.md", 3);
    const listener = vi.fn();
    const { index, files, caches, cachedRead } = createHarness({
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async (target) => `- [ ] ${target.path}\n`,
    });
    index.subscribe(listener);
    await index.ensure([file.path]);
    await settle();
    listener.mockClear();
    cachedRead.mockClear();

    await index.handleVaultMutation(mutation({ eventType: "modify", path: file.path }));
    await index.handleVaultMutation(mutation({ eventType: "create", path: "dir/new.md" }));
    await index.handleMetadataEvent({ kind: "resolved", path: file.path });
    await index.handleMetadataEvent({ kind: "changed", path: "dir/untracked.md" });
    expect(cachedRead).not.toHaveBeenCalled();
    expect(index.get(file.path)?.roots[0]?.lineText).toBe("- [ ] dir/a.md");

    files.delete(file.path);
    const moved = markdown("dir/b.md", 3);
    files.set(moved.path, moved);
    caches.set(moved.path, caches.get(file.path) ?? null);
    await index.handleVaultMutation(mutation({ eventType: "rename", path: moved.path, oldPath: file.path }));
    await settle();

    expect(index.get(file.path)).toBeNull();
    expect(index.get(moved.path)?.roots[0]?.lineText).toBe("- [ ] dir/b.md");
    const renamed = listener.mock.calls.flatMap((call) => [...(call[0].paths as Set<string>)]);
    expect(renamed).toEqual(expect.arrayContaining([file.path, moved.path]));
  });

  it("renames and deletes tracked descendants without touching a prefix lookalike", async () => {
    const nested = markdown("folder/sub/b.md", 2);
    const lookalike = markdown("folder2/c.md", 4);
    const { index, files, caches } = createHarness({
      files: [nested, lookalike],
      cache: new Map([taskCache(nested.path), taskCache(lookalike.path)]),
      read: async (file) => `- [ ] ${file.path}\n`,
    });
    await index.ensure([nested.path, lookalike.path]);

    const nextPath = "renamed/sub/b.md";
    files.delete(nested.path);
    nested.path = nextPath;
    files.set(nextPath, nested);
    caches.set(nextPath, caches.get("folder/sub/b.md") ?? null);
    await index.handleVaultMutation(mutation({
      eventType: "rename", path: "renamed", oldPath: "folder", isFolder: true,
    }));

    expect(index.get("folder/sub/b.md")).toBeNull();
    expect(index.get(nextPath)?.roots[0]?.lineText).toBe(`- [ ] ${nextPath}`);
    expect(index.get(lookalike.path)?.roots[0]?.lineText).toBe("- [ ] folder2/c.md");

    files.delete(nextPath);
    await index.handleVaultMutation(mutation({ eventType: "delete", path: "renamed", isFolder: true }));
    await settle();
    expect(index.get(nextPath)).toBeNull();
    expect(index.get(lookalike.path)?.path).toBe(lookalike.path);
  });

  it("coalesces paths that change in the same turn into one notification", async () => {
    const files = ["a.md", "b.md", "c.md"].map((path) => markdown(path));
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const listener = vi.fn();
    const { index, cachedRead } = createHarness({
      readers: 4,
      files,
      cache: new Map(files.map((file) => taskCache(file.path))),
      read: async () => { await held; return "- [ ] item\n"; },
    });
    index.subscribe(listener);
    const pending = index.ensure(files.map((file) => file.path));
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(files.length));
    release();
    await pending;
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    expect([...(listener.mock.calls[0]?.[0].paths as Set<string>)].sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("does not notify when a forced recompute leaves roots and mtime unchanged", async () => {
    const file = markdown("notes/a.md", 6);
    const listener = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { index, cachedRead } = createHarness({
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => "- [ ] same\n",
    });
    index.subscribe(() => { throw new Error("listener failed"); });
    index.subscribe(listener);
    await index.ensure([file.path]);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[Card Workspace] Task index listener failed.", expect.any(Error));
    listener.mockClear();
    warn.mockClear();

    await index.ensure([file.path]);
    await index.handleMetadataEvent({ kind: "changed", path: file.path });
    await settle();

    expect(cachedRead).toHaveBeenCalledTimes(2);
    expect(listener).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("cancels in-flight work on dispose and ignores later calls", async () => {
    const file = markdown("notes/a.md");
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const listener = vi.fn();
    const { index, cachedRead } = createHarness({
      files: [file],
      cache: new Map([taskCache(file.path)]),
      read: async () => { await held; return "- [ ] late\n"; },
    });
    index.subscribe(listener);
    const pending = index.ensure([file.path]);
    await vi.waitFor(() => expect(cachedRead).toHaveBeenCalledTimes(1));

    index.dispose();
    release();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await settle();
    expect(index.get(file.path)).toBeNull();
    expect(listener).not.toHaveBeenCalled();

    cachedRead.mockClear();
    await expect(index.ensure([file.path])).resolves.toBeUndefined();
    await index.handleMetadataEvent({ kind: "changed", path: file.path });
    await index.handleVaultMutation(mutation({ eventType: "delete", path: file.path }));
    expect(cachedRead).not.toHaveBeenCalled();
    expect(index.get(file.path)).toBeNull();
    expect(index.subscribe(vi.fn())()).toBeUndefined();
    index.dispose();
  });
});
