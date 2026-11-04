import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem, SettingDefinitionPage } from "obsidian";
import { MockEl, Setting, SettingGroup, Notice, groupsIn, settingsIn } from "./__mocks__/obsidian-modal-mock";

const mockState = vi.hoisted(() => {
  class MockPluginSettingTab {
    app: unknown;
    plugin: unknown;
    refreshDomState = vi.fn();
    settingItems: unknown[] = [];
    update = vi.fn(() => {
      this.settingItems = (this as unknown as { getSettingDefinitions(): unknown[] }).getSettingDefinitions();
    });
    containerEl = new MockEl();

    constructor(app: unknown, plugin: unknown) {
      this.app = app;
      this.plugin = plugin;
    }
  }

  return { MockPluginSettingTab, requireApiVersion: vi.fn(() => true) };
});

vi.mock("obsidian", async () => ({
  ...await import("./__mocks__/obsidian-modal-mock"),
  PluginSettingTab: mockState.MockPluginSettingTab,
  requireApiVersion: mockState.requireApiVersion,
}));

vi.mock("./view/folder-input-suggest", () => ({ attachFolderInputSuggest: vi.fn(() => ({ isOpen: () => false, close: vi.fn(), dispose: vi.fn() })) }));
vi.mock("./view/metadata-input-suggest", () => ({ onPlainEnter: vi.fn() }));

vi.mock("./icon-picker/IconPicker", () => ({
  IconPicker: class { close(_restoreFocus: boolean) {} },
  closeIconPickerForAnchor: vi.fn(() => false),
}));

import { IconPicker } from "./icon-picker/IconPicker";
import { NavigationVisibilityModal } from "./view/modals/NavigationVisibilityModal";
import { QuickInputShortcut } from "./input/QuickInputShortcut";
import { CardWorkspaceSettingTab } from "./CardWorkspaceSettingTab";
import { getSettingTabStrings, getUiStrings } from "./i18n";
import { attachFolderInputSuggest } from "./view/folder-input-suggest";

interface PluginStub {
  quickInputShortcut: Pick<QuickInputShortcut, "apply" | "subscribe">;
  getSettings: ReturnType<typeof vi.fn<() => Record<string, unknown>>>;
  saveSettings: ReturnType<typeof vi.fn<(patch: Record<string, unknown>) => Promise<unknown>>>;
  getUiLanguage: ReturnType<typeof vi.fn<() => string>>;
  runtimePlatform?: { device: string; capabilities: { quickInput?: boolean; newWindow?: boolean } };
  flushSettings: ReturnType<typeof vi.fn>;
  changeTemplateStorageFolder: ReturnType<typeof vi.fn<(path: string) => Promise<void>>>;
}

function createPlugin(
  settings: Record<string, unknown> = {},
  language = "en",
): PluginStub {
  return {
    quickInputShortcut: { apply: vi.fn(async () => {}), subscribe: (listener) => { listener({ active: [], pending: false, error: null }); return () => {}; } },
    getSettings: vi.fn(() => ({
      hiddenNavSections: [], hiddenFolderPaths: [], hiddenTagPaths: [], fileVisibility: "supported",
      cardCornerRadius: "medium",
      uiFontSize: "default", uiDensity: "default", cardStyle: "default", cardBackgroundColor: "theme",
      defaultCardOpenBehavior: "split-right",
      locateLinkCardOnOpen: false,
      dragInsertAction: "embed",
      enableHeadingDragInsert: false,
      newNoteTemplate: "blank",
      boxNewNoteFolderPath: "",
      quickInput: { folderPath: "", insertPosition: "end", duplicateTitle: "ask" }, noteTemplates: [],
      quickInputGlobalShortcut: "", quickInputWidth: 480, quickInputHeight: 400, quickInputColor: "random", quickInputCornerRadius: "rounded",
      previewLines: 6,
      backlinkSnippetCount: 3,
      searchPreviewSnippetCount: 2,
      hoverPreviewWidth: 600,
      hoverPreviewHeight: 400,
      showNavItemCounts: false,
      cardImageMode: "off",
      cardImageFit: "contain",
      ...settings,
    })),
    saveSettings: vi.fn(async () => undefined),
    getUiLanguage: vi.fn(() => language),
    flushSettings: vi.fn(async () => {}),
    changeTemplateStorageFolder: vi.fn(async () => undefined),
  };
}

function createTab(plugin: PluginStub = createPlugin()) {
  return new CardWorkspaceSettingTab({} as never, plugin as never);
}

function pagesOf(tab: CardWorkspaceSettingTab): SettingDefinitionPage[] {
  return tab.getSettingDefinitions() as SettingDefinitionPage[];
}
function rowsOfPage(tab: CardWorkspaceSettingTab, name: string): SettingDefinition[] {
  const page = pagesOf(tab).find(page => page.name === name)!;
  return (page.items as SettingDefinitionGroup[]).flatMap(group => group.items ?? []) as SettingDefinition[];
}
function rowFor(tab: CardWorkspaceSettingTab, key: string): SettingDefinition {
  return pagesOf(tab).flatMap(page => rowsOfPage(tab, page.name)).find(row => row.control?.key === key || row.name === key)!;
}
function legacyOpen(tab: CardWorkspaceSettingTab, name: string): void {
  tab.display();
  settingsIn(tab.containerEl as unknown as MockEl).find(row => row.name === name)!.extraButtons[0]!.click();
}
function renderedRow(tab: CardWorkspaceSettingTab, name: string): Setting {
  return settingsIn(tab.containerEl as unknown as MockEl).find(row => row.name === name)!;
}

describe("settings pages", () => {
  beforeEach(() => { vi.clearAllMocks(); mockState.requireApiVersion.mockReturnValue(true); });

  it.each(["en", "zh"])("keeps all 60 settings in seven searchable declarative pages (%s)", language => {
    const plugin = createPlugin({}, language);
    const tab = createTab(plugin);
    const strings = getSettingTabStrings(language as "en" | "zh");
    const pages = pagesOf(tab);
    expect(pages.map(page => page.name)).toEqual(Object.values(strings.pages).map(page => page.name));
    expect(pages.map(page => rowsOfPage(tab, page.name).length)).toEqual([5, 8, 10, 4, 3, 13, 17]);
    const rows = pages.flatMap(page => rowsOfPage(tab, page.name));
    expect(new Set(rows.map(row => row.control?.key ?? row.name)).size).toBe(60);
    expect(pages.every(page => page.type === "page" && page.desc && page.items && !page.page)).toBe(true);
    expect(rows.every(row => row.name && row.searchable !== false)).toBe(true);
    expect(attachFolderInputSuggest).not.toHaveBeenCalled();
    expect(plugin.saveSettings).not.toHaveBeenCalled();
    expect(rowFor(tab, "fileVisibility").control).toMatchObject({ type: "dropdown", options: strings.fileVisibilityOptions });
    expect(rowsOfPage(tab, strings.pages.appearance.name).map(row => row.control?.key)).toEqual(["uiFontSize", "uiDensity", "cardStyle", "cardCornerRadius", "cardBackgroundColor"]);
    expect(rowsOfPage(tab, strings.pages.navigation.name).map(row => row.control?.key).slice(0, 8)).toEqual(["favorites", "folders", "tags", "properties", "boxes", "links", "templates"].map(id => `navSection:${id}`).concat("showNavItemCounts"));
    expect(rowsOfPage(tab, strings.pages["notes-templates"].name).map(row => row.name)).toEqual([strings.newNoteTemplateName, strings.boxNewNoteFolderName, getUiStrings(language as "en" | "zh").noteInput.templateStorageFolder]);
  });

  it.each(["phone", "tablet"])("preserves device filtering on %s", device => {
    const plugin = createPlugin();
    plugin.runtimePlatform = { device, capabilities: { newWindow: false } };
    const tab = createTab(plugin);
    expect(pagesOf(tab)).toHaveLength(7);
    const rows = pagesOf(tab).flatMap(page => rowsOfPage(tab, page.name));
    expect(rows).toHaveLength(55);
    for (const key of ["quickInputWidth", "quickInputHeight", "quickInputColor", "dragInsertAction"]) expect(rowFor(tab, key)).toBeUndefined();
    expect(rowFor(tab, "quickInputCornerRadius")).toBeDefined();
    expect(rowFor(tab, "defaultCardOpenBehavior").control).not.toHaveProperty("options.new-window");
    expect(pagesOf(tab).every(page => (page.items as SettingDefinitionGroup[]).every(group => group.items?.length))).toBe(true);
    plugin.runtimePlatform.capabilities.quickInput = false;
    expect(pagesOf(tab)).toHaveLength(6);
  });

  it.each(["en", "zh"])("renders the same groups and controls through legacy page navigation (%s)", language => {
    const tab = createTab(createPlugin({}, language));
    const pages = pagesOf(tab);
    mockState.requireApiVersion.mockReturnValue(false);
    expect(tab.getSettingDefinitions()).toEqual([]);
    for (const page of pages) {
      legacyOpen(tab, page.name);
      const groups = groupsIn(tab.containerEl as unknown as MockEl);
      const definitions = page.items as SettingDefinitionGroup[];
      expect(groups.map(group => group.heading)).toEqual(definitions.map(group => group.heading));
      definitions.forEach((definition, i) => {
        const rows = definition.items as SettingDefinition[];
        expect(groups[i]!.settings.map(row => row.name)).toEqual(rows.map(row => row.name));
        rows.forEach((row, j) => {
          const rendered = groups[i]!.settings[j]!;
          expect(rendered.desc).toBe(row.desc ?? "");
          if (row.control?.type === "slider") expect(rendered.sliders[0]).toMatchObject({ min: row.control.min, max: row.control.max, step: row.control.step });
          if (row.control?.type === "dropdown") expect(rendered.dropdowns[0]?.options).toEqual(Object.entries(row.control.options).map(([value, label]) => ({ value, label })));
        });
      });
    }
    tab.hide();
  });

  it("supports keyboard entry, restores landing scroll/focus and resets on reopen without writes", () => {
    const plugin = createPlugin(); const tab = createTab(plugin);
    mockState.requireApiVersion.mockReturnValue(false);
    tab.display();
    const container = tab.containerEl as unknown as MockEl;
    container.scrollTop = 123;
    const entry = renderedRow(tab, "Default icons").settingEl;
    const preventDefault = vi.fn();
    entry.dispatch("keydown", { key: " ", target: entry, preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(container.scrollTop).toBe(0);
    expect(settingsIn(container)).toHaveLength(18);
    settingsIn(container)[0]!.extraButtons[0]!.click();
    expect(container.scrollTop).toBe(123);
    expect(renderedRow(tab, "Default icons").settingEl.focused).toBe(true);
    tab.hide(); tab.display();
    expect(container.scrollTop).toBe(0);
    expect(settingsIn(container)).toHaveLength(7);
    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("updates conditional rows in place across separate pages", async () => {
    mockState.requireApiVersion.mockReturnValue(false);
    const plugin = createPlugin(); const settings = plugin.getSettings(); plugin.getSettings.mockReturnValue(settings);
    plugin.saveSettings.mockImplementation(async patch => Object.assign(settings, patch));
    const tab = createTab(plugin);
    legacyOpen(tab, "Interface appearance");
    const radius = renderedRow(tab, "Card corner radius");
    await tab.setControlValue("cardStyle", "list"); expect(radius.settingEl.style.display).toBe("none");
    await tab.setControlValue("cardStyle", "flat"); expect(radius.settingEl.style.display).toBe("");
    legacyOpen(tab, "Cards and previews");
    const fit = renderedRow(tab, "Image fit"); expect(fit.settingEl.style.display).toBe("none");
    await tab.setControlValue("cardImageMode", "right"); expect(fit.settingEl.style.display).toBe("");
    expect(renderedRow(tab, "Image fit")).toBe(fit);
    legacyOpen(tab, "Quick input");
    const append = renderedRow(tab, "Append position");
    await tab.setControlValue("quickInputDuplicateTitle", "number"); expect(append.settingEl.style.display).toBe("none");
    expect(tab.refreshDomState).not.toHaveBeenCalled();
    tab.hide();
  });

  it.each([false, true])("cleans custom rows on native teardown or legacy navigation exactly once (%s)", native => {
    const plugin = createPlugin(); const unsubscribe = vi.fn(); plugin.quickInputShortcut.subscribe = () => unsubscribe;
    const tab = createTab(plugin);
    let cleanup: void | (() => void);
    if (native) {
      const group = new SettingGroup(tab.containerEl as unknown as MockEl);
      cleanup = rowFor(tab, "Quick input folder").render!(new Setting(tab.containerEl as unknown as MockEl) as never, group as never);
      rowFor(tab, "Global quick input shortcut").render!(new Setting(tab.containerEl as unknown as MockEl) as never, group as never);
      if (cleanup) { cleanup(); cleanup(); }
    } else {
      mockState.requireApiVersion.mockReturnValue(false); legacyOpen(tab, "Quick input");
      settingsIn(tab.containerEl as unknown as MockEl)[0]!.extraButtons[0]!.click();
    }
    tab.hide(); tab.hide();
    expect(unsubscribe).toHaveBeenCalledOnce();
    for (const result of vi.mocked(attachFolderInputSuggest).mock.results) expect(result.value.dispose).toHaveBeenCalledOnce();
  });

  it("continues a pending template save after teardown without updating its old controls", async () => {
    const plugin = createPlugin({ templateStorageFolder: "Templates" });
    let resolve!: () => void;
    plugin.changeTemplateStorageFolder.mockImplementation(() => new Promise<void>(done => { resolve = done; }));
    const tab = createTab(plugin); legacyOpen(tab, "New notes and templates");
    const row = renderedRow(tab, "Template storage folder"); row.texts[0]!.type("New");
    const pending = row.buttons[0]!.click();
    expect(row.buttons[0]!.disabled).toBe(true);
    tab.hide(); resolve(); await pending;
    expect(row.buttons[0]!.disabled).toBe(true);
    expect(plugin.changeTemplateStorageFolder).toHaveBeenCalledExactlyOnceWith("New");
  });

  it.each([false, true])("preserves root folder input and explicit template apply (%s)", native => {
    const plugin = createPlugin(); const tab = createTab(plugin);
    const row = new Setting(tab.containerEl as unknown as MockEl);
    const group = new SettingGroup(tab.containerEl as unknown as MockEl);
    if (native) rowFor(tab, "Folder for new notes in card boxes").render!(row as never, group as never);
    else { mockState.requireApiVersion.mockReturnValue(false); legacyOpen(tab, "New notes and templates"); }
    const folder = native ? row : renderedRow(tab, "Folder for new notes in card boxes");
    expect(folder.texts[0]!.value).toBe("/"); folder.texts[0]!.type("Inbox");
    expect(plugin.saveSettings).toHaveBeenLastCalledWith({ boxNewNoteFolderPath: "Inbox" });
    folder.texts[0]!.type("/"); expect(plugin.saveSettings).toHaveBeenLastCalledWith({ boxNewNoteFolderPath: "" });
    tab.hide();
  });

  it("keeps explicit shortcut Apply/Clear and never registers while typing", async () => {
    const plugin = createPlugin(); const tab = createTab(plugin); legacyOpen(tab, "Quick input");
    const row = renderedRow(tab, "Global quick input shortcut"); row.texts[0]!.type("Control+Shift+Q");
    expect(plugin.quickInputShortcut.apply).not.toHaveBeenCalled();
    await row.buttons[0]!.click(); expect(plugin.quickInputShortcut.apply).toHaveBeenLastCalledWith("Control+Shift+Q");
    await row.buttons[1]!.click(); expect(plugin.quickInputShortcut.apply).toHaveBeenLastCalledWith("");
    tab.hide();
  });

  it("opens both navigation management dialogs only on request", () => {
    const opened = vi.spyOn(NavigationVisibilityModal.prototype, "open").mockImplementation(() => {});
    const tab = new CardWorkspaceSettingTab({ vault: { getRoot: () => ({ children: [] }), getMarkdownFiles: () => [] }, metadataCache: { getFileCache: vi.fn() } } as never, createPlugin() as never); legacyOpen(tab, "Navigation");
    expect(opened).not.toHaveBeenCalled();
    renderedRow(tab, "Hidden folders").buttons[0]!.click(); renderedRow(tab, "Hidden tags").buttons[0]!.click();
    expect(opened).toHaveBeenCalledTimes(2); opened.mockRestore(); tab.hide();
  });
  it("releases an open icon picker when returning from its page", () => {
    const close = vi.spyOn(IconPicker.prototype, "close");
    const tab = createTab(createPlugin({ iconDefaults: { folder: { kind: "none", value: "" } } }));
    legacyOpen(tab, "Default icons");
    const row = renderedRow(tab, "Folders");
    expect(row.buttons[0]!.buttonEl.textContent).toBe("No icon");
    row.buttons[0]!.click();
    settingsIn(tab.containerEl as unknown as MockEl)[0]!.extraButtons[0]!.click();
    tab.hide(); expect(close).toHaveBeenCalledExactlyOnceWith(false); close.mockRestore();
  });

  it("allows a failed template migration to be retried", async () => {
    const plugin = createPlugin({ templateStorageFolder: "Templates" });
    plugin.changeTemplateStorageFolder.mockRejectedValueOnce(new Error("disk"));
    const tab = createTab(plugin); legacyOpen(tab, "New notes and templates");
    const row = renderedRow(tab, "Template storage folder"); row.texts[0]!.type("New/Templates");
    expect(plugin.changeTemplateStorageFolder).not.toHaveBeenCalled();
    await row.buttons[0]!.click();
    expect(Notice.messages[Notice.messages.length - 1]).toContain("disk");
    expect(row.buttons[0]!.disabled).toBe(false);
    expect(row.texts[0]!.value).toBe("New/Templates");
    await row.buttons[0]!.click();
    expect(plugin.changeTemplateStorageFolder).toHaveBeenCalledTimes(2); tab.hide();
  });

  it("merges navigation and quick input changes against the latest settings", async () => {
    const plugin = createPlugin({ hiddenFolderPaths: ["Keep"], quickInputVisibility: { title: false, folder: true, boxes: false, tags: true, properties: true } });
    const settings = plugin.getSettings(); plugin.getSettings.mockReturnValue(settings);
    plugin.saveSettings.mockImplementation(async patch => Object.assign(settings, patch));
    const tab = createTab(plugin);
    for (const section of ["favorites", "folders", "tags", "properties", "boxes", "links", "templates"]) await tab.setControlValue(`navSection:${section}`, false);
    await tab.setControlValue("navSection:folders", true);
    expect(settings.hiddenNavSections).toEqual(["favorites", "tags", "properties", "boxes", "links", "templates"]);
    expect(settings.hiddenFolderPaths).toEqual(["Keep"]);
    await tab.setControlValue("quickInputVisibility.folder", false);
    expect(settings.quickInputVisibility).toEqual({ title: false, folder: false, boxes: false, tags: true, properties: true });
    await tab.setControlValue("quickInputFolderPath", "Inbox");
    await tab.setControlValue("quickInputDuplicateTitle", "number");
    await tab.setControlValue("quickInputInsertPosition", "start");
    expect(settings.quickInput).toEqual({ folderPath: "Inbox", duplicateTitle: "number", insertPosition: "start" });
  });

  it("preserves slider limits and displays legacy values inline", async () => {
    const tab = createTab();
    for (const [key, min, max, step] of [["previewLines", 0, 8, 1], ["searchPreviewSnippetCount", 1, 5, 1], ["hoverPreviewWidth", 320, 1600, 10], ["hoverPreviewHeight", 200, 1200, 10], ["quickInputWidth", 320, 1200, 10], ["quickInputHeight", 200, 800, 10]] as const) {
      expect(rowFor(tab, key).control).toMatchObject({ min, max, step });
    }
    mockState.requireApiVersion.mockReturnValue(false); legacyOpen(tab, "Cards and previews");
    const row = renderedRow(tab, "Preview lines");
    const label = row.controlEl.nodes.find(node => node instanceof MockEl && node.hasClass("fce-setting-slider-value")) as MockEl;
    expect(label.text).toBe("6"); await row.sliders[0]!.slide(8); expect(label.text).toBe("8"); tab.hide();
  });

  it("reads control values from the settings store only", () => {
    const tab = createTab();

    expect(tab.getControlValue("defaultCardOpenBehavior")).toBe("split-right");
    expect(tab.getControlValue("dragInsertAction")).toBe("embed");
    expect(tab.getControlValue("enableHeadingDragInsert")).toBe(false);
    expect(tab.getControlValue("newNoteTemplate")).toBe("blank");
    expect(tab.getControlValue("cardCornerRadius")).toBe("medium");
    expect(tab.getControlValue("uiFontSize")).toBe("default");
    expect(tab.getControlValue("uiDensity")).toBe("default");
    expect(tab.getControlValue("cardStyle")).toBe("default");
    expect(tab.getControlValue("previewLines")).toBe(6);
    expect(tab.getControlValue("backlinkSnippetCount")).toBe("3");
    expect(tab.getControlValue("searchPreviewSnippetCount")).toBe(2);
    expect(tab.getControlValue("showNavItemCounts")).toBe(false);
    expect(tab.getControlValue("locateLinkCardOnOpen")).toBe(false);
    expect(tab.getControlValue("cardImageMode")).toBe("off");
    expect(tab.getControlValue("cardImageFit")).toBe("contain");
    expect(tab.getControlValue("pinnedPaths")).toBeUndefined();
  });

  it("converts native reference count dropdown values and rejects unsupported options", async () => {
    const plugin = createPlugin(), tab = createTab(plugin);
    for (const count of ["1", "2", "3", "all"]) await tab.setControlValue("backlinkSnippetCount", count);
    for (const value of ["4", "0", "", 1, null]) await tab.setControlValue("backlinkSnippetCount", value);
    expect(plugin.saveSettings.mock.calls).toEqual([
      [{ backlinkSnippetCount: 1 }], [{ backlinkSnippetCount: 2 }], [{ backlinkSnippetCount: 3 }], [{ backlinkSnippetCount: "all" }],
    ]);
  });

  it("saves valid changes through the plugin and ignores values outside the schema", async () => {
    const plugin = createPlugin();
    const tab = createTab(plugin);

    await tab.setControlValue("defaultCardOpenBehavior", "new-window");
    await tab.setControlValue("dragInsertAction", "embed");
    await tab.setControlValue("enableHeadingDragInsert", true);
    await tab.setControlValue("enableHeadingDragInsert", "yes");
    await tab.setControlValue("newNoteTemplate", "blank");
    await tab.setControlValue("newNoteTemplate", "daily-note");
    await tab.setControlValue("cardCornerRadius", "rounded");
    await tab.setControlValue("uiFontSize", "x-large");
    await tab.setControlValue("uiFontSize", "huge");
    await tab.setControlValue("uiDensity", "compact");
    await tab.setControlValue("uiDensity", "dense");
    await tab.setControlValue("cardStyle", "accent-bar");
    await tab.setControlValue("cardStyle", "glass");
    for (const value of [0, 1, 2]) await tab.setControlValue("previewLines", value);
    await tab.setControlValue("previewLines", -1);
    await tab.setControlValue("previewLines", 4);
    await tab.setControlValue("previewLines", 99);
    await tab.setControlValue("previewLines", 4.5);
    await tab.setControlValue("searchPreviewSnippetCount", 5);
    for (const value of [0, 6, 2.5, "3", NaN]) await tab.setControlValue("searchPreviewSnippetCount", value);
    await tab.setControlValue("showNavItemCounts", true);
    await tab.setControlValue("showNavItemCounts", "yes");
    await tab.setControlValue("locateLinkCardOnOpen", true);
    await tab.setControlValue("cardImageFit", "cover");
    await tab.setControlValue("pinnedPaths", ["notes/a.md"]);

    expect(plugin.saveSettings.mock.calls).toEqual([
      [{ defaultCardOpenBehavior: "new-window" }],
      [{ dragInsertAction: "embed" }],
      [{ enableHeadingDragInsert: true }],
      [{ newNoteTemplate: "blank" }],
      [{ cardCornerRadius: "rounded" }],
      [{ uiFontSize: "x-large" }],
      [{ uiDensity: "compact" }],
      [{ cardStyle: "accent-bar" }],
      [{ previewLines: 0 }],
      [{ previewLines: 1 }],
      [{ previewLines: 2 }],
      [{ previewLines: 4 }],
      [{ searchPreviewSnippetCount: 5 }],
      [{ showNavItemCounts: true }],
      [{ locateLinkCardOnOpen: true }],
      [{ cardImageFit: "cover" }],
    ]);
  });

  it("re-evaluates row visibility only after the card image mode is saved", async () => {
    const plugin = createPlugin();
    const tab = createTab(plugin) as unknown as {
      refreshDomState: ReturnType<typeof vi.fn>;
      setControlValue: (key: string, value: unknown) => Promise<void>;
    };

    await tab.setControlValue("cardImageFit", "cover");
    await tab.setControlValue("previewLines", 5);
    expect(tab.refreshDomState).not.toHaveBeenCalled();

    await tab.setControlValue("cardImageMode", "right");
    expect(plugin.saveSettings).toHaveBeenLastCalledWith({ cardImageMode: "right" });
    expect(tab.refreshDomState).toHaveBeenCalledTimes(1);
    expect(mockState.requireApiVersion).toHaveBeenCalledWith("1.13.0");
  });

  it("skips native refresh on older hosts even when the method exists", async () => {
    mockState.requireApiVersion.mockReturnValue(false);
    const plugin = createPlugin();
    const tab = createTab(plugin) as unknown as {
      refreshDomState: ReturnType<typeof vi.fn>;
      setControlValue: (key: string, value: unknown) => Promise<void>;
    };

    await tab.setControlValue("cardImageMode", "right");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ cardImageMode: "right" });
    expect(mockState.requireApiVersion).toHaveBeenCalledWith("1.13.0");
    expect(tab.refreshDomState).not.toHaveBeenCalled();
  });
});
