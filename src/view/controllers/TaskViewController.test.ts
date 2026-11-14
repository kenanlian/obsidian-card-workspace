import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_GROUP_SPEC } from "../../card-grouping-settings";
import { DEFAULT_SETTINGS, mergeSettings, type PluginSettings } from "../../settings";
import type { TaskFileEntry, TaskIndexChange, TaskIndexReader } from "../../tasks";
import { createBoxScope, createFolderScope, createLinksScope, type CardScope } from "../scope";
import type { CardBoxDefinition, NoteCardRecord } from "../types";
import type { CardFileKind } from "../file-kind";
import { createViewEpochs } from "../view-epochs";
import { createViewStateStore } from "../view-state-store";
import { TaskViewController } from "./TaskViewController";

function card(path: string, fileKind: CardFileKind = "markdown"): NoteCardRecord {
  return {
    file: { path, basename: path } as NoteCardRecord["file"],
    fileKind,
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

interface PendingEnsure {
  paths: readonly string[];
  signal: AbortSignal | undefined;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function createFakeIndex() {
  const entries = new Map<string, TaskFileEntry>();
  const listeners = new Set<(change: TaskIndexChange) => void>();
  const pending: PendingEnsure[] = [];
  const index: TaskIndexReader = {
    ensure: vi.fn((paths: readonly string[], signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
      const request: PendingEnsure = {
        paths: [...paths],
        signal,
        resolve: () => {
          for (const path of paths) entries.set(path, { path, mtime: 1, roots: [] });
          resolve();
        },
        reject,
      };
      signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      pending.push(request);
    })),
    get: (path) => entries.get(path) ?? null,
    subscribe: vi.fn((listener: (change: TaskIndexChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return {
    index,
    entries,
    pending,
    listeners,
    emit: (...paths: string[]) => {
      for (const listener of [...listeners]) listener({ paths: new Set(paths) });
    },
  };
}

function makeBox(overrides: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Box",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { ...DEFAULT_GROUP_SPEC },
    ...overrides,
  };
}

function createHarness(options: {
  scope?: CardScope;
  settings?: Partial<PluginSettings>;
  cards?: NoteCardRecord[];
  index?: TaskIndexReader | null;
  settled?: () => boolean;
} = {}) {
  let settings = mergeSettings(DEFAULT_SETTINGS, { defaultView: "tasks", ...options.settings });
  const store = createViewStateStore(options.scope ?? createFolderScope("notes", true));
  store.replaceBaseCards(options.cards ?? [card("notes/a.md"), card("notes/b.md"), card("notes/c.png", "image")]);
  const events: string[] = [];
  const reproject = vi.fn(() => events.push("reproject"));
  const publish = vi.fn(() => events.push("publish"));
  const onStreamModeChanged = vi.fn((mode: string) => events.push(`mode:${mode}`));
  const controller = new TaskViewController({
    context: {
      getApp: () => ({}) as never,
      store,
      epochs: createViewEpochs(),
      getSettings: () => settings,
      saveSettings: async () => undefined,
      getUiStrings: () => ({}) as never,
      publishGroups: () => undefined,
      requestUpdate: async () => undefined,
      notify: () => undefined,
      getViewWindow: () => ({ setTimeout, clearTimeout }),
    },
    getTaskIndex: () => (options.index === undefined ? null : options.index),
    isScopeSettled: options.settled,
    onStreamModeChanged,
    reproject,
    publish,
  });
  return {
    controller,
    store,
    events,
    reproject,
    publish,
    onStreamModeChanged,
    setSettings: (patch: Partial<PluginSettings>) => {
      settings = mergeSettings(settings, patch);
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("TaskViewController mode gating", () => {
  it("never touches the task index in card mode", () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index, settings: { defaultView: "cards" } });
    h.controller.sync();
    expect(h.controller.isTaskMode()).toBe(false);
    expect(h.controller.getStatus()).toBe("idle");
    expect(fake.index.ensure).not.toHaveBeenCalled();
    expect(fake.index.subscribe).not.toHaveBeenCalled();
    expect(h.onStreamModeChanged).not.toHaveBeenCalled();
  });

  it("forces links scopes to card mode even when the global default is tasks", () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index, scope: createLinksScope("notes/a.md", "backlinks") });
    h.controller.sync();
    expect(h.controller.isTaskMode()).toBe(false);
    expect(fake.index.ensure).not.toHaveBeenCalled();
  });

  it("reads the box view mode for box scopes", () => {
    const fake = createFakeIndex();
    const h = createHarness({
      index: fake.index,
      scope: createBoxScope("box-1"),
      settings: { defaultView: "cards", boxes: [makeBox({ viewMode: "tasks" })] },
    });
    expect(h.controller.isTaskMode()).toBe(true);
    h.setSettings({ defaultView: "tasks", boxes: [makeBox({ viewMode: "cards" })] });
    expect(h.controller.isTaskMode()).toBe(false);
  });
});

describe("TaskViewController ensure lifecycle", () => {
  it("reports building, ensures only Markdown base paths, then projects and publishes once ready", async () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });

    h.controller.sync();
    expect(h.controller.getStatus()).toBe("building");
    expect(h.onStreamModeChanged).toHaveBeenCalledWith("tasks");
    expect(fake.index.ensure).toHaveBeenCalledTimes(1);
    expect(fake.pending[0]?.paths).toEqual(["notes/a.md", "notes/b.md"]);
    expect(h.reproject).not.toHaveBeenCalled();

    fake.pending[0]?.resolve();
    await flush();
    expect(h.controller.getStatus()).toBe("ready");
    expect(h.events).toEqual(["mode:tasks", "reproject", "publish"]);
    expect(h.controller.getEntry("notes/a.md")).toEqual({ path: "notes/a.md", mtime: 1, roots: [] });
  });

  it("is ready at once when every entry already exists, and repeated syncs are idempotent", () => {
    const fake = createFakeIndex();
    fake.entries.set("notes/a.md", { path: "notes/a.md", mtime: 1, roots: [] });
    fake.entries.set("notes/b.md", { path: "notes/b.md", mtime: 1, roots: [] });
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    h.controller.sync();
    expect(h.controller.getStatus()).toBe("ready");
    expect(fake.index.ensure).not.toHaveBeenCalled();
    expect(fake.index.subscribe).toHaveBeenCalledTimes(1);
    expect(h.onStreamModeChanged).toHaveBeenCalledTimes(1);
  });

  it("is ready without an index so the stream never stays building", () => {
    const h = createHarness({ index: null });
    h.controller.sync();
    expect(h.controller.getStatus()).toBe("ready");
  });

  it("projects what exists after a failed read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    fake.pending[0]?.reject(new Error("disk"));
    await flush();
    expect(h.controller.getStatus()).toBe("ready");
    expect(h.reproject).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("drops and aborts a stale ensure when the scope changes", async () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    const first = fake.pending[0]!;

    h.store.setScope(createFolderScope("other", true));
    h.store.replaceBaseCards([card("other/x.md")]);
    h.controller.sync();
    expect(first.signal?.aborted).toBe(true);
    expect(h.controller.getStatus()).toBe("building");
    expect(fake.pending[1]?.paths).toEqual(["other/x.md"]);
    expect(h.onStreamModeChanged).toHaveBeenCalledTimes(1);

    first.resolve();
    await flush();
    expect(h.reproject).not.toHaveBeenCalled();

    fake.pending[1]?.resolve();
    await flush();
    expect(h.controller.getStatus()).toBe("ready");
    expect(h.reproject).toHaveBeenCalledTimes(1);
  });

  it("tears down and reports card mode when leaving task mode mid-build", async () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    h.setSettings({ defaultView: "cards" });
    h.controller.sync();

    expect(fake.pending[0]?.signal?.aborted).toBe(true);
    expect(fake.listeners.size).toBe(0);
    expect(h.controller.getStatus()).toBe("idle");
    expect(h.onStreamModeChanged).toHaveBeenLastCalledWith("cards");
    fake.pending[0]?.resolve();
    await flush();
    expect(h.reproject).not.toHaveBeenCalled();
  });

  it("defers the ready publish while a scope load is unsettled", async () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index, settled: () => false });
    h.controller.sync();
    fake.pending[0]?.resolve();
    await flush();
    expect(h.controller.getStatus()).toBe("ready");
    expect(h.reproject).not.toHaveBeenCalled();
  });

  it("ensures a path that joins the base set while staying ready", async () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    fake.pending[0]?.resolve();
    await flush();
    h.reproject.mockClear();

    h.store.replaceBaseCards([...h.store.getBaseCards(), card("notes/new.md")]);
    h.controller.sync();
    h.controller.sync();
    expect(h.controller.getStatus()).toBe("ready");
    expect(fake.index.ensure).toHaveBeenCalledTimes(2);
    expect(fake.pending[1]?.paths).toEqual(["notes/new.md"]);

    fake.pending[1]?.resolve();
    await flush();
    expect(h.reproject).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledTimes(2);
  });
});

describe("TaskViewController index changes", () => {
  async function readyHarness() {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    fake.pending[0]?.resolve();
    await flush();
    h.reproject.mockClear();
    h.publish.mockClear();
    return { fake, h };
  }

  it("reprojects once per coalesced burst of in-scope changes", async () => {
    const { fake, h } = await readyHarness();
    fake.emit("notes/a.md");
    fake.emit("notes/b.md");
    vi.advanceTimersByTime(49);
    expect(h.reproject).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(h.reproject).toHaveBeenCalledTimes(1);
    expect(h.publish).toHaveBeenCalledTimes(1);
  });

  it("ignores changes for paths outside the current base set", async () => {
    const { fake, h } = await readyHarness();
    fake.emit("elsewhere/z.md");
    vi.advanceTimersByTime(100);
    expect(h.reproject).not.toHaveBeenCalled();
  });

  it("ignores changes while building", () => {
    const fake = createFakeIndex();
    const h = createHarness({ index: fake.index });
    h.controller.sync();
    fake.emit("notes/a.md");
    vi.advanceTimersByTime(100);
    expect(h.reproject).not.toHaveBeenCalled();
  });

  it("aborts the read, unsubscribes and cancels a pending change on dispose", async () => {
    const { fake, h } = await readyHarness();
    h.store.replaceBaseCards([...h.store.getBaseCards(), card("notes/late.md")]);
    h.controller.sync();
    fake.emit("notes/a.md");

    expect(h.controller.dispose()).toEqual({ cancelledDebounce: true });
    expect(fake.pending[1]?.signal?.aborted).toBe(true);
    expect(fake.listeners.size).toBe(0);
    vi.advanceTimersByTime(100);
    await flush();
    expect(h.reproject).not.toHaveBeenCalled();

    h.controller.sync();
    expect(fake.index.subscribe).toHaveBeenCalledTimes(1);
    expect(h.controller.getStatus()).toBe("idle");
  });
});
