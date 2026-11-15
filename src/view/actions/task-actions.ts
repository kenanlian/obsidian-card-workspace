import { Menu, moment } from "obsidian";

import type { TaskViewStrings } from "../../i18n/tasks";
import type { TaskWriteResult, TaskWriteService, TaskWriteTarget } from "../../services/TaskWriteService";
import type { OpenDestination } from "../../settings";
import { formatIsoDate, type TaskDateKind } from "../../tasks";
import { closeTaskDatePickerForAnchor, openTaskDatePicker } from "../../tasks/ui/TaskDatePicker";
import type { CardOpenLocation } from "../link-card-location";
import { taskItemId } from "../task-card-display";
import type { TaskCardItem, TaskCardRecord } from "../types";
import type { ViewContext } from "../view-context";

/** How long a successful write may wait for the task index to republish the item. */
export const TASK_PENDING_SETTLE_MS = 3000;

export type TaskWriter = Pick<TaskWriteService, "setStatus" | "setDate">;

type TaskExpectation =
  | { readonly kind: "status"; readonly completed: boolean }
  | { readonly kind: "date"; readonly dateKind: TaskDateKind; readonly value: string | null };

interface PendingTaskWrite {
  readonly filePath: string;
  readonly line: number;
  readonly expect: TaskExpectation;
  /** The write finished; the entry now waits for the projected item to show the change. */
  settled: boolean;
  timer: ReturnType<Window["setTimeout"]> | null;
}

export interface TaskActionsDeps {
  trackMenu?: (menu: Menu, doc?: Document) => void;
  appendCopyMenu?: (menu: Menu, target: { filePath: string; line: number; lineText: string }) => void;
  context: ViewContext;
  getWriter: () => TaskWriter | null;
  /** Root tasks currently projected for this view. */
  getVisibleTasks: () => readonly TaskCardRecord[];
  openNote: (filePath: string, destination?: OpenDestination, location?: CardOpenLocation) => Promise<unknown> | void;
  today?: () => string;
  firstDayOfWeek?: () => number;
}

function hostFirstDayOfWeek(): number {
  try {
    const day = moment.localeData().firstDayOfWeek();
    return Number.isInteger(day) ? day : 0;
  } catch {
    return 0;
  }
}

function isTaskDateKind(value: unknown): value is TaskDateKind {
  return value === "created" || value === "done" || value === "due";
}

function readTarget(detail: { filePath?: unknown; line?: unknown; lineText?: unknown }): TaskWriteTarget | null {
  const { filePath, line, lineText } = detail;
  if (typeof filePath !== "string" || filePath.length === 0 || typeof lineText !== "string"
    || typeof line !== "number" || !Number.isInteger(line) || line < 0) return null;
  return { filePath, line, lineText };
}

function findTaskItem(records: readonly TaskCardRecord[], filePath: string, line: number): TaskCardItem | null {
  const visit = (items: readonly TaskCardItem[]): TaskCardItem | null => {
    for (const item of items) {
      if (item.line === line) return item;
      const nested = visit(item.children);
      if (nested) return nested;
    }
    return null;
  };
  return visit(records.filter((record) => record.filePath === filePath));
}

function isExpectationMet(item: TaskCardItem, expect: TaskExpectation): boolean {
  return expect.kind === "status" ? item.completed === expect.completed : item.dates[expect.dateKind] === expect.value;
}

/**
 * Task-stream write intents for one view: checkbox, date chips, open at line,
 * and the task context menu.
 *
 * A write marks its item pending until the projected task shows the requested
 * change, the item leaves the stream, the write fails, or a settle timeout
 * passes; the task index refresh then republishes the list.
 */
export class TaskActions {
  private readonly pending = new Map<string, PendingTaskWrite>();
  private disposed = false;

  constructor(private readonly deps: TaskActionsDeps) {}

  private get strings(): TaskViewStrings {
    return this.deps.context.getUiStrings().tasks.view;
  }

  private today(): string {
    return this.deps.today?.() ?? formatIsoDate(new Date());
  }

  /** Pending ids, after dropping settled entries the projection already reflects. */
  getPendingIds(): string[] {
    if (this.pending.size === 0) return [];
    const records = this.deps.getVisibleTasks();
    for (const [id, entry] of this.pending) {
      if (!entry.settled) continue;
      const item = findTaskItem(records, entry.filePath, entry.line);
      if (!item || isExpectationMet(item, entry.expect)) this.drop(id);
    }
    return [...this.pending.keys()];
  }

  getPendingStatuses(): Record<string, boolean> {
    return Object.fromEntries([...this.pending].flatMap(([id, entry]) => entry.expect.kind === "status" ? [[id, entry.expect.completed]] : []));
  }

  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  async toggle(detail: { filePath?: unknown; line?: unknown; lineText?: unknown; completed?: unknown }): Promise<void> {
    const target = readTarget(detail);
    if (!target || typeof detail.completed !== "boolean") return;
    const id = taskItemId(target.filePath, target.line);
    const writer = this.deps.getWriter();
    if (!writer || this.pending.has(id)) return;
    const completed = !detail.completed;
    this.begin(id, target, { kind: "status", completed });
    const result = await this.run(() => writer.setStatus(target, completed, {
      today: this.today(),
      autoDoneDate: this.deps.context.getSettings().autoDoneDate,
    }));
    if (this.disposed) return;
    this.settle(id, target, result);
    if (result.outcome === "error") this.deps.context.notify(this.errorMessage(result.reason));
  }

  openDatePicker(detail: {
    filePath?: unknown; line?: unknown; lineText?: unknown; kind?: unknown; value?: unknown; anchor?: unknown;
  }): void {
    const target = readTarget(detail);
    const { kind, anchor } = detail;
    const value = detail.value === null || typeof detail.value === "string" ? detail.value : undefined;
    // Structural check: popout-window elements fail cross-realm `instanceof`.
    if (!target || !isTaskDateKind(kind) || value === undefined
      || typeof anchor !== "object" || anchor === null || !("ownerDocument" in anchor)) return;
    const element = anchor as HTMLElement;
    if (closeTaskDatePickerForAnchor(element)) return;
    const id = taskItemId(target.filePath, target.line);
    if (this.pending.has(id) || !this.deps.getWriter()) return;
    openTaskDatePicker({
      doc: element.ownerDocument,
      anchor: element,
      layout: this.deps.context.runtimePlatform?.device === "phone" ? "sheet" : "popover",
      kind,
      value,
      firstDayOfWeek: this.deps.firstDayOfWeek?.() ?? hostFirstDayOfWeek(),
      strings: this.deps.context.getUiStrings().tasks.datePicker,
      onSubmit: (next) => this.submitDate(target, kind, next),
    });
  }

  /** `true` closes the picker; `false` keeps it open with its retry message. */
  async submitDate(target: TaskWriteTarget, kind: TaskDateKind, value: string | null): Promise<boolean> {
    const writer = this.deps.getWriter();
    const id = taskItemId(target.filePath, target.line);
    if (!writer || this.disposed || this.pending.has(id)) return false;
    this.begin(id, target, { kind: "date", dateKind: kind, value });
    const result = await this.run(() => writer.setDate(target, kind, value));
    if (this.disposed) return false;
    this.settle(id, target, result);
    if (result.outcome === "ok") return true;
    // Retrying cannot help once the task line itself is gone or changed.
    if (result.reason !== "write-failed") this.deps.context.notify(this.errorMessage(result.reason));
    return false;
  }

  open(detail: { filePath?: unknown; line?: unknown; lineText?: unknown; destination?: unknown }): void {
    if (typeof detail.filePath !== "string" || detail.filePath.length === 0) return;
    const destination = detail.destination === "new-tab" ? "new-tab" as const : undefined;
    const target = readTarget(detail);
    if (!target) {
      void this.deps.openNote(detail.filePath, destination);
      return;
    }
    // `link-reference` positions regardless of the Links-only locate setting and
    // re-validates the line text before moving the cursor.
    const location: CardOpenLocation = {
      kind: "link-reference",
      location: { line: target.line, expectedText: target.lineText, identity: `task:${target.filePath}:${target.line}` },
      isCurrent: () => !this.disposed,
    };
    void this.deps.openNote(target.filePath, destination, location);
  }

  openContextMenu(detail: {
    filePath?: unknown; line?: unknown; lineText?: unknown; text?: unknown; mouseEvent?: unknown; position?: unknown;
  }): void {
    const target = readTarget(detail);
    if (!target) return;
    const strings = this.strings;
    const text = typeof detail.text === "string" ? detail.text : target.lineText;
    const menu = new Menu();
    const source = (detail.mouseEvent as MouseEvent | undefined)?.target as Node | null;
    this.deps.trackMenu?.(menu, source?.ownerDocument ?? undefined);
    menu.addItem((item) => item.setTitle(strings.menu.open).setIcon("square-arrow-out-up-right")
      .onClick(() => this.open(target)));
    menu.addItem((item) => item.setTitle(strings.menu.openInNewTab).setIcon("file-plus")
      .onClick(() => this.open({ ...target, destination: "new-tab" })));
    menu.addSeparator();
    if (this.deps.appendCopyMenu) this.deps.appendCopyMenu(menu, target);
    else menu.addItem((item) => item.setTitle(strings.menu.copyText).setIcon("copy")
      .onClick(() => { void this.copyText(text); }));
    const mouseEvent = detail.mouseEvent;
    const position = detail.position as { x?: unknown; y?: unknown } | undefined;
    if (position && typeof position.x === "number" && typeof position.y === "number") {
      menu.showAtPosition({ x: position.x, y: position.y });
    } else if (mouseEvent && typeof (mouseEvent as MouseEvent).clientX === "number") {
      menu.showAtMouseEvent(mouseEvent as MouseEvent);
    }
  }

  private async copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.deps.context.notify(this.strings.copied);
    } catch {
      this.deps.context.notify(this.strings.copyFailed);
    }
  }

  private async run(write: () => Promise<TaskWriteResult>): Promise<TaskWriteResult> {
    try {
      return await write();
    } catch (error) {
      console.warn("[Card Workspace] Task write failed.", error);
      return { outcome: "error", reason: "write-failed", error };
    }
  }

  private begin(id: string, target: TaskWriteTarget, expect: TaskExpectation): void {
    this.pending.set(id, { filePath: target.filePath, line: target.line, expect, settled: false, timer: null });
    this.deps.context.publishGroups("cards");
  }

  private settle(id: string, target: TaskWriteTarget, result: TaskWriteResult): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    // A moved line has a different id; its refresh replaces the item anyway.
    if (result.outcome === "error" || !result.changed || result.line !== target.line) {
      this.drop(id);
    } else {
      entry.settled = true;
      entry.timer = this.deps.context.getViewWindow().setTimeout(() => {
        entry.timer = null;
        if (this.pending.get(id) !== entry) return;
        this.drop(id);
        this.deps.context.publishGroups("cards");
      }, TASK_PENDING_SETTLE_MS);
    }
    this.deps.context.publishGroups("cards");
  }

  private drop(id: string): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer !== null) this.deps.context.getViewWindow().clearTimeout(entry.timer);
    this.pending.delete(id);
  }

  private errorMessage(reason: Extract<TaskWriteResult, { outcome: "error" }>["reason"]): string {
    const errors = this.strings.errors;
    switch (reason) {
      case "line-not-found": return errors.lineNotFound;
      case "missing-file": return errors.missingFile;
      case "not-a-task": return errors.notATask;
      default: return errors.writeFailed;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const id of [...this.pending.keys()]) this.drop(id);
  }
}
