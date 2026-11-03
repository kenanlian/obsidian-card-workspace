import { afterEach, describe, expect, it, vi } from "vitest";
import { IconActions } from "./icon-actions";
import { closeAllIconPickers, validateIconPickers } from "../../icon-picker/IconPicker";
import { iconTargetKey } from "../../icon-config";
import { getUiStrings } from "../../i18n";
import { migrateSettings, mergeSettings, type PartialPluginSettings } from "../../settings";
import { TFile, type Menu } from "obsidian";
import type { ViewContext } from "../view-context";

function fixture(device?: "desktop" | "phone") {
  const file = Object.assign(new TFile(), { path: "A.md" });
  const files = new Map([[file.path, file]]);
  const root = { path: "/", children: [] };
  let settings = migrateSettings({ noteTemplates: [{ id: "t", name: "Template", filePath: "Missing.md" }] });
  const anchor = document.createElement("button"); document.body.append(anchor);
  const saveSettings = vi.fn(async (patch: PartialPluginSettings) => { settings = mergeSettings(settings, patch); validateIconPickers(); });
  const notify = vi.fn();
  const context = { getSettings: () => settings, saveSettings, notify, getUiStrings: () => getUiStrings("en"),
    runtimePlatform: device ? { device } : undefined,
    getApp: () => ({ vault: { getName: () => "Vault", getRoot: () => root, getAbstractFileByPath: (path: string) => files.get(path) ?? null } }) } as unknown as ViewContext;
  const flush = vi.fn(async () => {});
  const actions = new IconActions(context, flush, () => anchor);
  return { file, files, anchor, actions, context, saveSettings, notify, flush, getSettings: () => settings };
}
function fakeMenu() {
  const entries: Array<{ title: string; icon: string; click?: () => void } | "separator"> = [];
  const menu = {
    addSeparator: () => { entries.push("separator"); return menu; },
    addItem: (build: (item: unknown) => void) => {
      const entry = { title: "", icon: "", click: undefined as (() => void) | undefined };
      const item = { setTitle: (title: string) => { entry.title = title; return item; }, setIcon: (icon: string) => { entry.icon = icon; return item; }, onClick: (click: () => void) => { entry.click = click; return item; } };
      build(item); entries.push(entry); return menu;
    },
  };
  return { menu: menu as unknown as Menu, entries };
}
const flushPromises = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
afterEach(() => { closeAllIconPickers(); document.body.replaceChildren(); });
describe("icon intent lifecycle", () => {
  it("opens and saves the vault root, whose host path is not its empty folder identity", async () => {
    const f = fixture();
    const picker = f.actions.open({ kind: "folder", ref: "" })!;
    expect(picker).not.toBeNull();
    validateIconPickers(); expect(picker.element.isConnected).toBe(true);
    await picker.select({ kind: "none", value: "" });
    expect(f.getSettings().iconOverrides[iconTargetKey({ kind: "folder", ref: "" })]).toEqual({ kind: "none", value: "" });
    expect(f.getSettings().recentIcons).toEqual([]);
  });
  it("closes a renamed file session before it can write to its old path", async () => {
    const f = fixture(); const picker = f.actions.open({ kind: "file", ref: "A.md" })!;
    f.files.delete("A.md"); f.file.path = "B.md"; f.files.set("B.md", f.file); validateIconPickers();
    expect(picker.element.isConnected).toBe(false);
    await picker.select({ kind: "emoji", value: "📕" });
    expect(f.saveSettings).not.toHaveBeenCalled();
    f.actions.dispose(); expect(f.actions.open({ kind: "file", ref: "B.md" })).toBeNull();
  });
  it("labels the picker with its target and closes after a choice, recording it as recent", async () => {
    const f = fixture();
    const picker = f.actions.open({ kind: "file", ref: "A.md" })!;
    expect(picker.element.querySelector(".fce-icon-picker-title")!.textContent).toBe("A");
    expect(picker.element.querySelector(".fce-icon-picker-subtitle")!.textContent).toBe("Markdown cards");
    await picker.select({ kind: "emoji", value: "📘" });
    expect(picker.element.isConnected).toBe(false);
    expect(f.getSettings().recentIcons).toEqual([{ kind: "emoji", value: "📘" }]);
    expect(f.flush).toHaveBeenCalledTimes(1);
  });
  it("preserves a missing registered template's independent icon but closes on rename or definition removal", async () => {
    const f = fixture();
    let picker = f.actions.open({ kind: "template", ref: "t" })!;
    await picker.select({ kind: "emoji", value: "📜" });
    expect(f.getSettings().iconOverrides[iconTargetKey({ kind: "template", ref: "t" })]).toEqual({ kind: "emoji", value: "📜" });
    picker = f.actions.open({ kind: "template", ref: "t" })!;
    await f.saveSettings({ noteTemplates: f.getSettings().noteTemplates.map(template => ({ ...template, name: "Renamed" })) });
    expect(picker.element.isConnected).toBe(false);
    picker = f.actions.open({ kind: "template", ref: "t" })!;
    await f.saveSettings({ noteTemplates: [] }); expect(picker.element.isConnected).toBe(false);
  });
  it("merges successive selections with the latest settings and resets only the target layer without a picker", async () => {
    const f = fixture();
    const target = { kind: "file", ref: "A.md" } as const;
    const picker = f.actions.open(target)!;
    const first = picker.select({ kind: "emoji", value: "📘" });
    const second = picker.select({ kind: "emoji", value: "📕" }); await Promise.all([first, second]);
    expect(picker.element.isConnected).toBe(false);
    expect(f.getSettings().recentIcons).toEqual([{ kind: "emoji", value: "📕" }, { kind: "emoji", value: "📘" }]);
    await f.saveSettings({ iconDefaults: { markdown: { kind: "lucide", value: "heart" } }, iconOverrides: { ...f.getSettings().iconOverrides, '["tag","work"]': { kind: "emoji", value: "🏷️" } } });
    await f.actions.reset(target);
    expect(f.getSettings().iconDefaults.markdown).toEqual({ kind: "lucide", value: "heart" });
    expect(f.getSettings().iconOverrides).toEqual({ '["tag","work"]': { kind: "emoji", value: "🏷️" } });
    expect(document.querySelector(".fce-icon-picker")).toBeNull();
    const saves = f.saveSettings.mock.calls.length;
    await f.actions.reset(target); expect(f.saveSettings).toHaveBeenCalledTimes(saves);
  });
  it("reports a failed reset instead of failing silently", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = fixture();
    await f.saveSettings({ iconOverrides: { '["file","A.md"]': { kind: "emoji", value: "📘" } } });
    f.flush.mockRejectedValueOnce(new Error("disk"));
    await f.actions.reset({ kind: "file", ref: "A.md" });
    expect(f.notify).toHaveBeenCalledWith(getUiStrings("en").icons.error);
  });
  it("offers removal in the menu only for a customized target, and removes directly", async () => {
    const f = fixture();
    const target = { kind: "file", ref: "A.md" } as const;
    let { menu, entries } = fakeMenu();
    expect(f.actions.appendMenu(menu, target)).toBe(true);
    expect(entries.map(entry => entry === "separator" ? entry : entry.title)).toEqual(["Change icon"]);
    expect(f.actions.appendMenu(menu, target, undefined, undefined, { separatorBefore: true })).toBe(false);
    await f.saveSettings({ iconOverrides: { '["file","A.md"]': { kind: "emoji", value: "📘" } } });
    ({ menu, entries } = fakeMenu());
    f.actions.appendMenu(menu, target, undefined, undefined, { separatorBefore: true });
    expect(entries.map(entry => entry === "separator" ? entry : entry.title)).toEqual(["separator", "Change icon", "Remove custom icon"]);
    (entries[2] as { click: () => void }).click(); await flushPromises();
    expect(f.getSettings().iconOverrides).toEqual({});
    expect(document.querySelector(".fce-icon-picker")).toBeNull();
  });
  it("toggles closed when the same icon is clicked again and uses a sheet on phones", () => {
    const f = fixture("phone");
    const picker = f.actions.open({ kind: "file", ref: "A.md" }, f.anchor)!;
    expect(picker.element.classList.contains("is-sheet")).toBe(true);
    expect(document.activeElement).not.toBe(picker.element.querySelector("input"));
    expect(f.actions.open({ kind: "file", ref: "A.md" }, f.anchor)).toBeNull();
    expect(picker.element.isConnected).toBe(false);
  });
});
