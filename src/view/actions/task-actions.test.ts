import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const picker = vi.hoisted(() => ({
  open: vi.fn(),
  close: vi.fn(() => false),
}));

vi.mock("../../tasks/ui/TaskDatePicker", () => ({
  openTaskDatePicker: picker.open,
  closeTaskDatePickerForAnchor: picker.close,
}));

import { getObsidianMenuInstances, resetObsidianMenuInstances } from "../../__mocks__/obsidian";
import { getUiStrings } from "../../i18n";
import type { TaskWriteResult } from "../../services/TaskWriteService";
import type { TaskCardItem, TaskCardRecord } from "../types";
import type { ViewContext } from "../view-context";
import { TASK_PENDING_SETTLE_MS, TaskActions, type TaskWriter } from "./task-actions";

const strings = getUiStrings("en");
const errors = strings.tasks.view.errors;
const ID = "notes/a.md::L2";
const TARGET = { filePath: "notes/a.md", line: 2, lineText: "- [ ] Ship it" };

function task(completed: boolean, dates: Partial<TaskCardItem["dates"]> = {}, children: TaskCardItem[] = []): TaskCardRecord {
  return {
    kind: "task",
    path: ID,
    filePath: "notes/a.md",
    file: {} as never,
    fileTitle: "a",
    fileOrder: 0,
    line: 2,
    lineText: TARGET.lineText,
    text: "Ship it",
    completed,
    statusChar: completed ? "x" : " ",
    dates: { created: null, done: null, due: null, ...dates },
    children,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createHarness(options: { device?: "desktop" | "phone"; writer?: TaskWriter | null } = {}) {
  const notify = vi.fn();
  const publishGroups = vi.fn();
  const openNote = vi.fn();
  let visible: TaskCardRecord[] = [task(false)];
  const writer: TaskWriter = options.writer === undefined
    ? { setStatus: vi.fn(), setDate: vi.fn() }
    : options.writer as TaskWriter;
  const context = {
    runtimePlatform: options.device ? { device: options.device } : undefined,
    getSettings: () => ({ autoDoneDate: true }),
    getUiStrings: () => strings,
    publishGroups,
    notify,
    getViewWindow: () => globalThis,
  } as unknown as ViewContext;
  const actions = new TaskActions({
    context,
    getWriter: () => (options.writer === null ? null : writer),
    getVisibleTasks: () => visible,
    openNote,
    today: () => "2026-11-14",
    firstDayOfWeek: () => 1,
  });
  return {
    actions, writer, notify, publishGroups, openNote,
    setVisible: (next: TaskCardRecord[]) => { visible = next; },
  };
}

beforeEach(() => {
  picker.open.mockReset();
  picker.close.mockReset();
  picker.close.mockReturnValue(false);
  resetObsidianMenuInstances();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TaskActions.toggle", () => {
  it("writes the inverted status and keeps the id pending until the projection shows it", async () => {
    const h = createHarness();
    const write = deferred<TaskWriteResult>();
    vi.mocked(h.writer.setStatus).mockReturnValue(write.promise);

    const running = h.actions.toggle({ ...TARGET, completed: false });
    expect(h.writer.setStatus).toHaveBeenCalledWith(TARGET, true, { today: "2026-11-14", autoDoneDate: true });
    expect(h.actions.getPendingIds()).toEqual([ID]);
    expect(h.publishGroups).toHaveBeenCalledWith("cards");

    write.resolve({ outcome: "ok", changed: true, line: 2 });
    await running;
    // The task index has not republished the item yet.
    expect(h.actions.getPendingIds()).toEqual([ID]);
    h.setVisible([task(true)]);
    expect(h.actions.getPendingIds()).toEqual([]);
    expect(h.notify).not.toHaveBeenCalled();
    h.actions.dispose();
  });

  it("matches nested subtasks by file and line", async () => {
    const h = createHarness();
    vi.mocked(h.writer.setStatus).mockResolvedValue({ outcome: "ok", changed: true, line: 4 });
    const child = { ...task(false), line: 4, lineText: "  - [ ] child", children: [] } as TaskCardItem;
    h.setVisible([task(false, {}, [child])]);
    await h.actions.toggle({ filePath: "notes/a.md", line: 4, lineText: "  - [ ] child", completed: false });
    expect(h.actions.getPendingIds()).toEqual(["notes/a.md::L4"]);
    h.setVisible([task(false, {}, [{ ...child, completed: true }])]);
    expect(h.actions.getPendingIds()).toEqual([]);
  });

  it("releases a settled entry after the settle timeout and republishes cards", async () => {
    vi.useFakeTimers();
    const h = createHarness();
    vi.mocked(h.writer.setStatus).mockResolvedValue({ outcome: "ok", changed: true, line: 2 });
    await h.actions.toggle({ ...TARGET, completed: false });
    h.publishGroups.mockClear();
    vi.advanceTimersByTime(TASK_PENDING_SETTLE_MS - 1);
    expect(h.actions.isPending(ID)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(h.actions.isPending(ID)).toBe(false);
    expect(h.publishGroups).toHaveBeenCalledWith("cards");
  });

  it.each([
    ["line-not-found", errors.lineNotFound],
    ["missing-file", errors.missingFile],
    ["not-a-task", errors.notATask],
    ["write-failed", errors.writeFailed],
  ] as const)("reports %s and clears pending", async (reason, message) => {
    const h = createHarness();
    vi.mocked(h.writer.setStatus).mockResolvedValue({ outcome: "error", reason });
    await h.actions.toggle({ ...TARGET, completed: true });
    expect(h.writer.setStatus).toHaveBeenCalledWith(TARGET, false, expect.anything());
    expect(h.notify).toHaveBeenCalledWith(message);
    expect(h.actions.getPendingIds()).toEqual([]);
  });

  it("treats a thrown write as write-failed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const h = createHarness();
    vi.mocked(h.writer.setStatus).mockRejectedValue(new Error("disk"));
    await h.actions.toggle({ ...TARGET, completed: false });
    expect(h.notify).toHaveBeenCalledWith(errors.writeFailed);
    expect(h.actions.getPendingIds()).toEqual([]);
  });

  it("drops pending at once for unchanged or moved lines", async () => {
    const h = createHarness();
    vi.mocked(h.writer.setStatus).mockResolvedValueOnce({ outcome: "ok", changed: false, line: 2 });
    await h.actions.toggle({ ...TARGET, completed: false });
    expect(h.actions.getPendingIds()).toEqual([]);
    vi.mocked(h.writer.setStatus).mockResolvedValueOnce({ outcome: "ok", changed: true, line: 5 });
    await h.actions.toggle({ ...TARGET, completed: false });
    expect(h.actions.getPendingIds()).toEqual([]);
  });

  it("ignores malformed payloads, missing writers, and repeat clicks while pending", async () => {
    const h = createHarness();
    const write = deferred<TaskWriteResult>();
    vi.mocked(h.writer.setStatus).mockReturnValue(write.promise);
    await h.actions.toggle({ ...TARGET, completed: "yes" });
    await h.actions.toggle({ ...TARGET, line: -1, completed: false });
    await h.actions.toggle({ filePath: "", line: 2, lineText: "x", completed: false });
    expect(h.writer.setStatus).not.toHaveBeenCalled();
    const first = h.actions.toggle({ ...TARGET, completed: false });
    await h.actions.toggle({ ...TARGET, completed: true });
    expect(h.writer.setStatus).toHaveBeenCalledOnce();
    write.resolve({ outcome: "ok", changed: true, line: 2 });
    await first;

    const none = createHarness({ writer: null });
    await none.actions.toggle({ ...TARGET, completed: false });
    expect(none.publishGroups).not.toHaveBeenCalled();
  });
});

describe("TaskActions date picker", () => {
  const doc = { kind: "doc" };
  const anchor = { ownerDocument: doc };

  it("opens a popover on desktop and a sheet on phones in the anchor document", () => {
    const desktop = createHarness({ device: "desktop" });
    desktop.actions.openDatePicker({ ...TARGET, kind: "due", value: "2026-11-20", anchor });
    expect(picker.open).toHaveBeenCalledWith(expect.objectContaining({
      doc, anchor, layout: "popover", kind: "due", value: "2026-11-20", firstDayOfWeek: 1,
      strings: strings.tasks.datePicker,
    }));
    const phone = createHarness({ device: "phone" });
    phone.actions.openDatePicker({ ...TARGET, kind: "created", value: null, anchor });
    expect(picker.open.mock.calls.at(-1)?.[0]).toMatchObject({ layout: "sheet", kind: "created", value: null });
  });

  it("closes an open picker for the same anchor instead of reopening", () => {
    const h = createHarness();
    picker.close.mockReturnValue(true);
    h.actions.openDatePicker({ ...TARGET, kind: "due", value: null, anchor });
    expect(picker.open).not.toHaveBeenCalled();
  });

  it("ignores invalid date intents", () => {
    const h = createHarness();
    h.actions.openDatePicker({ ...TARGET, kind: "start", value: null, anchor });
    h.actions.openDatePicker({ ...TARGET, kind: "due", value: 5, anchor });
    h.actions.openDatePicker({ ...TARGET, kind: "due", value: null, anchor: null });
    expect(picker.open).not.toHaveBeenCalled();
  });

  it("submits through setDate and keeps the picker open on failure", async () => {
    const h = createHarness();
    h.actions.openDatePicker({ ...TARGET, kind: "due", value: null, anchor });
    const onSubmit = picker.open.mock.calls[0]![0].onSubmit as (value: string | null) => Promise<boolean>;

    vi.mocked(h.writer.setDate).mockResolvedValueOnce({ outcome: "ok", changed: true, line: 2 });
    await expect(onSubmit("2026-11-20")).resolves.toBe(true);
    expect(h.writer.setDate).toHaveBeenCalledWith(TARGET, "due", "2026-11-20");
    expect(h.actions.getPendingIds()).toEqual([ID]);
    h.setVisible([task(false, { due: "2026-11-20" })]);
    expect(h.actions.getPendingIds()).toEqual([]);

    vi.mocked(h.writer.setDate).mockResolvedValueOnce({ outcome: "error", reason: "write-failed" });
    await expect(onSubmit(null)).resolves.toBe(false);
    expect(h.notify).not.toHaveBeenCalled();

    vi.mocked(h.writer.setDate).mockResolvedValueOnce({ outcome: "error", reason: "line-not-found" });
    await expect(onSubmit(null)).resolves.toBe(false);
    expect(h.notify).toHaveBeenCalledWith(errors.lineNotFound);
    expect(h.actions.getPendingIds()).toEqual([]);
  });
});

describe("TaskActions open and context menu", () => {
  it("opens at the task line through a validated link-reference location", () => {
    const h = createHarness();
    h.actions.open(TARGET);
    h.actions.open({ ...TARGET, destination: "new-tab" });
    const [path, destination, location] = h.openNote.mock.calls[0]!;
    expect(path).toBe("notes/a.md");
    expect(destination).toBeUndefined();
    expect(location).toMatchObject({
      kind: "link-reference",
      location: { line: 2, expectedText: TARGET.lineText, identity: "task:notes/a.md:2" },
    });
    expect(location.isCurrent()).toBe(true);
    expect(h.openNote.mock.calls[1]![1]).toBe("new-tab");
    h.actions.dispose();
    expect(location.isCurrent()).toBe(false);
  });

  it("opens the file alone without a line", () => {
    const h = createHarness();
    h.actions.open({ filePath: "notes/a.md" });
    h.actions.open({ filePath: "notes/a.md", destination: "new-tab" });
    h.actions.open({ filePath: 3 });
    expect(h.openNote.mock.calls).toEqual([["notes/a.md", undefined], ["notes/a.md", "new-tab"]]);
  });

  it("shows open, open in new tab and copy text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const h = createHarness();
    h.actions.openContextMenu({ ...TARGET, text: "Ship it", mouseEvent: { clientX: 4, clientY: 9 } });
    const menu = getObsidianMenuInstances().at(-1)!;
    const view = strings.tasks.view;
    expect(menu.items.map((item) => item.title)).toEqual([view.menu.open, view.menu.openInNewTab, view.menu.copyText]);
    expect(menu.positions).toEqual([{ x: 4, y: 9 }]);
    menu.items[1]!.onClick!({} as MouseEvent);
    expect(h.openNote.mock.calls[0]?.[1]).toBe("new-tab");
    menu.items[2]!.onClick!({} as MouseEvent);
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith("Ship it");
    expect(h.notify).toHaveBeenCalledWith(view.copied);
  });

  it("reports a failed copy and positions keyboard menus", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    const h = createHarness();
    h.actions.openContextMenu({ ...TARGET, text: "Ship it", position: { x: 10, y: 20 } });
    const menu = getObsidianMenuInstances().at(-1)!;
    expect(menu.positions).toEqual([{ x: 10, y: 20 }]);
    menu.items[2]!.onClick!({} as MouseEvent);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.notify).toHaveBeenCalledWith(strings.tasks.view.copyFailed);
  });
});
