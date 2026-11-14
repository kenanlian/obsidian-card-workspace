import { afterEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { tick } from "svelte";
import TaskCardItem from "./TaskCardItem.svelte";
import { getUiStrings } from "../i18n";
import type { TaskCardDates, TaskCardItem as TaskItem, TaskCardRecord } from "./types";

const TODAY = "2026-11-14";
const en = getUiStrings("en");
const view = en.tasks.view;

function dates(partial: Partial<TaskCardDates> = {}): TaskCardDates {
  return { created: null, done: null, due: null, ...partial };
}

function item(line: number, text: string, extra: Partial<TaskItem> = {}): TaskItem {
  return {
    line,
    lineText: `- [ ] ${text}`,
    text,
    completed: false,
    statusChar: " ",
    dates: dates(),
    children: [],
    ...extra,
  };
}

function record(extra: Partial<TaskItem> = {}): TaskCardRecord {
  const root = item(3, "Write the report", extra);
  return {
    ...root,
    kind: "task",
    path: "notes/Plan.md::L3",
    filePath: "notes/Plan.md",
    file: { path: "notes/Plan.md" } as TaskCardRecord["file"],
    fileTitle: "Plan",
    fileOrder: 0,
  };
}

let mounted: Array<Record<string, unknown>> = [];

function render(props: Record<string, unknown>): { target: HTMLElement; component: Record<string, unknown> } {
  const target = document.createElement("div");
  target.className = "folder-card-view";
  document.body.appendChild(target);
  const component = mount(TaskCardItem, { target, props: { today: TODAY, strings: en, ...props } as never });
  mounted.push(component);
  flushSync();
  return { target, component };
}

function rows(target: HTMLElement): HTMLElement[] {
  return Array.from(target.querySelectorAll<HTMLElement>(".fce-task-row"));
}

function chips(row: HTMLElement): HTMLButtonElement[] {
  return Array.from(row.querySelectorAll<HTMLButtonElement>(":scope > .fce-task-main > .fce-task-chips > .fce-task-chip"));
}

afterEach(async () => {
  await Promise.all(mounted.map((component) => unmount(component)));
  mounted = [];
  document.body.innerHTML = "";
});

describe("TaskCardItem.svelte", () => {
  it("renders plain task text without HTML or Markdown syntax", () => {
    const { target } = render({ task: record({ text: "<b>raw</b> **bold** [[Notes/Ref|alias]] `code`" }) });
    const text = target.querySelector(".fce-task-text")!;
    expect(text.textContent).toBe("<b>raw</b> bold alias code");
    expect(text.querySelector("b")).toBeNull();
    expect(target.querySelector(".fce-card.fce-task-card")?.getAttribute("data-task-id")).toBe("notes/Plan.md::L3");
  });

  it("highlights the committed search query", () => {
    const { target } = render({ task: record(), searchQuery: "report" });
    expect(target.querySelector(".fce-task-text mark.fce-search-hit")?.textContent).toBe("report");
  });

  it("emits a toggle intent with the state the user saw", () => {
    const onTaskToggle = vi.fn();
    render({ task: record(), onTaskToggle });
    const check = document.querySelector<HTMLButtonElement>(".fce-task-check")!;
    expect(check.getAttribute("role")).toBe("checkbox");
    expect(check.getAttribute("aria-checked")).toBe("false");
    expect(check.getAttribute("aria-label")).toBe(view.checkboxLabel("Write the report"));
    check.click();
    expect(onTaskToggle).toHaveBeenCalledWith({
      id: "notes/Plan.md::L3", filePath: "notes/Plan.md", line: 3, lineText: "- [ ] Write the report", completed: false,
    });
  });

  it("drops the optimistic state when the host does not mark the id pending", () => {
    const { target } = render({ task: record(), onTaskToggle: vi.fn() });
    const check = target.querySelector<HTMLButtonElement>(".fce-task-check")!;
    check.click();
    flushSync();
    expect(check.getAttribute("aria-checked")).toBe("false");
  });

  it("marks pending rows busy and ignores further clicks", () => {
    const onTaskToggle = vi.fn();
    const onTaskDate = vi.fn();
    const { target } = render({ task: record(), pendingIds: new Set(["notes/Plan.md::L3"]), onTaskToggle, onTaskDate });
    const row = rows(target)[0]!;
    expect(row.classList.contains("is-pending")).toBe(true);
    expect(row.getAttribute("aria-busy")).toBe("true");
    row.querySelector<HTMLButtonElement>(".fce-task-check")!.click();
    chips(row)[0]!.click();
    expect(onTaskToggle).not.toHaveBeenCalled();
    expect(onTaskDate).not.toHaveBeenCalled();
    expect(target.querySelector(".fce-task-card")?.classList.contains("is-pending")).toBe(true);
  });

  it("renders created, done and due chips with short dates, hollow unset chips, and full labels", () => {
    const { target } = render({ task: record({ dates: dates({ created: "2026-11-02", due: "2027-01-05" }) }) });
    const [created, done, due] = chips(rows(target)[0]!);
    expect([created, done, due].map((chip) => chip!.dataset.kind)).toEqual(["created", "done", "due"]);
    expect(created!.classList.contains("is-set")).toBe(true);
    expect(created!.querySelector(".fce-task-chip-label")?.textContent).toBe(view.chipDate(2026, 10, 2, false));
    expect(created!.getAttribute("aria-label")).toBe(view.chipLabel(en.tasks.datePicker.kinds.created, view.fullDate(2026, 10, 2)));
    expect(created!.querySelector(".fce-task-chip-icon")?.getAttribute("data-icon")).toBe("calendar-plus");
    expect(done!.classList.contains("is-unset")).toBe(true);
    expect(done!.querySelector(".fce-task-chip-label")).toBeNull();
    expect(done!.getAttribute("aria-label")).toBe(view.chipLabel(en.tasks.datePicker.kinds.done, en.tasks.datePicker.notSet));
    expect(done!.getAttribute("data-tooltip")).toBe(done!.getAttribute("aria-label"));
    // A different year is shown so the short date stays unambiguous.
    expect(due!.querySelector(".fce-task-chip-label")?.textContent).toBe(view.chipDate(2027, 0, 5, true));
    expect(due!.classList.contains("is-overdue")).toBe(false);
  });

  it("flags overdue and due-today chips only for open tasks", () => {
    const { target } = render({
      task: record({
        dates: dates({ due: "2026-11-10" }),
        children: [
          item(4, "today", { dates: dates({ due: TODAY }) }),
          item(5, "closed", { completed: true, statusChar: "x", dates: dates({ due: "2026-11-01" }) }),
        ],
      }),
    });
    const [root, today, closed] = rows(target).map((row) => chips(row)[2]!);
    expect(root.classList.contains("is-overdue")).toBe(true);
    expect(root.getAttribute("aria-label")).toContain(view.dueOverdue);
    expect(today.classList.contains("is-due-today")).toBe(true);
    expect(today.getAttribute("aria-label")).toContain(view.dueToday);
    expect(closed.classList.contains("is-overdue")).toBe(false);
  });

  it("emits a date intent anchored on the chip", () => {
    const onTaskDate = vi.fn();
    const { target } = render({ task: record({ dates: dates({ due: "2026-11-20" }) }), onTaskDate });
    const due = chips(rows(target)[0]!)[2]!;
    due.click();
    expect(onTaskDate).toHaveBeenCalledWith({
      id: "notes/Plan.md::L3", filePath: "notes/Plan.md", line: 3, lineText: "- [ ] Write the report",
      kind: "due", value: "2026-11-20", anchor: due,
    });
  });

  it("nests subtasks with their own checkbox and chips", () => {
    const onTaskToggle = vi.fn();
    const { target } = render({
      task: record({
        children: [
          item(4, "Outline", { completed: true, statusChar: "x", children: [item(5, "Sources")] }),
          item(6, "Draft"),
        ],
      }),
      onTaskToggle,
    });
    const all = rows(target);
    expect(all).toHaveLength(4);
    expect(all.slice(1).every((row) => row.classList.contains("is-subtask"))).toBe(true);
    expect(target.querySelectorAll(".fce-task-children .fce-task-children .fce-task-row")).toHaveLength(1);
    expect(all[1]!.classList.contains("is-completed")).toBe(true);
    expect(all[1]!.querySelector(".fce-task-check")?.getAttribute("aria-checked")).toBe("true");
    expect(chips(all[3]!)).toHaveLength(3);
    all[2]!.querySelector<HTMLButtonElement>(".fce-task-check")!.click();
    expect(onTaskToggle).toHaveBeenCalledWith(expect.objectContaining({ line: 5, lineText: "- [ ] Sources", completed: false }));
    expect(target.querySelector(".fce-task-progress")?.getAttribute("aria-label")).toBe(view.subtaskProgress(1, 3));
  });

  it("opens the task line by click, keyboard, modifier click and middle click", () => {
    const onTaskOpen = vi.fn();
    const { target } = render({ task: record(), onTaskOpen });
    const text = target.querySelector<HTMLElement>(".fce-task-text")!;
    const at = { filePath: "notes/Plan.md", line: 3, lineText: "- [ ] Write the report" };
    text.click();
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    text.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    text.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onTaskOpen.mock.calls.map(([payload]) => payload)).toEqual([
      at, at, { ...at, destination: "new-tab" }, { ...at, destination: "new-tab" },
    ]);
  });

  it("opens the file from the footer without a line", () => {
    const onTaskOpen = vi.fn();
    const { target } = render({ task: record(), onTaskOpen });
    const file = target.querySelector<HTMLButtonElement>(".fce-task-file")!;
    expect(file.textContent).toContain("Plan");
    expect(file.getAttribute("aria-label")).toBe(view.openFile("Plan"));
    file.click();
    expect(onTaskOpen).toHaveBeenCalledWith({ filePath: "notes/Plan.md" });
  });

  it("emits context menu intents from pointer and keyboard", () => {
    const onTaskContextMenu = vi.fn();
    const { target } = render({ task: record(), onTaskContextMenu });
    const text = target.querySelector<HTMLElement>(".fce-task-text")!;
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 6 });
    text.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    text.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
    expect(onTaskContextMenu.mock.calls[0]?.[0]).toMatchObject({
      filePath: "notes/Plan.md", line: 3, text: "Write the report", mouseEvent: event,
    });
    expect(onTaskContextMenu.mock.calls[1]?.[0]).toMatchObject({ line: 3, position: { x: 0, y: 0 } });
  });

  it("formats chip dates in the UI language", () => {
    const zh = getUiStrings("zh");
    const { target } = render({ task: record({ dates: dates({ due: "2026-11-20" }) }), strings: zh });
    const due = chips(rows(target)[0]!)[2]!;
    expect(due.querySelector(".fce-task-chip-label")?.textContent).toBe(zh.tasks.view.chipDate(2026, 10, 20, false));
    expect(due.querySelector(".fce-task-chip-label")?.textContent).toBe("11月20日");
  });

  it("marks touch cards so every date chip stays reachable", async () => {
    const { target } = render({ task: record({ children: [item(4, "Sub")] }), touch: true });
    await tick();
    expect(target.querySelector(".fce-task-card")?.classList.contains("is-touch")).toBe(true);
  });
});
