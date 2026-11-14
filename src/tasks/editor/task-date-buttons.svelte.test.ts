import type { TaskDateColors } from "../../task-view-settings";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Compartment, EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorLivePreviewField } from "obsidian";
import { getUiStrings } from "../../i18n";
import type { TaskDatePickerOptions } from "../ui/TaskDatePicker";
import { createTaskDateButtons, TASK_LINE_ACTIVE_CLASS, type TaskDateButtonsMode, type TaskDateButtonStyle } from "./task-date-buttons";

const picker = vi.hoisted(() => ({
  open: vi.fn(),
  closeForAnchor: vi.fn((_anchor: HTMLElement) => false),
}));
vi.mock("../ui/TaskDatePicker", () => ({
  openTaskDatePicker: picker.open,
  closeTaskDatePickerForAnchor: picker.closeForAnchor,
  closeAllTaskDatePickers: vi.fn(),
}));

const DONE = "\u2705";
const DUE = "\u{1F4C5}";
const DOC = [
  "- [ ] plain",
  `- [x] finished ${DONE} 2026-11-10 ${DUE} 2026-11-01`,
  "```",
  "- [ ] code task",
  "```",
  `- [ ] late ${DUE} 2026-11-01`,
].join("\n");

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

function mount(doc = DOC, mode: TaskDateButtonsMode = "compact", livePreview = true, look: { style?: TaskDateButtonStyle; showDates?: boolean; colors?: TaskDateColors } = {}) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const preview = new Compartment();
  const transactions: Transaction[] = [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        preview.of(livePreview ? editorLivePreviewField.init(() => true) : []),
        createTaskDateButtons({
          colors: look.colors, mode, style: look.style ?? "chips", showDates: look.showDates ?? false, layout: "popover", getStrings: () => getUiStrings("en").tasks, firstDayOfWeek: () => 1, today: () => "2026-11-14",
        }),
        EditorView.updateListener.of((update) => { transactions.push(...update.transactions); }),
      ],
    }),
  });
  cleanups.push(() => view.destroy());
  const groups = () => Array.from(view.dom.querySelectorAll<HTMLElement>(".fce-task-date-buttons"));
  const button = (group: number, kind: string) => groups()[group]!.querySelector<HTMLElement>(`[data-kind="${kind}"]`)!;
  const setPreview = (on: boolean) => view.dispatch({ effects: preview.reconfigure(on ? editorLivePreviewField.init(() => true) : []) });
  return { view, groups, button, transactions, setPreview };
}

function lastPickerOptions(): TaskDatePickerOptions {
  return picker.open.mock.calls[picker.open.mock.calls.length - 1]![0] as TaskDatePickerOptions;
}

describe("task date buttons", () => {
  it.each(["chips", "dots"] as const)("applies configured colors in %s style", style => {
    const { groups } = mount(DOC, "full", true, { style, colors: { created: "pink", done: "cyan", due: "yellow", overdue: "purple" } });
    for (const group of groups()) {
      expect(group.style.getPropertyValue("--fce-task-created-color")).toBe("var(--color-pink)");
      expect(group.style.getPropertyValue("--fce-task-overdue-color")).toBe("var(--color-purple)");
    }
  });

  it("renders three buttons at the end of task lines outside code blocks", () => {
    const { view, groups } = mount();
    expect(groups()).toHaveLength(3);
    const lines = Array.from(view.contentDOM.querySelectorAll(".cm-line"));
    expect(lines[0]!.querySelector(".fce-task-date-buttons")).not.toBeNull();
    expect(lines[3]!.querySelector(".fce-task-date-buttons")).toBeNull();
    for (const group of groups()) {
      expect(Array.from(group.children).map((child) => (child as HTMLElement).dataset.kind)).toEqual(["created", "done", "due"]);
      expect(group.classList.contains("is-compact")).toBe(true);
    }
  });

  it("marks set and unset dates with labels and flags open overdue tasks", () => {
    const { button } = mount();
    expect(button(0, "created").className).toContain("is-unset");
    expect(button(0, "created").getAttribute("aria-label")).toBe("Created date: Not set");
    expect(button(1, "done").className).toContain("is-set");
    expect(button(1, "done").getAttribute("aria-label")).toBe("Completed date: 2026-11-10");
    expect(button(1, "due").classList.contains("is-overdue")).toBe(false);
    expect(button(2, "due").classList.contains("is-overdue")).toBe(true);
  });

  it("renders chips with the task-card icons, flags due today, and shows dates only while date text is hidden", () => {
    const doc = [`- [ ] today ${DUE} 2026-11-14`, `- [x] old ${DONE} 2025-03-02`].join("\n");
    const plain = mount(doc);
    expect(plain.groups()[0]!.classList.contains("is-chips")).toBe(true);
    const icons = Array.from(plain.groups()[0]!.querySelectorAll<HTMLElement>(".fce-task-date-button-icon")).map((icon) => icon.dataset.icon);
    expect(icons).toEqual(["plus", "check", "calendar"]);
    expect(plain.button(0, "due").classList.contains("is-due-today")).toBe(true);
    expect(plain.button(0, "due").classList.contains("is-overdue")).toBe(false);
    expect(plain.view.dom.querySelector(".fce-task-date-button-label")).toBeNull();

    const hidden = mount(doc, "compact", true, { showDates: true });
    expect(hidden.button(0, "due").querySelector(".fce-task-date-button-label")?.textContent).toBe("Nov 14");
    expect(hidden.button(0, "due").classList.contains("has-date")).toBe(true);
    expect(hidden.button(1, "done").querySelector(".fce-task-date-button-label")?.textContent).toBe("Mar 2, 2025");
    expect(hidden.button(0, "created").querySelector(".fce-task-date-button-label")).toBeNull();
    // A completed task has no due urgency.
    const done = mount(`- [x] shipped ${DUE} 2026-11-01`);
    expect(done.button(0, "due").className).not.toMatch(/is-overdue|is-due-today/);
  });

  it("keeps plain dots without icons or dates in dots style", () => {
    const { groups, view } = mount(DOC, "full", true, { style: "dots", showDates: true });
    expect(groups()[0]!.classList.contains("is-dots")).toBe(true);
    expect(view.dom.querySelector(".fce-task-date-button-icon, .fce-task-date-button-label")).toBeNull();
  });

  it("only renders in Live Preview and follows mode toggles", () => {
    const source = mount(DOC, "full", false);
    expect(source.groups()).toHaveLength(0);
    source.setPreview(true);
    expect(source.groups()).toHaveLength(3);
    expect(source.groups()[0]!.classList.contains("is-full")).toBe(true);
    source.setPreview(false);
    expect(source.groups()).toHaveLength(0);
  });

  it("marks only the task line holding the caret as active", () => {
    const { view } = mount();
    const activeLines = () => Array.from(view.contentDOM.querySelectorAll(`.${TASK_LINE_ACTIVE_CLASS}`)).map((line) => line.textContent);
    expect(activeLines()).toEqual(["- [ ] plain"]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(6).from + 3) });
    expect(activeLines()).toEqual([`- [ ] late ${DUE} 2026-11-01`]);
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(4).from) });
    expect(activeLines()).toEqual([]);
  });

  it("keeps unchanged widgets when other lines change", () => {
    const { view, groups } = mount();
    const first = groups()[0];
    view.dispatch({ changes: { from: view.state.doc.line(6).to, insert: "!" } });
    expect(groups()[0]).toBe(first);
  });

  it("prevents caret moves on mousedown and opens the picker on click or keyboard", () => {
    const { view, button } = mount();
    const before = view.state.selection;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    button(1, "due").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(view.state.selection.eq(before)).toBe(true);

    button(1, "due").click();
    expect(picker.open).toHaveBeenCalledOnce();
    expect(lastPickerOptions()).toMatchObject({ doc: document, anchor: button(1, "due"), layout: "popover", kind: "due", value: "2026-11-01", firstDayOfWeek: 1 });
    expect(lastPickerOptions().strings).toBe(getUiStrings("en").tasks.datePicker);

    button(0, "created").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(lastPickerOptions()).toMatchObject({ kind: "created", value: null });
    expect(view.state.selection.eq(before)).toBe(true);
  });

  it("toggles an open picker closed instead of reopening it", () => {
    const { button } = mount();
    picker.closeForAnchor.mockReturnValueOnce(true);
    button(0, "due").click();
    expect(picker.open).not.toHaveBeenCalled();
  });

  it("writes the chosen date as one undoable task-date transaction", async () => {
    const { view, button, transactions } = mount();
    button(0, "due").click();
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(true);
    expect(view.state.doc.line(1).text).toBe(`- [ ] plain ${DUE} 2026-12-01`);
    const write = transactions.filter((tr) => tr.docChanged);
    expect(write).toHaveLength(1);
    expect(write[0]!.isUserEvent("input.task-date")).toBe(true);
    expect(write[0]!.annotation(Transaction.addToHistory)).not.toBe(false);
    expect(write[0]!.changes.invert(write[0]!.startState.doc).apply(view.state.doc).toString()).toBe(DOC);
  });

  it("clears a date and follows the line through edits made while the picker is open", async () => {
    const { view, button } = mount();
    button(1, "done").click();
    view.dispatch({ changes: { from: 0, insert: "intro\n\n" } });
    expect(await lastPickerOptions().onSubmit(null)).toBe(true);
    expect(view.state.doc.line(4).text).toBe(`- [x] finished ${DUE} 2026-11-01`);
  });

  it("asks the picker to retry when the task line is gone", async () => {
    const { view, button } = mount();
    button(0, "due").click();
    view.dispatch({ changes: { from: 0, to: view.state.doc.line(2).from, insert: "" } });
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(false);
    button(0, "created").click();
    view.dispatch({ changes: { from: 2, to: 5, insert: "" } });
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(false);
    const split = mount("- [ ] a b");
    split.button(0, "created").click();
    split.view.dispatch({ changes: { from: 8, insert: "\n" } });
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(false);
  });

  it("still writes to a task whose line was indented or joined with the next line", async () => {
    const { view, button } = mount("- [ ] a\nmore");
    button(0, "due").click();
    view.dispatch({ changes: [{ from: 0, insert: "  " }, { from: 7, to: 8, insert: " " }] });
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(true);
    expect(view.state.doc.toString()).toBe(`  - [ ] a more ${DUE} 2026-12-01`);
  });

  it("rejects submissions after the picker closed or the view was destroyed", async () => {
    const { view, button } = mount();
    button(0, "due").click();
    lastPickerOptions().onClose?.();
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(false);
    button(0, "due").click();
    view.destroy();
    expect(await lastPickerOptions().onSubmit("2026-12-01")).toBe(false);
    expect(picker.closeForAnchor).toHaveBeenCalled();
  });
});
