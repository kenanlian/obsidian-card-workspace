import { describe, expect, it, vi } from "vitest";
import { TFile, TFolder, type App } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings } from "../settings";
import { TemplateStorageService } from "./TemplateStorageService";
import { TemplateReferenceReconciler } from "./TemplateReferenceReconciler";
import { VaultEventBus } from "./VaultEventBus";

function fixture() {
  let settings = structuredClone(DEFAULT_SETTINGS);
  settings.templateStorageFolder = "Old";
  const files = new Map<string, TFile | TFolder>();
  const contents = new Map<TFile, string>();
  const bus = new VaultEventBus();
  const folder = (path: string) => { const value = Object.assign(new TFolder(), { path }); files.set(path, value); return value; };
  const file = (path: string, content = "body {{date}}") => {
    const value = Object.assign(new TFile(), { path, name: path.split("/").pop(), extension: "md" });
    files.set(path, value); contents.set(value, content); return value;
  };
  folder(""); folder("Old");
  const first = file("Old/{{date}}.md"), second = file("Old/Second.md");
  settings.noteTemplates = [first, second].map((value, index) => ({ id: String(index), name: `Display ${index}`, filePath: value.path,
    targetFolderPath: "Notes", dateFormat: "YYYY-MM-DD", timeFormat: "HH" }));
  settings.quickInput.templateId = "0";
  const saveSettings = vi.fn(async (patch: PartialPluginSettings) => { settings = mergeSettings(settings, patch); });
  const reconciler = new TemplateReferenceReconciler({ getSettings: () => settings, saveSettings });
  bus.subscribe((event) => reconciler.handleVaultMutation(event));
  const createFolder = vi.fn(async (path: string) => { folder(path); });
  const rename = vi.fn(async (value: TFile, path: string) => {
    if (files.has(path)) throw new Error("occupied");
    const oldPath = value.path;
    files.delete(oldPath); value.path = path; files.set(path, value);
    void bus.publish({ eventType: "rename", path, oldPath, isFolder: false, fileKind: "markdown" });
  });
  const app = { vault: { getAbstractFileByPath: (path: string) => files.get(path) ?? null, createFolder },
    fileManager: { renameFile: rename } } as unknown as App;
  const assertWritable = vi.fn();
  const service = new TemplateStorageService({ app, getSettings: () => settings, saveSettings,
    flushVaultEvents: () => bus.flushPendingEvents(), assertWritable });
  return { service, settings: () => settings, files, contents, folder, file, first, second, rename, saveSettings, createFolder, assertWritable };
}

describe("TemplateStorageService", () => {
  it("creates nested storage and moves all templates while preserving names, contents, destinations and quick-input IDs", async () => {
    const f = fixture();
    await f.service.changeFolder("/New//Templates/");
    expect(f.createFolder.mock.calls).toEqual([["New"], ["New/Templates"]]);
    expect(f.settings().templateStorageFolder).toBe("New/Templates");
    expect(f.settings().noteTemplates).toEqual([
      { id: "0", name: "Display 0", filePath: "New/Templates/{{date}}.md", targetFolderPath: "Notes", dateFormat: "YYYY-MM-DD", timeFormat: "HH" },
      { id: "1", name: "Display 1", filePath: "New/Templates/Second.md", targetFolderPath: "Notes", dateFormat: "YYYY-MM-DD", timeFormat: "HH" },
    ]);
    expect(f.contents.get(f.first)).toBe("body {{date}}");
    expect(f.settings().quickInput.templateId).toBe("0");
  });
  it("preflights every collision before moving any template or saving a new folder", async () => {
    const f = fixture(); f.folder("New"); const occupied = f.file("New/Second.md", "keep me");
    await expect(f.service.changeFolder("New")).rejects.toMatchObject({ code: "conflict", path: "New/Second.md" });
    expect(f.rename).not.toHaveBeenCalled(); expect(f.saveSettings).not.toHaveBeenCalled();
    expect(f.contents.get(occupied)).toBe("keep me"); expect(f.settings().templateStorageFolder).toBe("Old");
  });
  it("rejects two templates with the same filename rather than changing their generated titles", async () => {
    const f = fixture(); f.files.delete(f.second.path); f.second.path = "Elsewhere/{{date}}.md"; f.files.set(f.second.path, f.second);
    f.settings().noteTemplates[1]!.filePath = f.second.path;
    await expect(f.service.changeFolder("New")).rejects.toMatchObject({ code: "conflict" });
    expect(f.rename).not.toHaveBeenCalled(); expect(f.createFolder).not.toHaveBeenCalled();
  });
  it("rolls back a partial move and drains rename events before publishing the original folder", async () => {
    const f = fixture();
    f.rename.mockImplementationOnce(f.rename.getMockImplementation()!)
      .mockRejectedValueOnce(new Error("disk failed"));
    await expect(f.service.changeFolder("New")).rejects.toThrow("disk failed");
    expect(f.first.path).toBe("Old/{{date}}.md"); expect(f.second.path).toBe("Old/Second.md");
    expect(f.settings().noteTemplates.map((template) => template.filePath)).toEqual([f.first.path, f.second.path]);
    expect(f.settings().templateStorageFolder).toBe("Old");
  });
  it("keeps references to actual locations when a rollback also fails", async () => {
    const f = fixture(); const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const firstRename = f.rename.getMockImplementation()!;
    f.rename.mockImplementationOnce(firstRename).mockRejectedValueOnce(new Error("move failed")).mockRejectedValueOnce(new Error("rollback failed"));
    try {
      await expect(f.service.changeFolder("New")).rejects.toThrow("move failed");
      expect(f.first.path).toBe("New/{{date}}.md");
      expect(f.settings().noteTemplates[0]!.filePath).toBe(f.first.path);
      expect(f.settings().templateStorageFolder).toBe("Old");
    } finally { warning.mockRestore(); }
  });
  it("retains completed moves and their memory references after a failed final settings write, then allows retry", async () => {
    const f = fixture();
    f.saveSettings.mockImplementation(async (patch) => {
      Object.assign(f.settings(), mergeSettings(f.settings(), patch));
      if (patch.templateStorageFolder === "New") throw new Error("save failed");
    });
    await expect(f.service.changeFolder("New")).rejects.toThrow("save failed");
    expect(f.settings().templateStorageFolder).toBe("New"); expect(f.settings().noteTemplates[0]!.filePath).toBe(f.first.path);
    f.saveSettings.mockImplementation(async () => undefined);
    await f.service.changeFolder("New"); expect(f.rename).toHaveBeenCalledTimes(2);
    expect(f.saveSettings).toHaveBeenLastCalledWith({ templateStorageFolder: "New" });
  });
  it("serializes folder changes behind template creation and reads the latest registrations", async () => {
    const f = fixture(); let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const create = f.service.runExclusive(async () => {
      await barrier;
      const third = f.file("Old/Third.md");
      f.settings().noteTemplates.push({ ...f.settings().noteTemplates[0]!, id: "third", filePath: third.path });
    });
    const move = f.service.changeFolder("New");
    await Promise.resolve(); expect(f.rename).not.toHaveBeenCalled();
    release(); await create; await move;
    expect(f.settings().noteTemplates.map((template) => template.filePath)).toEqual(["New/{{date}}.md", "New/Second.md", "New/Third.md"]);
  });
  it.each([".hidden", "New/.hidden", "../outside", "a:b"])("rejects invalid or hidden storage %s without writes", async (path) => {
    const f = fixture(); await expect(f.service.changeFolder(path)).rejects.toMatchObject({ code: "invalid-folder" });
    expect(f.rename).not.toHaveBeenCalled(); expect(f.createFolder).not.toHaveBeenCalled(); expect(f.saveSettings).not.toHaveBeenCalled();
  });
  it("rejects missing references and read-only operation before filesystem writes", async () => {
    const f = fixture(); f.files.delete(f.second.path);
    await expect(f.service.changeFolder("New")).rejects.toMatchObject({ code: "missing-template" });
    f.assertWritable.mockImplementation(() => { throw new Error("read-only"); });
    await expect(f.service.changeFolder("New")).rejects.toThrow("read-only");
    expect(f.rename).not.toHaveBeenCalled(); expect(f.createFolder).not.toHaveBeenCalled();
  });
  it("collects scattered legacy templates even when applying the current default folder", async () => {
    const f = fixture(); f.settings().templateStorageFolder = "New";
    await f.service.changeFolder("New"); expect(f.rename).toHaveBeenCalledTimes(2);
  });
});
