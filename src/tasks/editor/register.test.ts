import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Command, Editor } from "obsidian";
import type { Extension } from "@codemirror/state";
import { getUiStrings } from "../../i18n";
import type { TaskEditingHost, TaskEditingSettings } from "./register";

const mocks = vi.hoisted(() => ({
  buttons: vi.fn((options: unknown) => ({ kind: "buttons", options })),
  filter: vi.fn((options: unknown) => ({ kind: "done-filter", options })),
  created: vi.fn((options: unknown) => ({ kind: "created-tracker", options })),
  hidden: vi.fn((options: unknown) => ({ kind: "hidden-source", options })),
  insert: vi.fn(() => true),
  closeAll: vi.fn(),
}));

vi.mock("./task-date-buttons", () => ({ createTaskDateButtons: mocks.buttons }));
vi.mock("./done-date-filter", () => ({ createDoneDateFilter: mocks.filter }));
vi.mock("./created-date-filter", () => ({ createCreatedDateTracker: mocks.created }));
vi.mock("./hidden-date-source", () => ({ createHiddenDateSource: mocks.hidden }));
vi.mock("./task-commands", () => ({ insertOrConvertTasks: mocks.insert }));
vi.mock("../ui/TaskDatePicker", () => ({ closeAllTaskDatePickers: mocks.closeAll }));

import { INSERT_TASK_COMMAND_ID, registerTaskEditing } from "./register";

const DEFAULTS: TaskEditingSettings = {
  enhancedTaskEditing: true, autoCreatedDate: true, autoDoneDate: true, taskDateButtons: "compact", taskDateButtonStyle: "chips", taskDateHideSource: false,
};

function createHost(device: TaskEditingHost["device"] = "desktop") {
  let settings: TaskEditingSettings = { ...DEFAULTS };
  const commands: Command[] = [];
  const registered: Extension[] = [];
  const cleanups: Array<() => void> = [];
  const updateOptions = vi.fn();
  const host: TaskEditingHost = {
    app: { workspace: { updateOptions } } as never,
    device,
    registerEditorExtension: (extension) => { registered.push(extension); },
    addCommand: (command) => { commands.push(command); return command; },
    register: (cleanup) => { cleanups.push(cleanup); },
    getSettings: () => settings,
    getStrings: () => getUiStrings("en"),
  };
  return {
    host, commands, registered, cleanups, updateOptions,
    set: (patch: Partial<TaskEditingSettings>) => { settings = { ...settings, ...patch }; },
    kinds: () => (registered[0] as unknown as Array<{ kind: string }>).map((extension) => extension.kind),
  };
}

describe("registerTaskEditing", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("always registers the insert-task editor command with the created date setting", () => {
    const fixture = createHost();
    fixture.set({ enhancedTaskEditing: false });
    registerTaskEditing(fixture.host);
    expect(fixture.commands.map((command) => [command.id, command.name])).toEqual([[INSERT_TASK_COMMAND_ID, getUiStrings("en").tasks.editor.insertTaskCommand]]);
    expect(INSERT_TASK_COMMAND_ID).toBe("insert-task");
    const editor = {} as Editor;
    fixture.commands[0]!.editorCallback!(editor, {} as never);
    expect(mocks.insert).toHaveBeenLastCalledWith(editor, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    fixture.set({ autoCreatedDate: false });
    fixture.commands[0]!.editorCallback!(editor, {} as never);
    expect(mocks.insert).toHaveBeenLastCalledWith(editor, null);
  });

  it("registers one mutable extension array composed from settings", () => {
    const fixture = createHost();
    registerTaskEditing(fixture.host);
    expect(fixture.registered).toHaveLength(1);
    expect(fixture.kinds()).toEqual(["buttons", "created-tracker", "done-filter"]);
    expect(mocks.buttons).toHaveBeenCalledWith(expect.objectContaining({ mode: "compact", style: "chips", showDates: false, layout: "popover" }));
    expect(fixture.updateOptions).not.toHaveBeenCalled();
  });

  it("refresh rebuilds the same array and reconfigures editors only when task settings change", () => {
    const fixture = createHost("phone");
    const registration = registerTaskEditing(fixture.host);
    const array = fixture.registered[0];
    expect(mocks.buttons).toHaveBeenLastCalledWith(expect.objectContaining({ layout: "sheet" }));

    registration.refresh();
    expect(fixture.updateOptions).not.toHaveBeenCalled();

    fixture.set({ taskDateHideSource: true, taskDateButtons: "full" });
    registration.refresh();
    expect(fixture.kinds()).toEqual(["buttons", "created-tracker", "done-filter", "hidden-source"]);
    expect(mocks.buttons).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "full", showDates: true }));
    expect(fixture.updateOptions).toHaveBeenCalledTimes(1);

    fixture.set({ taskDateButtonStyle: "dots" });
    registration.refresh();
    expect(mocks.buttons).toHaveBeenLastCalledWith(expect.objectContaining({ style: "dots" }));

    fixture.set({ autoDoneDate: false, autoCreatedDate: false });
    registration.refresh();
    expect(fixture.kinds()).toEqual(["buttons", "hidden-source"]);

    fixture.set({ enhancedTaskEditing: false, autoDoneDate: true, autoCreatedDate: true });
    registration.refresh();
    expect(fixture.kinds()).toEqual([]);
    expect(fixture.registered[0]).toBe(array);
    expect(fixture.updateOptions).toHaveBeenCalledTimes(4);
  });

  it("closes open date pickers on unload", () => {
    const fixture = createHost();
    registerTaskEditing(fixture.host);
    fixture.cleanups.forEach((cleanup) => cleanup());
    expect(mocks.closeAll).toHaveBeenCalledOnce();
  });
});
