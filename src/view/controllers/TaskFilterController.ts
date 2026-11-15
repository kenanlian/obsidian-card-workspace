import { Menu, Modal, setIcon } from "obsidian";
import { formatIsoDate, type TaskDateKind } from "../../tasks";
import { openTaskDatePicker, type TaskDatePickerHandle } from "../../tasks/ui/TaskDatePicker";
import { DEFAULT_TASK_FILTER, buildTaskCopyText, resolveTaskRange, validTaskRange, type TaskCopyFormat, type TaskCopyGroup, type TaskDateFilter, type TaskRangePreset, type TaskStatusFilter } from "../task-filters";
import { resolveHostFirstDayOfWeek } from "./ProjectionController";
import type { TaskCardItem } from "../types";
import type { ViewContext } from "../view-context";

export class TaskFilterController {
  private closePanel: (() => void) | null = null;
  private menu: Menu | null = null;
  private disposed = false;
  private copyDocument: Document | null = null;
  trackMenu(menu: Menu, doc?: Document): void { this.close(); this.menu = menu; this.copyDocument = doc ?? null; }
  private field: TaskDateKind = "done";
  constructor(private readonly context: ViewContext, private readonly deps: {
    refresh: () => void;
    flushSettings?: () => Promise<void>;
    groups: () => readonly TaskCopyGroup[];
    canCopy: () => boolean;
    pending: (path: string, line: number) => boolean;
  }) {}

  close(): void { this.closePanel?.(); this.menu?.hide(); this.menu = null; }
  invalidateMenu(): void { this.menu?.hide(); this.menu = null; }
  dispose(): void { this.disposed = true; this.close(); }
  getDateLabel(compact = false): string {
    const filter = this.context.store.getTaskFilters().date;
    if (!filter) return "";
    const range = resolveTaskRange(filter, new Date(), resolveHostFirstDayOfWeek());
    const year = String(new Date().getFullYear());
    const format = (date: string): string => compact && date.startsWith(`${year}-`) ? date.slice(5).replace("-", "/") : date;
    const dates = range.start === range.end ? format(range.start) : `${format(range.start)} – ${format(range.end)}`;
    return `${this.context.getUiStrings().tasks.datePicker.kinds[filter.field]}: ${dates}`;
  }
  private update(status?: TaskStatusFilter, date?: TaskDateFilter | null): void {
    const current = this.context.store.getTaskFilters();
    this.context.store.setTaskFilters({ status: status ?? current.status, date: date === undefined ? current.date : date });
    this.close(); this.deps.refresh();
  }
  clear(kind?: "status" | "date"): void {
    if (!kind) { this.context.store.setTaskFilters({ ...DEFAULT_TASK_FILTER }); this.close(); this.deps.refresh(); }
    else if (kind === "status") this.update("all"); else this.update(undefined, null);
  }
  openStatus(anchor: HTMLElement): void {
    this.close(); const s = this.context.getUiStrings().tasks.tools;
    const menu = this.menu = new Menu();
    for (const value of ["all", "incomplete", "completed"] as const) menu.addItem(item => item.setTitle(s.states[value])
      .setChecked(this.context.store.getTaskFilters().status === value).onClick(() => this.update(value)));
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom });
  }
  openDates(anchor: HTMLElement): void {
    this.close();
    const doc = anchor.ownerDocument, win = doc.defaultView;
    if (!win) return;
    const strings = this.context.getUiStrings().tasks, s = strings.tools;
    const active = this.context.store.getTaskFilters().date;
    const today = formatIsoDate(new Date());
    const draft: TaskDateFilter = active ? { ...active } : { field: this.field, preset: "custom", start: today, end: today, weekEnd: this.context.getSettings().taskReportWeekEndDay ?? 4 };
    const panel = win.createFragment().createDiv(); panel.className = "fce-task-filter-panel";
    panel.classList.toggle("is-sheet", this.context.runtimePlatform?.device === "phone");
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", s.date);
    const title = panel.createEl("strong", { text: s.date }); title.setAttribute("role", "heading");
    const select = (label: string, values: Record<string, string>, value: string): HTMLSelectElement => {
      const row = panel.createEl("label"); row.createSpan({ text: label }); const input = row.createEl("select");
      for (const [key, text] of Object.entries(values)) { const option = input.createEl("option", { text }); option.value = key; }
      input.value = value; return input;
    };
    const field = select(s.field, strings.datePicker.kinds, draft.field);
    const preset = select(s.range, s.ranges, active?.preset ?? "none");
    const weekdays = Object.fromEntries(strings.datePicker.weekdaysLong.map((label, day) => [day, label]));
    const cutoff = select(s.cutoff, weekdays, String(draft.weekEnd));
    const dates = panel.createDiv();
    let datePicker: TaskDatePickerHandle | null = null;
    let dateAnchor: HTMLButtonElement | null = null;
    const dateButton = (label: string, boundary: "start" | "end"): { button: HTMLButtonElement; value: HTMLElement } => {
      const row = dates.createEl("label"); row.createSpan({ text: label });
      const button = row.createEl("button", { cls: "fce-task-filter-date" }); button.type = "button";
      button.setAttribute("aria-label", label); button.setAttribute("aria-haspopup", "dialog"); button.setAttribute("aria-expanded", "false");
      const value = button.createSpan(); setIcon(button.createSpan({ cls: "fce-task-filter-date-icon" }), "calendar");
      button.onclick = () => openCalendar(boundary, button);
      return { button, value };
    };
    const start = dateButton(s.start, "start"), end = dateButton(s.end, "end");
    const hint = dates.createDiv({ text: s.inclusive }); hint.className = "fce-task-filter-hint";
    const error = panel.createDiv({ cls: "fce-task-filter-error" }); error.setAttribute("role", "alert");
    const footer = panel.createDiv({ cls: "fce-task-filter-footer" });
    const cancel = footer.createEl("button", { text: s.cancel });
    const apply = footer.createEl("button", { text: s.apply, cls: "mod-cta" });
    let saving = false, closed = false, retryPreference = false;
    const render = (): void => {
      draft.field = field.value as TaskDateKind; draft.weekEnd = Number(cutoff.value);
      cutoff.parentElement!.hidden = preset.value !== "report" && preset.value !== "previous-report";
      dates.hidden = preset.value === "none";
      if (preset.value !== "none") {
        draft.preset = preset.value as TaskRangePreset;
        const range = resolveTaskRange(draft, new Date(), resolveHostFirstDayOfWeek());
        draft.start = range.start; draft.end = range.end;
      }
      start.value.textContent = draft.start || strings.datePicker.notSet;
      end.value.textContent = draft.end || strings.datePicker.notSet;
      const valid = preset.value === "none" || validTaskRange(draft.start, draft.end);
      apply.disabled = saving || !valid; error.textContent = valid ? "" : s.invalid;
    };
    const openCalendar = (boundary: "start" | "end", button: HTMLButtonElement): void => {
      if (saving || closed) return;
      const sameAnchor = dateAnchor === button;
      datePicker?.close();
      if (sameAnchor) return;
      dateAnchor = button; button.setAttribute("aria-expanded", "true"); button.focus({ preventScroll: true });
      datePicker = openTaskDatePicker({
        doc, anchor: button, layout: this.context.runtimePlatform?.device === "phone" ? "sheet" : "popover",
        kind: draft.field, label: `${boundary === "start" ? s.start : s.end} · ${strings.datePicker.kinds[draft.field]}`,
        value: draft[boundary] || null, firstDayOfWeek: resolveHostFirstDayOfWeek(), strings: strings.datePicker,
        onSubmit: value => {
          if (closed || saving) return false;
          draft[boundary] = value ?? ""; preset.value = "custom"; render(); position();
          return true;
        },
        onClose: () => { datePicker = null; dateAnchor = null; button.setAttribute("aria-expanded", "false"); },
      });
    };
    const changeRange = (): void => { datePicker?.close(); render(); position(); };
    field.onchange = preset.onchange = cutoff.onchange = changeRange;
    const close = (): void => {
      if (closed) return;
      closed = true; datePicker?.close(); panel.remove();
      doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("keydown", key, true);
      win.removeEventListener("resize", position); win.removeEventListener("pagehide", close);
      win.visualViewport?.removeEventListener("resize", position); win.visualViewport?.removeEventListener("scroll", position);
      this.closePanel = null;
      if (anchor.isConnected) anchor.focus({ preventScroll: true });
    };
    const outside = (event: Event): void => {
      const path = event.composedPath();
      if (!saving && !path.includes(panel) && !path.includes(anchor) && !(datePicker && path.includes(datePicker.element))) close();
    };
    const key = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || saving) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (datePicker) datePicker.close(); else close();
    };
    const position = (): void => {
      if (panel.classList.contains("is-sheet")) return;
      const rect = anchor.getBoundingClientRect();
      panel.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - panel.offsetWidth - 8))}px`;
      panel.style.top = `${Math.max(8, Math.min(rect.bottom + 6, win.innerHeight - panel.offsetHeight - 8))}px`;
    };
    cancel.onclick = close;
    apply.onclick = () => { void (async () => {
      render(); if (apply.disabled) return;
      datePicker?.close(); saving = true; render(); cancel.disabled = true;
      for (const control of [field, preset, cutoff, start.button, end.button]) control.disabled = true;
      try {
        if (retryPreference || this.context.getSettings().taskReportWeekEndDay !== draft.weekEnd) {
          retryPreference = true;
          await this.context.saveSettings({ taskReportWeekEndDay: draft.weekEnd }, { skipViewUpdate: true });
          await this.deps.flushSettings?.();
          retryPreference = false;
        }
        if (closed) return;
        this.field = draft.field;
        this.update(undefined, preset.value === "none" ? null : { ...draft });
      } catch {
        if (!closed) {
          saving = false; cancel.disabled = false;
          for (const control of [field, preset, cutoff, start.button, end.button]) control.disabled = false;
          render(); error.textContent = strings.datePicker.saveError;
        }
      }
    })(); };
    render(); this.closePanel = close; doc.body.append(panel); position(); field.focus();
    doc.addEventListener("pointerdown", outside, true); doc.addEventListener("keydown", key, true);
    win.addEventListener("resize", position); win.addEventListener("pagehide", close);
    win.visualViewport?.addEventListener("resize", position); win.visualViewport?.addEventListener("scroll", position);
  }
  appendCopyMenu(menu: Menu, target: { group?: string; task?: { filePath: string; line: number } }): void {
    const s = this.context.getUiStrings().tasks.tools;
    for (const format of ["text", "unordered", "tasks"] as const) menu.addItem(item => item.setTitle(s.formats[format]).setIcon("copy")
      .setDisabled(!this.canCopyTarget(target)).onClick(() => { void this.copy(target, format); }));
  }
  openCopy(anchor: HTMLElement, group?: string): void {
    this.openResultMenu(anchor, group);
  }
  openGroupMenu(anchor: HTMLElement, group: string, position?: { x: number; y: number }): void {
    this.openResultMenu(anchor, group, position);
  }
  private openResultMenu(anchor: HTMLElement, group?: string, position?: { x: number; y: number }): void {
    this.close(); this.copyDocument = anchor.ownerDocument; const menu = this.menu = new Menu(); this.appendCopyMenu(menu, { group });
    const rect = anchor.getBoundingClientRect(); menu.showAtPosition(position ?? { x: rect.left, y: rect.bottom });
  }
  private selectGroups(target: { group?: string; task?: { filePath: string; line: number; lineText?: string } }): readonly TaskCopyGroup[] {
    let groups = this.deps.groups();
    if (target.group !== undefined) groups = groups.filter(group => group.key === target.group);
    if (target.task) {
      const selected = target.task;
      const find = (item: TaskCardItem): TaskCardItem | undefined => item.line === selected.line && (selected.lineText === undefined || item.lineText === selected.lineText) ? item : item.children.map(find).find(Boolean);
      const root = groups.flatMap(group => group.tasks).find(root => root.filePath === selected.filePath && find(root));
      const item = root && find(root);
      groups = root && item ? [{ key: "", label: "", tasks: [{ ...root, ...item }] }] : [];
    }
    return groups;
  }
  private canCopyTarget(target: { group?: string; task?: { filePath: string; line: number } }): boolean {
    if (this.disposed || !this.deps.canCopy()) return false;
    const groups = this.selectGroups(target);
    const pending = (item: TaskCardItem, path: string): boolean => this.deps.pending(path, item.line) || item.children.some(child => pending(child, path));
    return groups.some(group => group.tasks.length > 0) && !groups.some(group => group.tasks.some(task => pending(task, task.filePath)));
  }
  private async copy(target: { group?: string; task?: { filePath: string; line: number } }, format: TaskCopyFormat): Promise<void> {
    if (!this.canCopyTarget(target)) return;
    const groups = this.selectGroups(target);
    const result = buildTaskCopyText(groups, format, this.context.getSettings().taskCopyPreserveOriginal, !target.task);
    if (!result.count) return;
    try { await (this.copyDocument?.defaultView?.navigator.clipboard ?? navigator.clipboard).writeText(result.text); if (this.disposed) return; this.context.notify(this.context.getUiStrings().tasks.tools.copied(result.count)); }
    catch {
      if (this.disposed) return;
      const modal = new Modal(this.context.getApp()); modal.setTitle(this.context.getUiStrings().tasks.tools.selectText);
      const text = modal.contentEl.createEl("textarea", { cls: "fce-copy-fallback" }); text.readOnly = true; text.value = result.text;
      modal.open(); text.focus(); text.select();
    }
  }
}
