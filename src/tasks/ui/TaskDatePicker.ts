import { setIcon } from "obsidian";
import type { TaskDatePickerStrings } from "../../i18n/tasks";
import { formatIsoDate, parseIsoDateLocal, resolveDatePreset, type TaskDateKind } from "../task-dates";

export type { TaskDatePickerStrings } from "../../i18n/tasks";

export interface TaskDatePickerOptions {
  readonly doc: Document;
  readonly anchor: HTMLElement | { readonly x: number; readonly y: number };
  /** Phones use a bottom sheet; other devices anchor a popover. */
  readonly layout: "popover" | "sheet";
  readonly kind: TaskDateKind;
  /** Current `YYYY-MM-DD`, or null when unset. */
  readonly value: string | null;
  /** 0 = Sunday … 6 = Saturday. */
  readonly firstDayOfWeek: number;
  readonly strings: TaskDatePickerStrings;
  readonly now?: () => Date;
  /** `true` closes the picker; `false` or a rejection keeps it open with an inline error. */
  readonly onSubmit: (value: string | null) => Promise<boolean> | boolean;
  readonly onClose?: () => void;
}
export interface TaskDatePickerHandle {
  close(): void;
  readonly element: HTMLElement;
}

const byDocument = new WeakMap<Document, TaskDatePicker>();
const sessions = new Set<TaskDatePicker>();
let sequence = 0;

/** Opens the document's only date picker, closing any picker already open there. */
export function openTaskDatePicker(options: TaskDatePickerOptions): TaskDatePickerHandle {
  return new TaskDatePicker(options);
}
/** Clicking the anchor of an open picker closes it instead of reopening. */
export function closeTaskDatePickerForAnchor(anchor: HTMLElement): boolean {
  for (const picker of sessions) if (picker.anchor === anchor) { picker.close(); return true; }
  return false;
}
export function closeAllTaskDatePickers(): void { for (const picker of sessions) picker.close(false); }

const PRESETS = ["today", "tomorrow", "next-monday"] as const;
const DESKTOP_WIDTH = 284;
const WEEKS = 6;
const GAP = 6;
const MARGIN = 12;

const addDays = (date: Date, days: number): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
function addMonths(date: Date, months: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const length = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return new Date(first.getFullYear(), first.getMonth(), Math.min(date.getDate(), length));
}

/** Plugin-owned, document-local, nonmodal picker for one task date. */
class TaskDatePicker implements TaskDatePickerHandle {
  readonly element: HTMLDivElement;
  private readonly doc: Document;
  private readonly strings: TaskDatePickerStrings;
  private readonly firstDay: number;
  private readonly todayIso: string;
  private readonly selectedIso: string | null;
  private readonly restoreTarget: HTMLElement | null;
  private readonly title: HTMLDivElement;
  private readonly weeks: HTMLDivElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly error: HTMLDivElement;
  private readonly cleanup: Array<() => void> = [];
  private viewYear: number;
  private viewMonth: number;
  private focused: Date;
  private pending = false;
  private closed = false;

  constructor(private readonly options: TaskDatePickerOptions) {
    this.doc = options.doc;
    byDocument.get(this.doc)?.close(false);
    byDocument.set(this.doc, this);
    sessions.add(this);
    const view = this.doc.defaultView;
    const active = this.doc.activeElement;
    this.restoreTarget = view && active instanceof view.HTMLElement && active !== this.doc.body ? active : null;
    const s = options.strings;
    this.strings = s;
    this.firstDay = Number.isInteger(options.firstDayOfWeek) && options.firstDayOfWeek >= 0 && options.firstDayOfWeek <= 6 ? options.firstDayOfWeek : 0;
    const now = options.now?.() ?? new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    this.todayIso = formatIsoDate(today);
    const selected = options.value ? parseIsoDateLocal(options.value) : null;
    this.selectedIso = selected ? formatIsoDate(selected) : null;
    this.focused = selected ?? today;
    this.viewYear = this.focused.getFullYear(); this.viewMonth = this.focused.getMonth();
    const kindLabel = s.kinds[options.kind];

    this.element = this.create("div", "fce-task-date-picker");
    this.element.classList.toggle("is-sheet", options.layout === "sheet");
    this.element.classList.toggle("is-above-modal", this.anchorElement?.closest(".modal-container") != null);
    this.element.dataset.kind = options.kind;
    this.element.tabIndex = -1;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", kindLabel);

    const header = this.create("div", "fce-task-date-picker-header", this.element);
    const heading = this.create("div", "fce-task-date-picker-heading", header);
    this.create("div", "fce-task-date-picker-kind", heading).textContent = kindLabel;
    const value = this.create("div", "fce-task-date-picker-value", heading);
    value.textContent = options.value || s.notSet;
    value.classList.toggle("is-empty", !options.value);
    this.clearButton = this.button(s.clear, "fce-task-date-picker-clear", header, () => this.submit(null, this.clearButton));
    const close = this.button("", "clickable-icon fce-task-date-picker-close", header, () => this.close());
    close.setAttribute("aria-label", s.close); setIcon(close, "x");

    const nav = this.create("div", "fce-task-date-picker-nav", this.element);
    this.title = this.create("div", "fce-task-date-picker-title", nav);
    this.title.id = `fce-task-date-picker-title-${++sequence}`;
    this.title.setAttribute("aria-live", "polite");
    const previous = this.button("", "clickable-icon fce-task-date-picker-step", nav, () => this.step(-1));
    previous.setAttribute("aria-label", s.previousMonth); setIcon(previous, "chevron-left");
    const next = this.button("", "clickable-icon fce-task-date-picker-step", nav, () => this.step(1));
    next.setAttribute("aria-label", s.nextMonth); setIcon(next, "chevron-right");

    const grid = this.create("div", "fce-task-date-picker-grid", this.element);
    grid.setAttribute("role", "grid"); grid.setAttribute("aria-labelledby", this.title.id);
    const head = this.create("div", "fce-task-date-picker-week is-weekdays", this.create("div", "fce-task-date-picker-rowgroup", grid));
    head.parentElement!.setAttribute("role", "rowgroup"); head.setAttribute("role", "row");
    for (let column = 0; column < 7; column++) {
      const weekday = (this.firstDay + column) % 7;
      const cell = this.create("div", "fce-task-date-picker-weekday", head);
      cell.setAttribute("role", "columnheader"); cell.setAttribute("aria-label", s.weekdaysLong[weekday]);
      cell.textContent = s.weekdaysShort[weekday];
    }
    this.weeks = this.create("div", "fce-task-date-picker-rowgroup", grid);
    this.weeks.setAttribute("role", "rowgroup");
    this.listen(this.weeks, "click", event => {
      const day = this.dayFrom(event.target);
      if (day?.dataset.date) this.submit(day.dataset.date, day);
    });
    this.listen(this.weeks, "keydown", event => this.gridKey(event as KeyboardEvent));

    const presets = this.create("div", "fce-task-date-picker-presets", this.element);
    presets.setAttribute("role", "group"); presets.setAttribute("aria-label", s.presets);
    const presetLabels = { today: s.today, tomorrow: s.tomorrow, "next-monday": s.nextMonday };
    for (const preset of PRESETS) {
      const date = resolveDatePreset(preset, now);
      const button = this.button(presetLabels[preset], "fce-task-date-picker-preset", presets, () => this.submit(date, button));
      button.dataset.preset = preset; button.title = date;
    }
    this.error = this.create("div", "fce-task-date-picker-error", this.element);
    this.error.setAttribute("role", "alert"); this.error.textContent = s.saveError; this.error.hidden = true;

    this.render();
    this.setControlsDisabled(false);
    this.doc.body.append(this.element);
    this.listen(this.doc, "pointerdown", event => {
      const path = event.composedPath();
      if (!path.includes(this.element) && !(this.anchorElement && path.includes(this.anchorElement))) this.close(false);
    }, true);
    this.listen(this.doc, "keydown", event => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); this.close();
    }, true);
    this.listen(this.doc, "scroll", event => { if (!event.composedPath().includes(this.element)) this.position(); }, true);
    if (view) {
      this.listen(view, "resize", () => this.position());
      if (view.visualViewport) { this.listen(view.visualViewport, "resize", () => this.position()); this.listen(view.visualViewport, "scroll", () => this.position()); }
      this.listen(view, "pagehide", () => this.close(false));
      const anchor = this.anchorElement;
      if (anchor) {
        const observer = new view.MutationObserver(records => {
          if (!anchor.isConnected && records.some(record => !this.element.contains(record.target)) && !this.pending && this.error.hidden) this.close(false);
        });
        observer.observe(this.doc.body, { childList: true, subtree: true });
        this.cleanup.push(() => observer.disconnect());
      }
    }
    this.position();
    if (options.layout === "sheet") this.element.focus({ preventScroll: true });
    else this.focusedButton()?.focus({ preventScroll: true });
  }

  get anchor(): TaskDatePickerOptions["anchor"] { return this.options.anchor; }
  private get anchorElement(): HTMLElement | null { return "getBoundingClientRect" in this.options.anchor ? this.options.anchor : null; }

  private create<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
    // A document-local fragment keeps root elements detached until mounting.
    return (parent ?? this.doc.defaultView!.createFragment()).createEl(tag, { cls });
  }
  private listen(target: EventTarget, type: string, fn: (event: Event) => void, capture = false): void {
    target.addEventListener(type, fn, capture); this.cleanup.push(() => target.removeEventListener(type, fn, capture));
  }
  private button(label: string, cls: string, parent: HTMLElement, click: () => void): HTMLButtonElement {
    const button = this.create("button", cls, parent); button.type = "button"; button.textContent = label;
    this.listen(button, "click", click); return button;
  }

  private render(): void {
    const s = this.strings;
    this.title.textContent = s.monthTitle(this.viewYear, this.viewMonth);
    const first = new Date(this.viewYear, this.viewMonth, 1);
    const start = addDays(first, -((first.getDay() - this.firstDay + 7) % 7));
    const focusedIso = formatIsoDate(this.focused);
    this.weeks.replaceChildren();
    for (let week = 0; week < WEEKS; week++) {
      const row = this.create("div", "fce-task-date-picker-week", this.weeks);
      row.setAttribute("role", "row");
      for (let column = 0; column < 7; column++) {
        const date = addDays(start, week * 7 + column);
        const iso = formatIsoDate(date);
        const selected = iso === this.selectedIso;
        const cell = this.create("div", "fce-task-date-picker-cell", row);
        cell.setAttribute("role", "gridcell"); cell.setAttribute("aria-selected", String(selected));
        const day = this.create("button", "fce-task-date-picker-day", cell);
        day.type = "button"; day.textContent = String(date.getDate()); day.dataset.date = iso;
        day.setAttribute("aria-label", s.dayLabel(date.getFullYear(), date.getMonth(), date.getDate(), date.getDay()));
        day.tabIndex = iso === focusedIso ? 0 : -1;
        day.disabled = this.pending;
        day.classList.toggle("is-outside", date.getMonth() !== this.viewMonth);
        day.classList.toggle("is-selected", selected);
        if (selected) day.setAttribute("aria-pressed", "true");
        if (iso === this.todayIso) { day.classList.add("is-today"); day.setAttribute("aria-current", "date"); }
      }
    }
  }
  private dayFrom(node: EventTarget | null): HTMLButtonElement | null {
    const view = this.doc.defaultView;
    const day = view && node instanceof view.Element ? node.closest<HTMLButtonElement>("button[data-date]") : null;
    return day && this.weeks.contains(day) ? day : null;
  }
  private focusedButton(): HTMLButtonElement | null {
    return this.weeks.querySelector<HTMLButtonElement>(`button[data-date="${formatIsoDate(this.focused)}"]`);
  }
  private step(months: number): void {
    if (this.pending) return;
    this.focused = addMonths(this.focused, months);
    this.viewYear = this.focused.getFullYear(); this.viewMonth = this.focused.getMonth();
    this.render(); this.position();
  }
  private moveFocus(date: Date): void {
    this.focused = date;
    if (date.getFullYear() !== this.viewYear || date.getMonth() !== this.viewMonth) {
      this.viewYear = date.getFullYear(); this.viewMonth = date.getMonth();
      this.render(); this.position();
    } else {
      const iso = formatIsoDate(date);
      for (const day of Array.from(this.weeks.querySelectorAll<HTMLButtonElement>("button[data-date]"))) day.tabIndex = day.dataset.date === iso ? 0 : -1;
    }
    this.focusedButton()?.focus({ preventScroll: true });
  }
  private gridKey(event: KeyboardEvent): void {
    const day = this.dayFrom(event.target);
    if (!day?.dataset.date || this.pending) return;
    const current = parseIsoDateLocal(day.dataset.date);
    if (!current) return;
    if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); this.submit(day.dataset.date, day); return; }
    const column = (current.getDay() - this.firstDay + 7) % 7;
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(current, -1), ArrowRight: () => addDays(current, 1),
      ArrowUp: () => addDays(current, -7), ArrowDown: () => addDays(current, 7),
      Home: () => addDays(current, -column), End: () => addDays(current, 6 - column),
      PageUp: () => addMonths(current, event.shiftKey ? -12 : -1), PageDown: () => addMonths(current, event.shiftKey ? 12 : 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    this.moveFocus(move());
  }

  private submit(value: string | null, trigger: HTMLElement): void {
    if (this.pending || this.closed) return;
    void this.persist(value, trigger);
  }
  private async persist(value: string | null, trigger: HTMLElement): Promise<void> {
    this.pending = true;
    this.error.hidden = true;
    if (this.element.contains(this.doc.activeElement)) this.element.focus({ preventScroll: true });
    this.setControlsDisabled(true);
    let saved = false;
    try { saved = (await this.options.onSubmit(value)) === true; }
    catch (error) { console.warn("Card Workspace: task date save failed", error); }
    if (this.closed) return;
    this.pending = false;
    this.setControlsDisabled(false);
    if (saved) { this.close(); return; }
    this.error.hidden = false;
    this.position();
    (trigger.isConnected && !(trigger as HTMLButtonElement).disabled ? trigger : this.focusedButton())?.focus({ preventScroll: true });
  }
  private setControlsDisabled(disabled: boolean): void {
    this.element.classList.toggle("is-pending", disabled);
    if (disabled) this.element.setAttribute("aria-busy", "true"); else this.element.removeAttribute("aria-busy");
    for (const button of Array.from(this.element.querySelectorAll<HTMLButtonElement>("button"))) {
      if (button.classList.contains("fce-task-date-picker-close")) continue;
      button.disabled = disabled || (button === this.clearButton && !this.options.value);
    }
  }

  private position(): void {
    const win = this.doc.defaultView;
    if (!win || this.closed) return;
    const viewport = win.visualViewport;
    const style = win.getComputedStyle(this.element);
    const inset = (side: string): number => Number.parseFloat(style.getPropertyValue(`--fce-task-date-picker-safe-${side}`)) || 0;
    const left = (viewport?.offsetLeft ?? 0) + inset("left"), top = (viewport?.offsetTop ?? 0) + inset("top");
    const width = (viewport?.width ?? win.innerWidth) - inset("left") - inset("right");
    const height = (viewport?.height ?? win.innerHeight) - inset("top") - inset("bottom");
    if (this.options.layout === "sheet") {
      this.element.style.width = `${Math.max(0, width)}px`;
      this.element.style.maxHeight = `${Math.max(0, Math.round(height * 0.75))}px`;
      this.element.style.left = `${left}px`;
      this.element.style.top = `${top + height - this.element.getBoundingClientRect().height}px`;
      return;
    }
    const anchor = this.anchorElement;
    if (anchor && !anchor.isConnected) return;
    const point = "getBoundingClientRect" in this.options.anchor ? null : this.options.anchor;
    const rect = anchor ? anchor.getBoundingClientRect() : { left: point!.x, top: point!.y, bottom: point!.y };
    this.element.style.width = `${Math.max(0, Math.min(DESKTOP_WIDTH, width - MARGIN * 2))}px`;
    this.element.style.maxHeight = `${Math.max(0, height - MARGIN * 2)}px`;
    const pickerHeight = this.element.getBoundingClientRect().height;
    const below = rect.bottom + GAP, above = rect.top - GAP - pickerHeight;
    // Flip above the anchor rather than covering it when there is no room below.
    const y = below + pickerHeight > top + height - MARGIN && above >= top + MARGIN ? above : below;
    this.element.style.left = `${Math.max(left + MARGIN, Math.min(rect.left, left + width - this.element.offsetWidth - MARGIN))}px`;
    this.element.style.top = `${Math.max(top + MARGIN, Math.min(y, top + height - pickerHeight - MARGIN))}px`;
  }

  close(restoreFocus = true): void {
    if (this.closed) return;
    this.closed = true;
    this.cleanup.splice(0).forEach(cleanup => cleanup());
    this.element.remove();
    sessions.delete(this);
    if (byDocument.get(this.doc) === this) byDocument.delete(this.doc);
    if (restoreFocus) {
      const anchor = this.anchorElement;
      const target = this.restoreTarget?.isConnected ? this.restoreTarget : anchor?.isConnected ? anchor : null;
      target?.focus({ preventScroll: true });
    }
    this.options.onClose?.();
  }
}
