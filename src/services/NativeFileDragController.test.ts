import { afterEach, describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { NativeFileDragController } from "./NativeFileDragController";

function harness(path = "notes/a.md") {
  const file = Object.assign(new TFile(), { path });
  const draggable = { type: "file", file };
  const manager = {
    draggable: null as unknown,
    dragFile: vi.fn((_event: DragEvent, _file: TFile): unknown => draggable),
    onDragStart: vi.fn((_event: DragEvent, value: unknown) => { manager.draggable = value; }),
    onDragEnd: vi.fn(() => { manager.draggable = null; }),
  };
  const app = {
    dragManager: manager as unknown,
    vault: { getAbstractFileByPath: vi.fn((): TFile | TFolder | null => file), cachedRead: vi.fn() },
  };
  const event = { dataTransfer: {}, defaultPrevented: false } as DragEvent;
  return { app, manager, event, file, draggable, controller: new NativeFileDragController(() => app as unknown as App) };
}

afterEach(() => vi.restoreAllMocks());

describe("NativeFileDragController", () => {
  it.each(["notes/a.md", "notes/a.base", "notes/a.canvas", "notes/a.excalidraw.md"])(
    "drags exactly the live file without reading its content: %s", (path) => {
      const { app, manager, event, file, draggable, controller } = harness(path);
      const finish = controller.start(event, path);
      expect(app.vault.getAbstractFileByPath).toHaveBeenCalledWith(path);
      expect(manager.dragFile).toHaveBeenCalledExactlyOnceWith(event, file);
      expect(manager.onDragStart).toHaveBeenCalledExactlyOnceWith(event, draggable);
      expect(manager.draggable).toBe(draggable);
      expect(app.vault.cachedRead).not.toHaveBeenCalled();
      finish!(); finish!(); controller.dispose();
      expect(manager.onDragEnd).toHaveBeenCalledOnce();
    },
  );

  it.each([undefined, {}, { dragFile() {} }, { dragFile() {}, onDragStart() {} }])(
    "declines incomplete native capabilities", (candidate) => {
      const { app, event, controller, manager } = harness();
      app.dragManager = candidate;
      expect(controller.start(event, "notes/a.md")).toBeNull();
      expect(manager.onDragStart).not.toHaveBeenCalled();
    },
  );

  it.each([null, new TFolder()])("declines a missing or non-file source", (file) => {
    const { app, event, controller, manager } = harness();
    app.vault.getAbstractFileByPath.mockReturnValue(file);
    expect(controller.start(event, "notes/a.md")).toBeNull();
    expect(manager.dragFile).not.toHaveBeenCalled();
  });

  it("ignores canceled events and events without a transfer", () => {
    const { event, controller, manager } = harness();
    expect(controller.start({ ...event, defaultPrevented: true } as DragEvent, "notes/a.md")).toBeNull();
    expect(controller.start({ ...event, dataTransfer: null } as DragEvent, "notes/a.md")).toBeNull();
    expect(manager.dragFile).not.toHaveBeenCalled();
  });

  it.each(["prepare", "start"])("falls back after a native %s failure and cleans only its session", (stage) => {
    const { event, controller, manager, draggable } = harness();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    if (stage === "prepare") manager.dragFile.mockImplementation(() => { throw new Error("prepare"); });
    else manager.onDragStart.mockImplementation(() => { manager.draggable = draggable; throw new Error("start"); });
    expect(controller.start(event, "notes/a.md")).toBeNull();
    expect(manager.onDragEnd).toHaveBeenCalledTimes(stage === "start" ? 1 : 0);
    expect(manager.draggable).toBeNull();
  });

  it("declines a null prepared payload or a start the host ignores", () => {
    const { event, controller, manager, draggable } = harness();
    manager.dragFile.mockReturnValueOnce(null);
    expect(controller.start(event, "notes/a.md")).toBeNull();
    manager.onDragStart.mockImplementation(() => undefined);
    expect(controller.start(event, "notes/a.md")).toBeNull();
    expect(manager.draggable).not.toBe(draggable);
    expect(manager.onDragEnd).not.toHaveBeenCalled();
  });

  it("leaves another source's active drag alone", () => {
    const { event, controller, manager } = harness();
    const foreign = { type: "file", file: new TFile() };
    manager.draggable = foreign;
    expect(controller.start(event, "notes/a.md")).toBeNull();
    controller.dispose();
    expect(manager.draggable).toBe(foreign);
    expect(manager.dragFile).not.toHaveBeenCalled();
    expect(manager.onDragEnd).not.toHaveBeenCalled();
  });

  it("retires an earlier session and makes its cleanup harmless to the next one", () => {
    const { event, controller, manager } = harness();
    const first = controller.start(event, "notes/a.md")!;
    const next = { type: "file", file: new TFile() };
    manager.dragFile.mockReturnValueOnce(next);
    const second = controller.start(event, "notes/a.md")!;
    first();
    expect(manager.draggable).toBe(next);
    expect(manager.onDragEnd).toHaveBeenCalledOnce();
    second();
    expect(manager.onDragEnd).toHaveBeenCalledTimes(2);
  });

  it.each([null, { type: "files", files: [] }])("does not clear a host-ended or replaced session", (replacement) => {
    const { event, controller, manager } = harness();
    const finish = controller.start(event, "notes/a.md")!;
    manager.draggable = replacement;
    finish(); controller.dispose();
    expect(manager.onDragEnd).not.toHaveBeenCalled();
    expect(manager.draggable).toBe(replacement);
  });

  it("ends an owned drag on unload and rejects later starts", () => {
    const { event, controller, manager } = harness();
    const finish = controller.start(event, "notes/a.md")!;
    controller.dispose(); controller.dispose(); finish();
    expect(manager.onDragEnd).toHaveBeenCalledOnce();
    expect(controller.start(event, "notes/a.md")).toBeNull();
    expect(manager.dragFile).toHaveBeenCalledOnce();
  });
});
