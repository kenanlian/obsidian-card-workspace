import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu, TFile, TFolder, type App } from "obsidian";
import { getUiStrings } from "../../i18n";
import { DEFAULT_SETTINGS, type PartialPluginSettings } from "../../settings";
import { NOTE_TEMPLATE_DATE_FORMATS, NOTE_TEMPLATE_TIME_FORMATS, type NoteTemplateDefinition } from "../../note-input";
import { TemplateActions } from "./template-actions";

const state = vi.hoisted(() => ({ folderChoose: null as null | ((folder: unknown) => void),
  close: null as null | (() => void),
  create: null as null | ((name: string, folder: string) => Promise<boolean>),
  fieldSave: null as null | ((value: string) => Promise<boolean>),
  fieldKind: "",
  formatPickers: [] as Array<{ formats: string[]; example: (format: string) => string; choose: (format: string) => void }> }));
vi.mock("obsidian", async (importOriginal) => ({ ...await importOriginal<object>(),
  moment: () => ({ format: (format: string) => `example:${format}` }) }));
vi.mock("../modals/TemplateFieldModal", () => ({ TemplateFieldModal: class {
  constructor(_app: unknown, _strings: unknown, _kind: string, _value: string, choose: (value: string) => Promise<boolean>) {
    state.fieldSave = choose; state.fieldKind = _kind;
    state.folderChoose = (folder) => { void choose((folder as { path: string }).path); };
  }
  open() {}
} }));
vi.mock("../modals/TemplateFormatPickerModal", () => ({ TemplateFormatPickerModal: class {
  constructor(_app: unknown, _title: string, formats: string[], example: (format: string) => string, choose: (format: string) => void) {
    state.formatPickers.push({ formats, example, choose });
  }
  open() {}
} }));
vi.mock("../modals/NewTemplateModal", () => ({ NewTemplateModal: class {
  constructor(_app: unknown, _strings: unknown, create: (name: string, folder: string) => Promise<boolean>, close: () => void) { state.create = create; state.close = close; }
  open() {}
} }));

function file(path: string): TFile {
  return Object.assign(new TFile(), { path, name: path.split("/").at(-1), extension: "md" });
}
function harness(templates: NoteTemplateDefinition[] = [], language: "en" | "zh" = "en") {
  const files = new Map<string, TFile | TFolder>();
  const root = Object.assign(new TFolder(), { path: "" }); files.set("", root);
  const folder = Object.assign(new TFolder(), { path: "Templates" }); files.set(folder.path, folder);
  const settings = structuredClone(DEFAULT_SETTINGS); settings.noteTemplates = templates; settings.templateStorageFolder = "Templates";
  const calls: string[] = [];
  const notify = vi.fn(), openNote = vi.fn(async () => { calls.push("open"); });
  const create = vi.fn(async (path: string) => { calls.push("create"); const created = file(path); files.set(path, created); return created; });
  const saveSettings = vi.fn(async (patch: PartialPluginSettings) => { calls.push("register"); Object.assign(settings, patch); });
  const release = vi.fn(() => { calls.push("release"); });
  const reserveTemplatePath = vi.fn((_path: string) => { calls.push("reserve"); return release; });
  const createFolder = vi.fn(async (path: string) => { files.set(path, Object.assign(new TFolder(), { path })); });
  const app = { vault: { getRoot: () => root, getAbstractFileByPath: (path: string) => files.get(path) ?? null, create, createFolder } } as unknown as App;
  const actions = new TemplateActions({ app, getSettings: () => settings, saveSettings, openNote, notify,
    reserveTemplatePath, getStrings: () => getUiStrings(language) });
  return { actions, settings, files, calls, create, createFolder, saveSettings, reserveTemplatePath, release, openNote, notify };
}
function template(path = "Templates/Daily.md"): NoteTemplateDefinition {
  return { id: "daily", filePath: path, targetFolderPath: null, dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm:ss" };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { state.create = null; state.folderChoose = null; state.formatPickers = []; });

describe("TemplateActions", () => {
  it.each(["en", "zh"] as const)("configures existing-note insertion per template in %s and preserves newer settings", async (language) => {
    const other = { ...template("Templates/Other.md"), id: "other" };
    const h = harness([template(), other], language);
    const strings = getUiStrings(language).noteInput;
    const menu = new Menu(); h.actions.appendMenu(menu, "daily");
    const items = (menu as unknown as { items: { title: string; disabled: boolean; checked: boolean; onClick?: () => void }[] }).items;
    expect(items.find((item) => item.title === strings.templateInsertPosition)?.disabled).toBe(true);
    expect(items.find((item) => item.title === strings.insertEnd)?.checked).toBe(true);
    expect(items.find((item) => item.title === strings.insertBodyStart)?.checked).toBe(false);
    h.settings.noteTemplates[0] = { ...h.settings.noteTemplates[0]!, dateFormat: "YYYY/MM/DD" };
    items.find((item) => item.title === strings.insertBodyStart)?.onClick?.(); await settle();
    expect(h.settings.noteTemplates).toEqual([{ ...template(), dateFormat: "YYYY/MM/DD", existingNoteInsertPosition: "start" }, other]);
    const updatedMenu = new Menu(); h.actions.appendMenu(updatedMenu, "daily");
    const updated = (updatedMenu as unknown as { items: { title: string; checked: boolean; onClick?: () => void }[] }).items;
    expect(updated.find((item) => item.title === strings.insertBodyStart)?.checked).toBe(true);
    expect(updated.find((item) => item.title === strings.insertEnd)?.checked).toBe(false);
    updated.find((item) => item.title === strings.insertEnd)?.onClick?.(); await settle();
    expect(h.settings.noteTemplates[0]?.existingNoteInsertPosition).toBe("end");
  });

  it("offers only new template creation in the header menu", async () => {
    const h = harness(); const menu = new Menu(); h.actions.appendHeaderMenu(menu);
    const items = (menu as unknown as { items: { title: string; onClick?: () => void }[] }).items;
    expect(items.map((item) => item.title)).toEqual([getUiStrings("en").noteInput.newTemplate]);
    items[0]?.onClick?.();
    expect(await state.create?.("Daily", "Templates")).toBe(true);
    expect(h.settings.noteTemplates[0]).toMatchObject({ name: "Daily", filePath: `Templates/${getUiStrings("en").noteInput.initialTemplateTitle}.md`,
      targetFolderPath: "Templates", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm:ss" });
  });
  it("reserves before create, registers the independent name and destination, then selects the initial title", async () => {
    const h = harness(); h.actions.newTemplate();
    expect(await state.create?.("Daily {{date}}.md", "Templates")).toBe(true);
    expect(h.calls).toEqual(["reserve", "create", "register", "release", "open"]);
    const strings = getUiStrings("en").noteInput;
    const path = `Templates/${strings.initialTemplateTitle}.md`;
    expect(h.create).toHaveBeenCalledWith(path, strings.initialTemplateBody + "\n");
    expect(h.settings.noteTemplates[0]).toMatchObject({ name: "Daily {{date}}.md", filePath: path, targetFolderPath: "Templates" });
    expect(h.openNote).toHaveBeenCalledWith(path, true);
  });
  it("keeps a reservation and created file across failed registration, retrying without a second create", async () => {
    const h = harness(); h.saveSettings.mockRejectedValueOnce(new Error("disk failed")); h.actions.newTemplate();
    expect(await state.create?.("Daily", "Templates")).toBe(false);
    expect(h.release).not.toHaveBeenCalled(); expect(h.openNote).not.toHaveBeenCalled();
    expect(await state.create?.("Daily", "Templates")).toBe(true);
    expect(h.create).toHaveBeenCalledTimes(1); expect(h.release).toHaveBeenCalledTimes(1);
  });
  it("retries a failed disk write after registration has already updated memory", async () => {
    const h = harness();
    h.saveSettings.mockImplementationOnce(async (patch) => { Object.assign(h.settings, patch); throw new Error("disk failed"); });
    h.actions.newTemplate();
    expect(await state.create?.("Daily", "Templates")).toBe(false);
    expect(h.settings.noteTemplates).toHaveLength(1);
    expect(await state.create?.("Daily", "Templates")).toBe(true);
    expect(h.saveSettings).toHaveBeenCalledTimes(2);
    expect(h.settings.noteTemplates).toHaveLength(1);
  });
  it("releases an abandoned failed-registration reservation on cancel", async () => {
    const h = harness(); h.saveSettings.mockRejectedValueOnce(new Error("disk failed")); h.actions.newTemplate();
    expect(await state.create?.("Daily", "Templates")).toBe(false);
    state.close?.(); expect(h.release).toHaveBeenCalledTimes(1);
  });
  it("validates the display name and existing note destination before reserving", async () => {
    const h = harness();  h.actions.newTemplate();
    expect(await state.create?.(" ", "Templates")).toBe(false);
    expect(await state.create?.("Valid", "Missing")).toBe(false);
    expect(await state.create?.("Valid", "../Bad")).toBe(false);
    expect(h.reserveTemplatePath).not.toHaveBeenCalled();
  });
  it("releases the reservation when vault creation fails", async () => {
    const h = harness(); h.create.mockRejectedValueOnce(new Error("cannot create")); h.actions.newTemplate();
    expect(await state.create?.("Daily", "Templates")).toBe(false);
    expect(h.release).toHaveBeenCalledTimes(1); expect(h.saveSettings).not.toHaveBeenCalled();
  });
  it("offers all live format examples, patches latest settings and unregisters without deleting", async () => {
    const h = harness([template()]); const source = file(template().filePath); h.files.set(source.path, source);
    const menu = new Menu(); h.actions.appendMenu(menu, "daily");
    const items = (menu as unknown as { items: { title: string; disabled: boolean; onClick?: () => void }[] }).items;
    items.find((item) => item.title === getUiStrings("en").noteInput.dateFormat)?.onClick?.();
    items.find((item) => item.title === getUiStrings("en").noteInput.timeFormat)?.onClick?.();
    expect(state.formatPickers.map((picker) => picker.formats)).toEqual([NOTE_TEMPLATE_DATE_FORMATS, NOTE_TEMPLATE_TIME_FORMATS]);
    expect(state.formatPickers[0]?.example("YYYY/MM/DD")).toBe("example:YYYY/MM/DD");
    state.formatPickers[0]?.choose("YYYY/MM/DD"); await settle();
    expect(h.settings.noteTemplates[0]?.dateFormat).toBe("YYYY/MM/DD");
    items.find((item) => item.title === getUiStrings("en").noteInput.targetFolder)?.onClick?.();
    state.folderChoose?.(h.files.get("")); await settle();
    expect(h.settings.noteTemplates[0]?.targetFolderPath).toBe("");
    items.find((item) => item.title === getUiStrings("en").noteInput.unregisterTemplate)?.onClick?.(); await settle();
    expect(h.settings.noteTemplates).toEqual([]); expect(h.files.get(source.path)).toBe(source);
  });
  it("disables missing template editing while keeping configuration and removal available", () => {
    const h = harness([template()]); const menu = new Menu(); h.actions.appendMenu(menu, "daily");
    const items = (menu as unknown as { items: { title: string; disabled: boolean }[] }).items;
    expect(items.find((item) => item.title === getUiStrings("en").noteInput.editTemplate)?.disabled).toBe(true);
    expect(items.find((item) => item.title === getUiStrings("en").noteInput.unregisterTemplate)?.disabled).toBe(false);
  });
});


it("creates the default storage folder and numbers initial titles without using the navigation label", async () => {
  const h = harness(); h.settings.templateStorageFolder = "Card Workspace Templates";
  h.actions.newTemplate(); expect(await state.create?.("Daily / work", "")).toBe(true);
  h.actions.newTemplate(); expect(await state.create?.("Daily / personal", "")).toBe(true);
  const title = getUiStrings("en").noteInput.initialTemplateTitle;
  expect(h.createFolder).toHaveBeenCalledExactlyOnceWith("Card Workspace Templates");
  expect(h.settings.noteTemplates.map((template) => template.filePath)).toEqual([
    `Card Workspace Templates/${title}.md`, `Card Workspace Templates/${title} 1.md`,
  ]);
  expect(h.settings.noteTemplates.map((template) => template.name)).toEqual(["Daily / work", "Daily / personal"]);
  expect(h.settings.noteTemplates.every((template) => template.targetFolderPath === "")).toBe(true);
});

it("renames only the navigation label and retains the file and generated title", async () => {
  const h = harness([template()]); const source = file(template().filePath); h.files.set(source.path, source);
  const menu = new Menu(); h.actions.appendMenu(menu, "daily");
  const items = (menu as unknown as { items: { title: string; onClick?: () => void }[] }).items;
  items.find((item) => item.title === getUiStrings("en").noteInput.renameTemplate)?.onClick?.();
  expect(state.fieldKind).toBe("name"); expect(await state.fieldSave?.("My daily template")).toBe(true);
  expect(h.settings.noteTemplates[0]).toEqual({ ...template(), name: "My daily template" });
  expect(source.path).toBe(template().filePath);
});
