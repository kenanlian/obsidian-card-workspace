import { setIcon, setTooltip } from "obsidian";
import { MapMode, RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import type { TaskStrings } from "../../i18n/tasks";
import { compareIsoDates, formatIsoDate, parseTaskLine, setTaskDate, type ParsedTaskLine, type TaskDateKind } from "../index";
import { closeTaskDatePickerForAnchor, openTaskDatePicker } from "../ui/TaskDatePicker";
import { isLivePreview, livePreviewToggled, TASK_DATE_USER_EVENT, visibleTaskLines } from "./editor-shared";

export type TaskDateButtonsMode = "compact" | "full";
export type TaskDateButtonStyle = "chips" | "dots";

export interface TaskDateButtonsOptions {
  readonly mode: TaskDateButtonsMode;
  readonly style: TaskDateButtonStyle;
  /** Chips show their short date only while the date text itself is hidden. */
  readonly showDates: boolean;
  /** Phones use the bottom sheet; other devices anchor a popover. */
  readonly layout: "popover" | "sheet";
  readonly getStrings: () => TaskStrings;
  /** 0 = Sunday … 6 = Saturday. */
  readonly firstDayOfWeek: () => number;
  readonly today?: () => string;
}

const KINDS: readonly TaskDateKind[] = ["created", "done", "due"];
export const TASK_LINE_ACTIVE_CLASS = "fce-task-line-active";

/** Same icons as the task-card chips, mirroring the stored ➕ ✅ 📅 markers. */
export const TASK_DATE_ICONS: Readonly<Record<TaskDateKind, string>> = {
  created: "plus",
  done: "check",
  due: "calendar",
};

interface LineDates {
  readonly created: string | null;
  readonly done: string | null;
  readonly due: string | null;
  readonly dueState: "overdue" | "today" | null;
  /** Local `YYYY`; chip dates outside it show their year. */
  readonly year: string;
}

interface PickerSession {
  /** Both ends of the task line, mapped through later changes; null once deleted. */
  from: number | null;
  to: number | null;
  readonly anchor: HTMLElement;
}

/** Per-view owner of open picker sessions; widgets route intents here. */
class ButtonsController {
  private readonly sessions = new Set<PickerSession>();
  private destroyed = false;

  constructor(readonly options: TaskDateButtonsOptions) {}

  mapSessions(update: ViewUpdate): void {
    if (!update.docChanged) {
      return;
    }
    for (const session of this.sessions) {
      if (session.from !== null && session.to !== null) {
        session.from = update.changes.mapPos(session.from, 1, MapMode.TrackDel);
        session.to = update.changes.mapPos(session.to, -1, MapMode.TrackDel);
      }
    }
  }

  open(view: EditorView, button: HTMLElement, kind: TaskDateKind): void {
    if (this.destroyed || closeTaskDatePickerForAnchor(button)) {
      return;
    }
    const container = button.parentElement;
    if (container === null || !container.isConnected) {
      return;
    }
    const line = view.state.doc.lineAt(view.posAtDOM(container));
    const parsed = parseTaskLine(line.text);
    if (parsed === null) {
      return;
    }
    const session: PickerSession = { from: line.from, to: line.to, anchor: button };
    this.sessions.add(session);
    openTaskDatePicker({
      doc: button.ownerDocument,
      anchor: button,
      layout: this.options.layout,
      kind,
      value: parsed.dates[kind]?.value ?? null,
      firstDayOfWeek: this.options.firstDayOfWeek(),
      strings: this.options.getStrings().datePicker,
      onSubmit: (value) => this.submit(view, session, kind, value),
      onClose: () => { this.sessions.delete(session); },
    });
  }

  private submit(view: EditorView, session: PickerSession, kind: TaskDateKind, value: string | null): boolean {
    if (this.destroyed || !this.sessions.has(session) || session.from === null || session.to === null) {
      return false;
    }
    const line = view.state.doc.lineAt(session.from);
    // A split line is ambiguous; a merged or edited line is still the same task.
    if (session.to < line.from || session.to > line.to || parseTaskLine(line.text) === null) {
      return false;
    }
    const patches = setTaskDate(line.text, kind, value);
    if (patches !== null) {
      view.dispatch({
        changes: patches.map((patch) => ({ from: line.from + patch.from, to: line.from + patch.to, insert: patch.insert })),
        userEvent: TASK_DATE_USER_EVENT,
      });
    }
    return true;
  }

  destroy(): void {
    this.destroyed = true;
    for (const session of [...this.sessions]) {
      closeTaskDatePickerForAnchor(session.anchor);
    }
    this.sessions.clear();
  }
}

class TaskDateButtonsWidget extends WidgetType {
  constructor(private readonly dates: LineDates, private readonly controller: ButtonsController) {
    super();
  }

  eq(other: TaskDateButtonsWidget): boolean {
    return other.controller === this.controller
      && other.dates.created === this.dates.created
      && other.dates.done === this.dates.done
      && other.dates.due === this.dates.due
      && other.dates.dueState === this.dates.dueState
      && other.dates.year === this.dates.year;
  }

  toDOM(view: EditorView): HTMLElement {
    const { mode, style, showDates } = this.controller.options;
    const strings = this.controller.options.getStrings();
    // A document-local fragment keeps popout windows on their own document.
    const container = view.dom.ownerDocument.defaultView!.createFragment().createSpan({
      cls: `fce-task-date-buttons is-${mode} is-${style}`,
      attr: { role: "group", "aria-label": strings.editor.dateButtons },
    });
    for (const kind of KINDS) {
      const value = this.dates[kind];
      const button = container.createSpan({ cls: `fce-task-date-button ${value === null ? "is-unset" : "is-set"}` });
      if (kind === "due" && this.dates.dueState === "overdue") {
        button.classList.add("is-overdue");
      } else if (kind === "due" && this.dates.dueState === "today") {
        button.classList.add("is-due-today");
      }
      button.dataset.kind = kind;
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      const label = strings.editor.dateButtonLabel(strings.datePicker.kinds[kind], value ?? strings.datePicker.notSet);
      button.setAttribute("aria-label", label);
      setTooltip(button, label);
      if (style === "chips") {
        setIcon(button.createSpan({ cls: "fce-task-date-button-icon", attr: { "aria-hidden": "true" } }), TASK_DATE_ICONS[kind]);
        if (showDates && value !== null) {
          button.classList.add("has-date");
          button.createSpan({ cls: "fce-task-date-button-label", text: chipDate(value, this.dates.year, strings), attr: { "aria-hidden": "true" } });
        }
      }
    }
    const buttonFrom = (target: EventTarget | null): HTMLElement | null => {
      const element = target as Element | null;
      const button = typeof element?.closest === "function" ? element.closest<HTMLElement>(".fce-task-date-button") : null;
      return button !== null && container.contains(button) ? button : null;
    };
    const activate = (button: HTMLElement) => {
      const kind = button.dataset.kind;
      if (kind === "created" || kind === "done" || kind === "due") {
        this.controller.open(view, button, kind);
      }
    };
    // Keep the caret and selection where they are.
    container.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    container.addEventListener("click", (event) => {
      const button = buttonFrom(event.target);
      if (button === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activate(button);
    });
    container.addEventListener("keydown", (event) => {
      if ((event.key !== "Enter" && event.key !== " ") || event.isComposing) {
        return;
      }
      const button = buttonFrom(event.target);
      if (button === null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      activate(button);
    });
    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function lineDates(parsed: ParsedTaskLine, today: string): LineDates {
  const due = parsed.dates.due?.value ?? null;
  const dueOrder = due === null || parsed.completed ? null : compareIsoDates(due, today);
  return {
    created: parsed.dates.created?.value ?? null,
    done: parsed.dates.done?.value ?? null,
    due,
    dueState: dueOrder === null ? null : dueOrder < 0 ? "overdue" : dueOrder === 0 ? "today" : null,
    year: today.slice(0, 4),
  };
}

/** `value` is a valid `YYYY-MM-DD` date, as parsed task dates always are. */
function chipDate(value: string, currentYear: string, strings: TaskStrings): string {
  const year = value.slice(0, 4);
  return strings.view.chipDate(Number(year), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)), year !== currentYear);
}

/**
 * Live Preview-only trailing buttons for a task line's created, done and due
 * dates. The active-line class lets compact mode reveal unset buttons without hover.
 */
export function createTaskDateButtons(options: TaskDateButtonsOptions): Extension {
  const activeLine = Decoration.line({ class: TASK_LINE_ACTIVE_CLASS });
  const today = options.today ?? (() => formatIsoDate(new Date()));

  class TaskDateButtonsPlugin {
    private readonly controller = new ButtonsController(options);
    buttons: DecorationSet;
    active: DecorationSet;
    private taskLineStarts: readonly number[] = [];

    constructor(view: EditorView) {
      this.buttons = this.buildButtons(view);
      this.active = this.buildActive(view);
    }

    update(update: ViewUpdate): void {
      this.controller.mapSessions(update);
      const rebuild = update.docChanged || update.viewportChanged || livePreviewToggled(update);
      if (rebuild) {
        this.buttons = this.buildButtons(update.view);
      }
      if (rebuild || update.selectionSet) {
        this.active = this.buildActive(update.view);
      }
    }

    destroy(): void {
      this.controller.destroy();
    }

    private buildButtons(view: EditorView): DecorationSet {
      if (!isLivePreview(view.state)) {
        this.taskLineStarts = [];
        return Decoration.none;
      }
      const date = today();
      const builder = new RangeSetBuilder<Decoration>();
      const starts: number[] = [];
      for (const { line, parsed } of visibleTaskLines(view)) {
        starts.push(line.from);
        builder.add(line.to, line.to, Decoration.widget({
          widget: new TaskDateButtonsWidget(lineDates(parsed, date), this.controller),
          side: 1,
        }));
      }
      this.taskLineStarts = starts;
      return builder.finish();
    }

    private buildActive(view: EditorView): DecorationSet {
      if (this.taskLineStarts.length === 0) {
        return Decoration.none;
      }
      const starts = new Set(this.taskLineStarts);
      const active = new Set<number>();
      for (const range of view.state.selection.ranges) {
        const from = view.state.doc.lineAt(range.head).from;
        if (starts.has(from)) {
          active.add(from);
        }
      }
      return Decoration.set([...active].sort((left, right) => left - right).map((from) => activeLine.range(from)));
    }
  }

  const plugin = ViewPlugin.fromClass(TaskDateButtonsPlugin, {
    decorations: (value) => value.buttons,
    provide: (self) => EditorView.decorations.of((view) => view.plugin(self)?.active ?? Decoration.none),
  });
  return plugin;
}
