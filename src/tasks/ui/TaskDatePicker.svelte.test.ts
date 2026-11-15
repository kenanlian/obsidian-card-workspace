import { afterEach, describe, expect, it, vi } from "vitest";
import { installObsidianDomHelpers } from "../../__mocks__/obsidian-dom";
import { taskStrings } from "../../i18n/tasks";
import { closeAllTaskDatePickers, closeTaskDatePickerForAnchor, openTaskDatePicker, type TaskDatePickerOptions } from "./TaskDatePicker";

/** Saturday 14 November 2026, mid-afternoon local time. */
const NOW = new Date(2026, 10, 14, 16, 30);
type Submit = TaskDatePickerOptions["onSubmit"];

function open(extra: Partial<TaskDatePickerOptions> = {}, doc = document) {
  installObsidianDomHelpers(doc);
  const anchor = doc.createElement("button"); doc.body.append(anchor); anchor.focus();
  const onSubmit = vi.fn<Submit>(extra.onSubmit ?? (async () => true));
  const onClose = vi.fn();
  const handle = openTaskDatePicker({
    doc, anchor, layout: "popover", kind: "due", value: "2026-11-20", firstDayOfWeek: 1,
    strings: taskStrings.en.datePicker, now: () => NOW, onClose, ...extra, onSubmit,
  });
  return { handle, root: handle.element, anchor, onSubmit, onClose };
}
const day = (root: HTMLElement, iso: string): HTMLButtonElement => root.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`)!;
const days = (root: HTMLElement): string[] => Array.from(root.querySelectorAll<HTMLButtonElement>("button[data-date]")).map(node => node.dataset.date!);
const weekdays = (root: HTMLElement): string[] => Array.from(root.querySelectorAll(".fce-task-date-picker-weekday")).map(node => node.textContent!);
const title = (root: HTMLElement): string => root.querySelector(".fce-task-date-picker-title")!.textContent!;
function button(root: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(root.querySelectorAll("button")).find(node => node.textContent === label || node.getAttribute("aria-label") === label)!;
}
const key = (target: Element, name: string, init: KeyboardEventInit = {}): void => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, ...init })); };
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
afterEach(() => { closeAllTaskDatePickers(); document.body.replaceChildren(); vi.restoreAllMocks(); });

describe("task date picker", () => {
  it("opens an anchored popover on the selected month with a Monday-first grid", () => {
    const { root } = open();
    expect(root.parentElement).toBe(document.body);
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-label")).toBe("Due date");
    expect(root.classList.contains("is-sheet")).toBe(false);
    expect(root.querySelector(".fce-task-date-picker-kind")!.textContent).toBe("Due date");
    expect(root.querySelector(".fce-task-date-picker-value")!.textContent).toBe("2026-11-20");
    expect(title(root)).toBe("November 2026");
    expect(weekdays(root)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    const all = days(root);
    expect(all).toHaveLength(42);
    expect([all[0], all[41]]).toEqual(["2026-10-26", "2026-12-06"]);
    expect(day(root, "2026-10-26").classList.contains("is-outside")).toBe(true);
    const selected = day(root, "2026-11-20");
    expect(selected.classList.contains("is-selected")).toBe(true);
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.getAttribute("aria-label")).toBe("Friday, November 20, 2026");
    const today = day(root, "2026-11-14");
    expect(today.classList.contains("is-today")).toBe(true);
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(root.querySelectorAll(".is-selected")).toHaveLength(1);
    expect(document.activeElement).toBe(selected);
    expect(selected.tabIndex).toBe(0); expect(today.tabIndex).toBe(-1);
    expect(button(root, "Clear").disabled).toBe(false);
  });

  it("honours a Sunday-first week and localized strings", () => {
    const { root } = open({ firstDayOfWeek: 0, strings: taskStrings.zh.datePicker, kind: "created" });
    expect(weekdays(root)).toEqual(["日", "一", "二", "三", "四", "五", "六"]);
    expect([days(root)[0], days(root)[41]]).toEqual(["2026-11-01", "2026-12-12"]);
    expect(title(root)).toBe("2026年11月");
    expect(root.getAttribute("aria-label")).toBe("创建日期");
    expect(day(root, "2026-11-20").getAttribute("aria-label")).toBe("2026年11月20日 星期五");
  });

  it("opens a bottom sheet on today's month when no value is set", () => {
    const { root } = open({ layout: "sheet", value: null, kind: "done" });
    expect(root.classList.contains("is-sheet")).toBe(true);
    expect(document.activeElement).toBe(root);
    expect(root.querySelector(".fce-task-date-picker-kind")!.textContent).toBe("Completed date");
    const value = root.querySelector(".fce-task-date-picker-value")!;
    expect(value.textContent).toBe("Not set"); expect(value.classList.contains("is-empty")).toBe(true);
    expect(button(root, "Clear").disabled).toBe(true);
    expect(title(root)).toBe("November 2026");
    expect(root.querySelector(".is-selected")).toBeNull();
    expect(day(root, "2026-11-14").tabIndex).toBe(0);
  });

  it("submits presets, picked days and Clear, then closes and restores focus", async () => {
    for (const [label, expected] of [["Today", "2026-11-14"], ["Tomorrow", "2026-11-15"], ["Next Monday", "2026-11-16"]] as const) {
      const { root, onSubmit, onClose, anchor } = open();
      expect(button(root, label).title).toBe(expected);
      button(root, label).click(); await flush();
      expect(onSubmit).toHaveBeenCalledWith(expected);
      expect(root.isConnected).toBe(false); expect(onClose).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(anchor);
    }
    let f = open(); day(f.root, "2026-12-02").click(); await flush();
    expect(f.onSubmit).toHaveBeenCalledWith("2026-12-02"); expect(f.root.isConnected).toBe(false);
    f = open(); button(f.root, "Clear").click(); await flush();
    expect(f.onSubmit).toHaveBeenCalledWith(null); expect(f.root.isConnected).toBe(false);
    f = open({ onSubmit: () => true }); day(f.root, "2026-11-21").click(); await flush();
    expect(f.root.isConnected).toBe(false);
  });

  it("disables controls while pending and keeps the picker open with an error on failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let settle!: (saved: boolean) => void;
    const { root, onSubmit, onClose } = open({ onSubmit: () => new Promise<boolean>(resolve => { settle = resolve; }) });
    const error = root.querySelector<HTMLElement>(".fce-task-date-picker-error")!;
    const tomorrow = button(root, "Tomorrow");
    tomorrow.focus(); tomorrow.click();
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(button(root, "Today").disabled).toBe(true);
    expect(button(root, "Clear").disabled).toBe(true);
    expect(button(root, "Next month").disabled).toBe(true);
    expect(day(root, "2026-11-20").disabled).toBe(true);
    expect(button(root, "Close").disabled).toBe(false);
    button(root, "Today").click(); day(root, "2026-11-21").click();
    expect(onSubmit).toHaveBeenCalledTimes(1);

    settle(false); await flush();
    expect(root.isConnected).toBe(true); expect(onClose).not.toHaveBeenCalled();
    expect(error.hidden).toBe(false); expect(error.textContent).toBe("Could not save the date. Try again.");
    expect(root.hasAttribute("aria-busy")).toBe(false);
    expect(tomorrow.disabled).toBe(false); expect(day(root, "2026-11-20").disabled).toBe(false);
    expect(button(root, "Clear").disabled).toBe(false);
    expect(document.activeElement).toBe(tomorrow);

    onSubmit.mockImplementationOnce(() => Promise.reject(new Error("write failed")));
    button(root, "Clear").click();
    expect(error.hidden).toBe(true);
    await flush();
    expect(root.isConnected).toBe(true); expect(error.hidden).toBe(false);
    expect(console.warn).toHaveBeenCalled();

    onSubmit.mockImplementationOnce(() => { throw new Error("sync failure"); });
    button(root, "Today").click(); await flush();
    expect(root.isConnected).toBe(true); expect(error.hidden).toBe(false);

    onSubmit.mockImplementationOnce(async () => true);
    button(root, "Today").click(); await flush();
    expect(onSubmit).toHaveBeenLastCalledWith("2026-11-14");
    expect(root.isConnected).toBe(false); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape, outside pointer, the close button and a second anchor click", () => {
    let f = open();
    key(f.root, "Escape");
    expect(f.root.isConnected).toBe(false); expect(f.onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(f.anchor);

    f = open();
    f.root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    f.anchor.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(f.root.isConnected).toBe(true);
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(f.root.isConnected).toBe(false); expect(f.onClose).toHaveBeenCalledTimes(1);

    f = open(); button(f.root, "Close").click(); expect(f.root.isConnected).toBe(false);
    f = open(); expect(closeTaskDatePickerForAnchor(f.anchor)).toBe(true); expect(f.root.isConnected).toBe(false);
    expect(closeTaskDatePickerForAnchor(f.anchor)).toBe(false);
  });

  it("closes when its anchor element is removed", async () => {
    const f = open();
    f.anchor.remove(); await flush();
    expect(f.root.isConnected).toBe(false); expect(f.onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps one picker per document and mounts into a pop-out document", () => {
    const first = open(); const second = open();
    expect(first.root.isConnected).toBe(false); expect(first.onClose).toHaveBeenCalledTimes(1);
    expect(second.root.isConnected).toBe(true);
    const frame = document.createElement("iframe"); document.body.append(frame);
    const popout = open({}, frame.contentDocument!);
    expect(popout.root.ownerDocument).toBe(frame.contentDocument);
    expect(popout.root.parentElement).toBe(frame.contentDocument!.body);
    expect(second.root.isConnected).toBe(true);
    frame.contentDocument!.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(popout.root.isConnected).toBe(false); expect(second.root.isConnected).toBe(true);
  });

  it("moves a roving focus with arrow keys across month boundaries and submits with Enter", async () => {
    const { root, onSubmit } = open();
    key(day(root, "2026-11-20"), "ArrowDown");
    expect(document.activeElement).toBe(day(root, "2026-11-27"));
    key(day(root, "2026-11-27"), "ArrowDown");
    expect(title(root)).toBe("December 2026");
    expect(document.activeElement).toBe(day(root, "2026-12-04"));
    expect(day(root, "2026-12-04").tabIndex).toBe(0);
    expect(root.querySelectorAll('button[data-date][tabindex="0"]')).toHaveLength(1);
    key(day(root, "2026-12-04"), "ArrowUp");
    expect(title(root)).toBe("November 2026");
    expect(document.activeElement).toBe(day(root, "2026-11-27"));
    key(day(root, "2026-11-27"), "ArrowRight");
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-28");
    key(day(root, "2026-11-28"), "Home");
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-23");
    key(day(root, "2026-11-23"), "End");
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-11-29");
    key(day(root, "2026-11-29"), "PageDown");
    expect(title(root)).toBe("December 2026");
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2026-12-29");
    key(day(root, "2026-12-29"), "PageUp", { shiftKey: true });
    expect((document.activeElement as HTMLElement).dataset.date).toBe("2025-12-29");
    key(day(root, "2025-12-29"), "ArrowLeft");
    key(day(root, "2025-12-28"), "Enter"); await flush();
    expect(onSubmit).toHaveBeenCalledWith("2025-12-28");
    expect(root.isConnected).toBe(false);
  });

  it("steps months with the header buttons, clamping the focused day", () => {
    const { root } = open({ value: "2026-01-31" });
    button(root, "Next month").click();
    expect(title(root)).toBe("February 2026");
    expect(day(root, "2026-02-28").tabIndex).toBe(0);
    button(root, "Previous month").click(); button(root, "Previous month").click();
    expect(title(root)).toBe("December 2025");
    expect(day(root, "2025-12-28").tabIndex).toBe(0);
  });

  it("positions below a point anchor and flips above when there is no room", () => {
    let { root } = open({ anchor: { x: 100, y: 200 } });
    expect([root.style.left, root.style.top]).toEqual(["100px", "206px"]);
    ({ root } = open({ anchor: { x: 100, y: window.innerHeight - 8 } }));
    expect(root.style.top).toBe(`${window.innerHeight - 14}px`);
    ({ root } = open({ layout: "sheet" }));
    expect(root.style.width).toBe(`${window.innerWidth}px`);
    expect(root.style.maxHeight).toBe(`${Math.round(window.innerHeight * 0.75)}px`);
  });
});
