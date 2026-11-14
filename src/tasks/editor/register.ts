import { moment, type App, type Command } from "obsidian";
import type { Extension } from "@codemirror/state";
import type { UiStrings } from "../../i18n";
import type { PluginSettings } from "../../settings";
import { formatIsoDate } from "../index";
import { closeAllTaskDatePickers } from "../ui/TaskDatePicker";
import { createCreatedDateTracker } from "./created-date-filter";
import { createDoneDateFilter } from "./done-date-filter";
import { createHiddenDateSource } from "./hidden-date-source";
import { insertOrConvertTasks } from "./task-commands";
import { createTaskDateButtons } from "./task-date-buttons";

export type TaskEditingSettings = Pick<PluginSettings,
  "enhancedTaskEditing" | "autoCreatedDate" | "autoDoneDate" | "taskDateButtons" | "taskDateButtonStyle" | "taskDateHideSource">;

export interface TaskEditingHost {
  readonly app: Pick<App, "workspace">;
  readonly device: "desktop" | "tablet" | "phone";
  registerEditorExtension(extension: Extension): void;
  addCommand(command: Command): unknown;
  /** Runs on plugin unload. */
  register(cleanup: () => void): void;
  getSettings(): TaskEditingSettings;
  getStrings(): UiStrings;
}

export interface TaskEditingRegistration {
  /** Reconfigures open editors when a task-editing setting changed; otherwise a no-op. */
  refresh(): void;
}

export const INSERT_TASK_COMMAND_ID = "insert-task";

const todayIso = (): string => formatIsoDate(new Date());

function firstDayOfWeek(): number {
  try {
    const day = moment.localeData().firstDayOfWeek();
    return Number.isInteger(day) ? day : 0;
  } catch {
    return 0;
  }
}

export function registerTaskEditing(host: TaskEditingHost): TaskEditingRegistration {
  host.addCommand({
    id: INSERT_TASK_COMMAND_ID,
    name: host.getStrings().tasks.editor.insertTaskCommand,
    editorCallback: (editor) => {
      insertOrConvertTasks(editor, host.getSettings().autoCreatedDate ? todayIso() : null);
    },
  });

  // Obsidian keeps this array; mutating it and calling updateOptions() reconfigures editors.
  const extensions: Extension[] = [];
  let signature = "";
  const rebuild = (): boolean => {
    const settings = host.getSettings();
    const next = [
      settings.enhancedTaskEditing,
      settings.enhancedTaskEditing && settings.autoCreatedDate,
      settings.enhancedTaskEditing && settings.autoDoneDate,
      settings.enhancedTaskEditing && settings.taskDateHideSource,
      settings.taskDateButtons,
      settings.taskDateButtonStyle,
    ].join("|");
    if (next === signature) {
      return false;
    }
    signature = next;
    extensions.length = 0;
    if (!settings.enhancedTaskEditing) {
      return true;
    }
    const getStrings = () => host.getStrings().tasks;
    extensions.push(createTaskDateButtons({
      mode: settings.taskDateButtons === "full" ? "full" : "compact",
      style: settings.taskDateButtonStyle === "dots" ? "dots" : "chips",
      showDates: settings.taskDateHideSource,
      layout: host.device === "phone" ? "sheet" : "popover",
      getStrings,
      firstDayOfWeek,
      today: todayIso,
    }));
    if (settings.autoCreatedDate) {
      extensions.push(createCreatedDateTracker({ today: todayIso }));
    }
    if (settings.autoDoneDate) {
      extensions.push(createDoneDateFilter({ today: todayIso }));
    }
    if (settings.taskDateHideSource) {
      extensions.push(createHiddenDateSource());
    }
    return true;
  };

  rebuild();
  host.registerEditorExtension(extensions);
  host.register(() => closeAllTaskDatePickers());

  return {
    refresh() {
      if (rebuild()) {
        host.app.workspace.updateOptions();
      }
    },
  };
}
