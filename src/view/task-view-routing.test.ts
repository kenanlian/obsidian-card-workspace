/**
 * Node-project FolderCardView contracts for the task stream under the panel mock seam:
 * toolbar routing, bulk gating, and the published cards/projection panel groups.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  createCardRecord,
  createMarkdownFile,
  publishAll,
  flushAsyncWork,
  registerFolderCardView,
} from "../__mocks__/folder-card-view-harness";
import { FolderCardView } from "./FolderCardView";
import { createBoxScope, createFolderScope } from "./scope";
import { createCardBox } from "./card-boxes";
import { parseTaskLine, type TaskFileEntry, type TaskIndexReader } from "../tasks";

registerFolderCardView(FolderCardView);

function createTaskIndex() {
  const entries = new Map<string, TaskFileEntry>();
  const pending: Array<() => void> = [];
  const index: TaskIndexReader = {
    ensure: vi.fn((paths: readonly string[]) => new Promise<void>((resolve) => {
      pending.push(() => {
        for (const path of paths) {
          const lineText = `- [ ] task in ${path}`;
          entries.set(path, { path, mtime: 1, roots: [{ line: 0, lineText, parsed: parseTaskLine(lineText)!, children: [] }] });
        }
        resolve();
      });
    })),
    get: (path) => entries.get(path) ?? null,
    subscribe: vi.fn(() => () => undefined),
  };
  return { index, pending };
}

async function openTaskView(defaultView: "cards" | "tasks") {
  const harness = createViewWithFile("notes/a.md");
  const { view, plugin } = harness;
  const base = plugin.getSettings();
  const settings = { ...base, defaultView };
  plugin.getSettings = vi.fn(() => settings);
  const tasks = createTaskIndex();
  plugin.getTaskIndex = vi.fn(() => tasks.index);
  await (view as any).onOpen();
  (view as any).cardScope = createFolderScope("notes", true);
  (view as any).baseCards = [
    createCardRecord(createMarkdownFile("notes/a.md")),
    createCardRecord(createMarkdownFile("notes/b.md")),
  ];
  return { ...harness, settings, tasks, state: () => (view as any).panelModel.getState() };
}

afterEach(async () => {
  for (let step = 0; step < 6; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

describe("task view routing", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("publishes the card-mode defaults for the new panel fields", async () => {
    const h = await openTaskView("cards");
    publishAll(h.view);
    const state = h.state();
    expect(state.cards).toMatchObject({ streamMode: "cards", taskRecords: [], taskStatus: "idle" });
    expect(state.cards.records.map((card: { path: string }) => card.path)).toEqual(["notes/a.md", "notes/b.md"]);
    expect(state.projection).toMatchObject({
      viewMode: "cards",
      taskSort: { field: "due", direction: "asc" },
      taskGroup: { dimension: "none" },
      taskViewAvailable: true,
    });
    expect(h.tasks.index.ensure).not.toHaveBeenCalled();
  });

  it("toggles the global default view from the toolbar `view-mode` action", async () => {
    const h = await openTaskView("cards");
    mockState.panelEventHandlers["toolbar-action"]({ detail: { action: "view-mode" } });
    await flushAsyncWork();
    expect(h.plugin.saveSettings).toHaveBeenCalledWith({ defaultView: "tasks" });
  });

  it("publishes building with no rows, then the complete task list once the index is ready", async () => {
    const h = await openTaskView("tasks");
    publishAll(h.view);
    expect(h.state().cards).toMatchObject({ streamMode: "tasks", records: [], taskRecords: [], taskStatus: "building" });
    expect(h.state().projection).toMatchObject({ viewMode: "tasks", taskViewAvailable: true });
    expect(h.tasks.index.ensure).toHaveBeenCalledWith(["notes/a.md", "notes/b.md"], expect.any(AbortSignal));

    for (const resolve of h.tasks.pending) resolve();
    await flushAsyncWork();
    const cards = h.state().cards;
    expect(cards.taskStatus).toBe("ready");
    expect(cards.records).toEqual([]);
    expect(cards.taskRecords.map((task: { path: string; text: string }) => [task.path, task.text])).toEqual([
      ["notes/a.md::L0", "task in notes/a.md"],
      ["notes/b.md::L0", "task in notes/b.md"],
    ]);
  });

  it("returns from single-pane navigation immediately after a mode toggle", async () => {
    const h = await openTaskView("cards");
    Object.assign(h.settings, { navPaneWidth: 240, navPaneCollapsed: false });
    const layout = (h.view as any).modules.navLayout;
    layout.onShellResize(200);
    expect(layout.getLayoutMode()).toBe("single");
    await layout.onToggleNavPane();
    expect(layout.getNavVisible()).toBe(true);
    await (h.view as any).modules.arrangementActions.setViewMode("tasks");
    expect(layout.getNavVisible()).toBe(false);
  });

  it("routes the group menu with its cursor position to the host controller", async () => {
    const h = await openTaskView("tasks");
    const openGroupMenu = vi.spyOn((h.view as any).modules.taskFilters, "openGroupMenu").mockImplementation(() => {});
    const anchor = {} as HTMLElement;
    h.view.handleToolbarAction({ action: "task-group-menu", groupKey: "open", anchor, position: { x: 120, y: 80 } });
    expect(openGroupMenu).toHaveBeenCalledWith(anchor, "open", { x: 120, y: 80 });
  });

  it("exits bulk mode on entering tasks and ignores bulk toolbar actions in task mode", async () => {
    const h = await openTaskView("cards");
    publishAll(h.view);
    mockState.panelEventHandlers["toolbar-action"]({ detail: { action: "bulk" } });
    expect((h.view as any).modules.bulk.bulkMode).toBe(true);

    h.settings.defaultView = "tasks";
    publishAll(h.view);
    expect((h.view as any).modules.bulk.bulkMode).toBe(false);

    mockState.panelEventHandlers["toolbar-action"]({ detail: { action: "bulk" } });
    mockState.panelEventHandlers["toolbar-action"]({ detail: { action: "bulk-select-all" } });
    expect((h.view as any).modules.bulk.bulkMode).toBe(false);
    expect((h.view as any).modules.bulk.selectedPaths.size).toBe(0);
  });

  it("restores box browse filters when entering tasks from an active draw", async () => {
    const h = await openTaskView("cards");
    const box = createCardBox("Tasks", []);
    h.settings.boxes = [box];
    (h.view as any).cardScope = createBoxScope(box.id);
    (h.view as any).store.setDrawPaths(["notes/a.md"]);
    publishAll(h.view);
    expect(h.state().scope.browseTagFilterEnabled).toBe(false);
    expect(h.state().scope.draw.active).toBe(true);

    h.settings.defaultView = "tasks";
    publishAll(h.view);
    expect((h.view as any).store.getDrawPaths()).toBeNull();
    expect(h.state().scope.draw).toMatchObject({ active: false, available: false });
    expect(h.state().scope.browseTagFilterEnabled).toBe(true);
    expect(h.state().scope.browsePropertyFilterEnabled).toBe(true);
  });
});
