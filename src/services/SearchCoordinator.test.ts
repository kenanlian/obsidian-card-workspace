import { afterEach, describe, expect, it, vi } from "vitest";

import { getUiStrings } from "../i18n";
import { SearchCoordinator } from "./SearchCoordinator";
import { VaultEventBus } from "./VaultEventBus";
import type { VaultMutationEvent } from "./vault-events";

const idleTasks = vi.hoisted(() => ({ queue: [] as Array<() => void> }));

vi.mock("../search", () => {
  return {
    IndexStore: class MockIndexStore {},
    SearchIndexManager: class MockSearchIndexManager {},
    IndexedSearchService: class MockIndexedSearchService {},
    IndexBuildGuard: class MockIndexBuildGuard {},
    scheduleIdleTask: vi.fn((task: () => void) => {
      idleTasks.queue.push(task);
      return () => {
        idleTasks.queue = idleTasks.queue.filter((entry) => entry !== task);
      };
    }),
    prepareSearchableDocument: vi.fn((input: { path: string; title: string; markdown?: string; mtime: number; ctime: number }) => ({
      path: input.path,
      title: input.title,
      normalizedTitle: input.title.toLowerCase(),
      content: input.markdown ?? "",
      excerpt: input.markdown ?? "",
      folderPath: "",
      mtime: input.mtime,
      ctime: input.ctime,
    })),
  };
});

vi.mock("obsidian", () => {
  class MockTAbstractFile {
    path = "";
  }

  class MockTFile extends MockTAbstractFile {
    basename = "";
    stat: { mtime: number; ctime: number } = { mtime: 0, ctime: 0 };
  }

  return {
    Notice: class MockNotice {},
    TAbstractFile: MockTAbstractFile,
    TFile: MockTFile,
  };
});

interface CardFileLike {
  path: string;
  basename: string;
  stat: { mtime: number; ctime: number };
}

interface DocumentSourceHarness {
  coordinator: SearchCoordinator;
  cachedRead: ReturnType<typeof vi.fn>;
}

function createHarness(markdown: string): DocumentSourceHarness {
  const cachedRead = vi.fn(async () => markdown);
  const app = {
    vault: {
      cachedRead,
      adapter: { basePath: "/vault/base" },
      getAbstractFileByPath: vi.fn(() => null),
    },
  };

  const coordinator = new SearchCoordinator({
    getApp: () => app as never,
    getUiStrings: () => getUiStrings("en"),
    getPluginVersion: () => "1.0.2",
  });

  return { coordinator, cachedRead };
}

function createFile(path: string, basename: string, mtime: number, ctime: number): CardFileLike {
  return { path, basename, stat: { mtime, ctime } };
}

describe("SearchCoordinator document preparation", () => {
  it("prepares markdown documents with cached reads and title-only pdf documents without cached reads", async () => {
    const { coordinator, cachedRead } = createHarness("# Markdown Note\n\nunique-markdown-term");
    const prepare = (coordinator as unknown as {
      prepareSearchableDocumentFromFile(file: unknown): Promise<unknown>;
    }).prepareSearchableDocumentFromFile.bind(coordinator);

    const markdownFile = createFile("notes/Markdown Note.md", "Markdown Note", 20, 10);
    const nonMarkdownFile = createFile("Assets/Project Brief.pdf", "Project Brief", 30, 15);

    const markdownDocument = await prepare(markdownFile);
    const nonMarkdownDocument = await prepare(nonMarkdownFile);

    expect(cachedRead).toHaveBeenCalledTimes(1);
    expect(markdownDocument).toEqual(
      expect.objectContaining({
        path: markdownFile.path,
        title: markdownFile.basename,
        content: expect.stringContaining("unique-markdown-term"),
      }),
    );
    expect(nonMarkdownDocument).toEqual(
      expect.objectContaining({
        path: nonMarkdownFile.path,
        title: nonMarkdownFile.basename,
        content: "",
        excerpt: "",
      }),
    );
  });
});

function createVaultEvent(overrides: Partial<VaultMutationEvent> = {}): VaultMutationEvent {
  return {
    eventType: "modify",
    path: "notes/a.md",
    oldPath: null,
    isFolder: false,
    fileKind: "markdown",
    ...overrides,
  };
}

describe("SearchCoordinator vault subscription", () => {
  afterEach(() => {
    idleTasks.queue = [];
    vi.restoreAllMocks();
  });

  it("subscribeTo forwards events through applyVaultMutation and dispose unsubscribes", async () => {
    const bus = new VaultEventBus();
    const { coordinator } = createHarness("");
    const apply = vi.spyOn(coordinator, "applyVaultMutation");

    coordinator.subscribeTo(bus);
    await bus.publish(createVaultEvent());
    expect(apply).toHaveBeenCalledTimes(1);

    coordinator.dispose();
    await bus.publish(createVaultEvent({ path: "notes/b.md" }));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("subscribeTo replaces a previous subscription so one event is forwarded once", async () => {
    const bus = new VaultEventBus();
    const { coordinator } = createHarness("");
    const apply = vi.spyOn(coordinator, "applyVaultMutation");

    coordinator.subscribeTo(bus);
    coordinator.subscribeTo(bus);
    await bus.publish(createVaultEvent());

    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("buffers cloned pre-initialize mutations across runtime reset and replays once in arrival order", async () => {
    const bus = new VaultEventBus();
    const { coordinator } = createHarness("");
    coordinator.subscribeTo(bus);
    const original = createVaultEvent({ eventType: "create", path: "notes/created.md" });
    await bus.publish(original);
    original.path = "mutated-after-publish.md";
    (coordinator as unknown as { resetSearchRuntime(): void }).resetSearchRuntime();
    await bus.publish(createVaultEvent({ eventType: "delete", path: "notes/deleted.md" }));

    const forwarded: unknown[] = [];
    const internals = coordinator as unknown as {
      searchService: { handleVaultMutation(event: unknown): void };
      mutationForwardingReady: boolean;
      replayBufferedMutations(): void;
    };
    internals.searchService = { handleVaultMutation: (event) => forwarded.push(event) };
    internals.mutationForwardingReady = true;
    internals.replayBufferedMutations();
    internals.replayBufferedMutations();

    expect(forwarded).toMatchObject([
      { type: "create", path: "notes/created.md" },
      { type: "delete", path: "notes/deleted.md" },
    ]);
  });

  it("keeps startup index work off the layout-ready tick until the host is idle", async () => {
    const { coordinator } = createHarness("");
    const internals = coordinator as unknown as {
      shouldRunStartupSearchRebuild: boolean;
      runDeferredStartupWork(): Promise<void>;
    };
    internals.shouldRunStartupSearchRebuild = true;
    const deferred = vi.spyOn(internals, "runDeferredStartupWork").mockResolvedValue(undefined);

    coordinator.flushDeferredStartupWork();
    expect(deferred).not.toHaveBeenCalled();

    idleTasks.queue.splice(0).forEach((task) => task());
    expect(deferred).toHaveBeenCalledTimes(1);
  });

  it("schedules no idle work when startup left nothing to reconcile", () => {
    const { coordinator } = createHarness("");

    coordinator.flushDeferredStartupWork();

    expect(idleTasks.queue).toHaveLength(0);
  });

  it("skips the unattended rebuild and notifies when the build guard is suspended", async () => {
    const { coordinator } = createHarness("");
    const internals = coordinator as unknown as {
      buildGuard: { canAutoBuild(): Promise<boolean> };
      runStartupRebuildIfPermitted(detail: string): Promise<void>;
    };
    internals.buildGuard = { canAutoBuild: vi.fn(async () => false) };
    const rebuild = vi.spyOn(coordinator, "rebuild").mockResolvedValue(undefined);

    await internals.runStartupRebuildIfPermitted("startup");

    expect(rebuild).not.toHaveBeenCalled();
  });

  it("runs the unattended rebuild when the build guard permits it", async () => {
    const { coordinator } = createHarness("");
    const internals = coordinator as unknown as {
      buildGuard: { canAutoBuild(): Promise<boolean> };
      runStartupRebuildIfPermitted(detail: string): Promise<void>;
    };
    internals.buildGuard = { canAutoBuild: vi.fn(async () => true) };
    const rebuild = vi.spyOn(coordinator, "rebuild").mockResolvedValue(undefined);

    await internals.runStartupRebuildIfPermitted("startup");

    expect(rebuild).toHaveBeenCalledWith("startup");
  });

  it("asks the rebuild to clear the suspension when a user requests it explicitly", async () => {
    const { coordinator } = createHarness("");
    const rebuild = vi.spyOn(coordinator, "rebuild").mockResolvedValue(undefined);

    await coordinator.rebuildManually("manual");

    expect(rebuild).toHaveBeenCalledWith("manual", { resetGuard: true });
  });

  it("clears the suspension and marks the attempt before the build starts", async () => {
    const { coordinator } = createHarness("");
    const order: string[] = [];
    const guard = {
      reset: vi.fn(async () => { order.push("reset"); }),
      markBuildStarted: vi.fn(async () => { order.push("markStarted"); }),
      markBuildCompleted: vi.fn(async () => { order.push("markCompleted"); }),
    };
    const manager = { rebuildFromSource: vi.fn(async () => { order.push("build"); }) };
    const internals = coordinator as unknown as {
      buildGuard: typeof guard;
      searchManager: typeof manager;
      searchSnapshot: { status: string };
      layoutReady: boolean;
    };
    internals.buildGuard = guard;
    internals.searchManager = manager;
    internals.searchSnapshot = { status: "ready" };
    internals.layoutReady = true;

    await coordinator.rebuildManually("manual");

    expect(order).toEqual(["reset", "markStarted", "build", "markCompleted"]);
  });

  it("leaves the attempt marker in place when a build does not reach ready", async () => {
    const { coordinator } = createHarness("");
    const guard = {
      reset: vi.fn(async () => undefined),
      markBuildStarted: vi.fn(async () => undefined),
      markBuildCompleted: vi.fn(async () => undefined),
    };
    const internals = coordinator as unknown as {
      buildGuard: typeof guard;
      searchManager: { rebuildFromSource: () => Promise<void> };
      searchSnapshot: { status: string };
      layoutReady: boolean;
    };
    internals.buildGuard = guard;
    internals.searchManager = { rebuildFromSource: vi.fn(async () => undefined) };
    internals.searchSnapshot = { status: "error" };
    internals.layoutReady = true;

    await coordinator.rebuild("startup");

    expect(guard.markBuildStarted).toHaveBeenCalledTimes(1);
    expect(guard.markBuildCompleted).not.toHaveBeenCalled();
  });

  it("isolates applyVaultMutation throws with the search-forwarding warn", async () => {
    const bus = new VaultEventBus();
    const { coordinator } = createHarness("");
    vi.spyOn(coordinator, "applyVaultMutation").mockImplementation(() => {
      throw new Error("search boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    coordinator.subscribeTo(bus);
    await expect(bus.publish(createVaultEvent())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[Card Workspace] Search service mutation forwarding failed.",
      expect.objectContaining({ message: "search boom" }),
    );
  });
});
