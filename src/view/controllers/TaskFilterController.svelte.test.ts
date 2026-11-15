import { Menu } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "../../__mocks__/obsidian-dom";
import { getObsidianMenuInstances, resetObsidianMenuInstances } from "../../__mocks__/obsidian";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS } from "../../settings";
import { createViewStateStore } from "../view-state-store";
import { createFolderScope } from "../scope";
import type { ViewContext } from "../view-context";
import { TaskFilterController } from "./TaskFilterController";
import type { TaskCardRecord } from "../types";
import { closeAllTaskDatePickers } from "../../tasks/ui/TaskDatePicker";

const controllers: TaskFilterController[] = [];
function setup(phone = false) {
  installObsidianDomHelpers(document); resetObsidianMenuInstances();
  const store = createViewStateStore(createFolderScope("", true));
  const settings = { ...DEFAULT_SETTINGS };
  const refresh = vi.fn(), saveSettings = vi.fn(async () => {}), notify = vi.fn();
  const pending = vi.fn(() => false);
  const context = { store, getSettings: () => settings, getUiStrings: () => getUiStrings("en"),
    getApp: () => ({}), saveSettings, notify, runtimePlatform: { device: phone ? "phone" : "desktop" } } as unknown as ViewContext;
  const child = { line: 1, lineText: "  - [ ] child", text: "child", completed: false, statusChar: " ", dates: { created: null, done: null, due: null }, children: [] };
  const task = { ...child, line: 0, lineText: "- [ ] parent", text: "parent", file: {} as never, fileOrder: 0, fileTitle: "a", path: "a.md::L0", kind: "task", filePath: "a.md", children: [child] } as TaskCardRecord;
  const tools = new TaskFilterController(context, { refresh, groups: () => [{ key: "g", label: "Group", tasks: [task] }], canCopy: () => true, pending });
  controllers.push(tools);
  const anchor = document.createElement("button"); document.body.append(anchor);
  return { tools, store, refresh, saveSettings, anchor, notify, settings, pending };
}
function select(index: number, value: string) { const input = document.querySelectorAll("select")[index]!; input.value = value; input.dispatchEvent(new Event("change")); }
function click(label: string) { Array.from(document.querySelectorAll("button")).find(button => button.textContent === label)!.click(); }
afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); closeAllTaskDatePickers(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe("task date filtering interaction", () => {
  it("keeps changes in a draft until Apply, and cancels without changing results", async () => {
    const h = setup(); h.tools.openDates(h.anchor); select(1, "previous-report");
    expect(h.store.getTaskFilters().date).toBeNull(); click("Cancel"); expect(h.refresh).not.toHaveBeenCalled();
    h.tools.openDates(h.anchor); select(1, "previous-report"); click("Apply"); await Promise.resolve();
    expect(h.store.getTaskFilters().date).toMatchObject({ field: "done", preset: "previous-report", weekEnd: 4 });
    expect(h.refresh).toHaveBeenCalledOnce(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it("validates custom dates, restores focus on Escape and uses the phone sheet", async () => {
    const h = setup(true); h.tools.openDates(h.anchor); select(1, "custom");
    expect(document.querySelector(".is-sheet")).not.toBeNull();
    document.querySelector<HTMLButtonElement>('.fce-task-filter-date[aria-label="Start date"]')!.click();
    expect(document.querySelector(".fce-task-date-picker.is-sheet")).not.toBeNull();
    const clear = document.querySelector<HTMLButtonElement>(".fce-task-date-picker-clear")!;
    clear.dispatchEvent(new Event("pointerdown", { bubbles: true })); clear.click();
    await vi.waitFor(() => expect(document.querySelector(".fce-task-date-picker")).toBeNull());
    expect(document.querySelector(".fce-task-filter-panel")).not.toBeNull();
    expect(Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Apply")?.disabled).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.activeElement).toBe(h.anchor);
  });
  it("selects inclusive boundaries in the shared calendar, applying only a valid draft", async () => {
    const h = setup();
    const active = { field: "done" as const, preset: "custom" as const, start: "2026-11-10", end: "2026-11-20", weekEnd: 4 };
    h.store.setTaskFilters({ status: "incomplete", date: active }); h.tools.openDates(h.anchor);
    expect(document.querySelector('input[type="date"]')).toBeNull();
    const pick = async (label: string, date: string) => {
      document.querySelector<HTMLButtonElement>(`.fce-task-filter-date[aria-label="${label}"]`)!.click();
      const day = document.querySelector<HTMLButtonElement>(`.fce-task-date-picker button[data-date="${date}"]`)!;
      day.dispatchEvent(new Event("pointerdown", { bubbles: true })); day.click();
      await vi.waitFor(() => expect(document.querySelector(".fce-task-date-picker")).toBeNull());
    };
    await pick("Start date", "2026-11-25");
    expect(h.store.getTaskFilters().date).toEqual(active); expect(h.refresh).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("start on or before");
    await pick("End date", "2026-11-30");
    click("Apply"); await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
    expect(h.store.getTaskFilters()).toEqual({ status: "incomplete", date: { ...active, start: "2026-11-25", end: "2026-11-30" } });
  });
  it("closes only the inner calendar on Escape and discards its selected dates on Cancel", async () => {
    const h = setup(); h.tools.openDates(h.anchor); select(1, "custom");
    const start = document.querySelector<HTMLButtonElement>('.fce-task-filter-date[aria-label="Start date"]')!;
    start.click();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".fce-task-date-picker")).toBeNull();
    expect(document.querySelector(".fce-task-filter-panel")).not.toBeNull(); expect(document.activeElement).toBe(start);
    start.click(); document.querySelector<HTMLButtonElement>('.fce-task-date-picker-preset[data-preset="today"]')!.click();
    await vi.waitFor(() => expect(document.querySelector(".fce-task-date-picker")).toBeNull());
    click("Cancel"); expect(h.store.getTaskFilters().date).toBeNull(); expect(h.refresh).not.toHaveBeenCalled();
  });
  it("closes the parent and child on outside clicks, mode changes and disposal", () => {
    const h = setup();
    for (const close of [() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })), () => h.tools.close(), () => h.tools.dispose()]) {
      h.tools.openDates(h.anchor); select(1, "custom");
      document.querySelector<HTMLButtonElement>(".fce-task-filter-date")!.click();
      close(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
  });
  it("retains the draft and permits retry after a reporting preference save fails", async () => {
    const h = setup(); h.saveSettings.mockImplementationOnce(async () => { h.settings.taskReportWeekEndDay = 2; throw new Error("disk"); }); h.tools.openDates(h.anchor); select(1, "report"); select(2, "2"); click("Apply");
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save"));
    expect(h.store.getTaskFilters().date).toBeNull(); click("Apply");
    await vi.waitFor(() => expect(h.store.getTaskFilters().date?.weekEnd).toBe(2));
  });
  it("copies a group with its matched descendants", async () => {
    const h = setup(); const writeText = vi.fn(async () => {}); vi.stubGlobal("navigator", { clipboard: { writeText } });
    h.tools.openCopy(h.anchor, "g");
    const menu = getObsidianMenuInstances().at(-1)!;
    menu.items[1]!.onClick?.(new MouseEvent("click"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Group\n- parent\n  - child"));
  });
  it("offers identical group formats from More and the context-menu position", () => {
    const h = setup(); h.tools.openGroupMenu(h.anchor, "g");
    const more = getObsidianMenuInstances().at(-1)!;
    h.tools.openGroupMenu(h.anchor, "g", { x: 120, y: 90 });
    const context = getObsidianMenuInstances().at(-1)!;
    expect(context.items.map(item => item.title)).toEqual(more.items.map(item => item.title));
    expect(context.items.map(item => item.title)).toEqual(Object.values(getUiStrings("en").tasks.tools.formats));
    expect(context.positions).toEqual([{ x: 120, y: 90 }]);
  });
  it("copies a selected parent with children and disables copying while a child write is pending", async () => {
    const h = setup(); const writeText = vi.fn(async () => {}); vi.stubGlobal("navigator", { clipboard: { writeText } });
    const menu = new Menu(); h.tools.appendCopyMenu(menu, { task: { filePath: "a.md", line: 0 } });
    const item = getObsidianMenuInstances().at(-1)!.items[0]!; item.onClick?.(new MouseEvent("click"));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("parent\n  child"));
    h.pending.mockReturnValue(true); h.tools.openCopy(h.anchor);
    expect(getObsidianMenuInstances().at(-1)!.items.every(item => item.disabled)).toBe(true);
  });
  it("keeps view filters independent and retains them across source changes", () => {
    const a = setup(), b = setup(); a.store.setTaskFilters({ status: "incomplete", date: null });
    a.store.setScope(createFolderScope("Other", true));
    expect(a.store.getTaskFilters().status).toBe("incomplete"); expect(b.store.getTaskFilters().status).toBe("all");
  });

});
