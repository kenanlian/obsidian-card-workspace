import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem } from "obsidian";
import { MockEl, Setting, SettingGroup, groupsIn, settingsIn } from "./__mocks__/obsidian-modal-mock";

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

import { NavigationVisibilityModal } from "./view/modals/NavigationVisibilityModal";
import { QuickInputShortcut } from "./input/QuickInputShortcut";
import { CardWorkspaceSettingTab } from "./CardWorkspaceSettingTab";
import { getUiStrings } from "./i18n";
import { attachFolderInputSuggest } from "./view/folder-input-suggest";

interface PluginStub {
  quickInputShortcut: Pick<QuickInputShortcut, "apply" | "subscribe">;
  getSettings: ReturnType<typeof vi.fn<() => Record<string, unknown>>>;
  saveSettings: ReturnType<typeof vi.fn<(patch: Record<string, unknown>) => Promise<unknown>>>;
  getUiLanguage: ReturnType<typeof vi.fn<() => string>>;
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
      uiFontSize: "default", uiDensity: "default", cardStyle: "default",
      defaultCardOpenBehavior: "split-right",
      locateLinkCardOnOpen: false,
      dragInsertAction: "embed",
      enableHeadingDragInsert: false,
      newNoteTemplate: "blank",
      quickInput: { templateId: null, folderPath: "", insertPosition: "end" }, noteTemplates: [],
      quickInputGlobalShortcut: "", quickInputWidth: 480, quickInputHeight: 270, quickInputColor: "random",
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
    changeTemplateStorageFolder: vi.fn(async () => undefined),
  };
}

function createTab(plugin: PluginStub = createPlugin()) {
  return new CardWorkspaceSettingTab({} as never, plugin as never);
}

function groupsOf(definitions: SettingDefinitionItem[]): SettingDefinitionGroup[] {
  return definitions.filter(
    (definition): definition is SettingDefinitionGroup => "items" in definition,
  );
}

function rowsOf(group: SettingDefinitionGroup | undefined): SettingDefinition[] {
  return (group?.items ?? []).filter((item): item is SettingDefinition => !("items" in item));
}

function controlOf(row: SettingDefinition | undefined) {
  return row?.control;
}

describe("CardWorkspaceSettingTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.requireApiVersion.mockReturnValue(true);
  });

  it("describes the settings as two declarative groups with native controls", () => {
    const tab = createTab();
    const definitions = tab.getSettingDefinitions();

    const [behavior, appearance] = groupsOf(definitions);
    expect(definitions).toHaveLength(5);
    expect(behavior?.type).toBe("group");
    expect(behavior?.heading).toBe("Behavior");
    expect(appearance?.heading).toBe("Appearance");

    expect(rowsOf(behavior).map((row) => row.name)).toEqual([
      "Show file types",
      "Default card open behavior",
      "Jump to link location when opening a link card",
      "Card drag insert behavior",
      "Enable section drag insertion",
      "New note content",
    ]);
    expect(rowsOf(appearance).map((row) => row.name)).toEqual([
      "Font size",
      "Density",
      "Card style",
      "Card corner radius",
      "Preview lines",
      "Default backlink reference snippets",
      "Maximum search hit snippets in each card preview",
      "Card images",
      "Image fit",
      "Show item counts in navigation",
      "Card hover preview width",
      "Card hover preview height",
    ]);
  });

  it("binds each row to a persisted key with the expected option sets", () => {
    const [behavior, appearance] = groupsOf(createTab().getSettingDefinitions());
    const behaviorRows = rowsOf(behavior);
    const [fontSizeRow, densityRow, cardStyleRow, ...appearanceRows] = rowsOf(appearance);

    expect(controlOf(fontSizeRow)).toEqual({
      type: "dropdown",
      key: "uiFontSize",
      options: { small: "Small", default: "Default", large: "Large", "x-large": "Extra large" },
    });
    expect(controlOf(densityRow)).toEqual({
      type: "dropdown",
      key: "uiDensity",
      options: { compact: "Compact", default: "Default", comfortable: "Comfortable" },
    });
    expect(controlOf(cardStyleRow)).toEqual({
      type: "dropdown",
      key: "cardStyle",
      options: { default: "Default cards", outline: "Minimal outline", list: "List", flat: "Flat", "accent-bar": "Accent bar" },
    });

    expect(controlOf(behaviorRows[1])).toEqual({
      type: "dropdown",
      key: "defaultCardOpenBehavior",
      options: {
        smart: "Current pane / current tab",
        "new-tab": "Open in new tab",
        "split-right": "Open to the right",
        "new-window": "Open in new window",
      },
    });
    expect(controlOf(behaviorRows[2])).toEqual({ type: "toggle", key: "locateLinkCardOnOpen" });
    expect(controlOf(behaviorRows[3])).toEqual({
      type: "dropdown",
      key: "dragInsertAction",
      options: {
        ask: "Ask every time",
        wiki: "Insert wiki link",
        embed: "Insert embed link",
        content: "Insert card content",
        "title-content": "Insert card title & content",
      },
    });
    expect(controlOf(behaviorRows[4])).toEqual({ type: "toggle", key: "enableHeadingDragInsert" });
    expect(controlOf(behaviorRows[5])).toEqual({
      type: "dropdown",
      key: "newNoteTemplate",
      options: {
        "tags-frontmatter": "Start with a tags property",
        blank: "Start blank",
      },
    });

    expect(controlOf(appearanceRows[0])).toEqual({
      type: "dropdown",
      key: "cardCornerRadius",
      options: { compact: "Compact", medium: "Softer", rounded: "Rounded" },
    });
    expect(controlOf(appearanceRows[1])).toEqual({
      type: "slider",
      key: "previewLines",
      min: 0,
      max: 8,
      step: 1,
    });
    expect(controlOf(appearanceRows[2])).toEqual({ type: "dropdown", key: "backlinkSnippetCount", options: { "1": "1", "2": "2", "3": "3", all: "All" } });
    expect(controlOf(appearanceRows[3])).toEqual({
      type: "slider", key: "searchPreviewSnippetCount", min: 1, max: 5, step: 1,
    });
    expect(controlOf(appearanceRows[4])).toEqual({
      type: "dropdown",
      key: "cardImageMode",
      options: { off: "Off", right: "Right thumbnail", inline: "Below title" },
    });
    expect(controlOf(appearanceRows[5])).toEqual({
      type: "dropdown",
      key: "cardImageFit",
      options: { contain: "Show whole image", cover: "Crop to fill" },
    });
    expect(controlOf(appearanceRows[6])).toEqual({ type: "toggle", key: "showNavItemCounts" });
    expect(controlOf(appearanceRows[7])).toEqual({ type: "slider", key: "hoverPreviewWidth", min: 320, max: 1600, step: 10 });
    expect(controlOf(appearanceRows[8])).toEqual({ type: "slider", key: "hoverPreviewHeight", min: 200, max: 1200, step: 10 });
  });

  it("keeps descriptions on every row, including the Remember Cursor Position caveat", () => {
    const [behavior, appearance] = groupsOf(createTab().getSettingDefinitions());
    const rows = [...rowsOf(behavior), ...rowsOf(appearance)];

    expect(rows.every((row) => typeof row.desc === "string" && row.desc.length > 0)).toBe(true);
    expect(rowsOf(behavior)[2]?.desc).toContain("Remember Cursor Position");
    expect(rowsOf(appearance)[4]?.desc).toBe(
      "Choose how many normalized summary lines each card preview can show (0-8).",
    );
  });

  it("hides the corner radius row for the list card style", () => {
    const plugin = createPlugin({ cardStyle: "list" });
    const radius = rowsOf(groupsOf(createTab(plugin).getSettingDefinitions())[1])[3];
    const isVisible = radius?.visible as () => boolean;

    expect(radius?.control?.key).toBe("cardCornerRadius");
    expect(isVisible()).toBe(false);
    for (const cardStyle of ["default", "outline", "flat", "accent-bar"]) {
      plugin.getSettings.mockReturnValue({ cardStyle });
      expect(isVisible()).toBe(true);
    }
  });

  it("only offers the image fit row while card images are enabled", () => {
    const plugin = createPlugin({ cardImageMode: "off" });
    const tab = createTab(plugin);
    const fit = rowsOf(groupsOf(tab.getSettingDefinitions())[1])[8];
    const isVisible = fit?.visible as () => boolean;

    expect(isVisible()).toBe(false);
    plugin.getSettings.mockReturnValue({ cardImageMode: "right" });
    expect(isVisible()).toBe(true);
    plugin.getSettings.mockReturnValue({ cardImageMode: "inline" });
    expect(isVisible()).toBe(true);
  });

  it("renders Chinese labels when the Obsidian language is Chinese", () => {
    const tab = createTab(createPlugin({}, "zh"));
    const [behavior, appearance] = groupsOf(tab.getSettingDefinitions());

    expect(behavior?.heading).toBe("行为");
    expect(appearance?.heading).toBe("外观");
    expect(rowsOf(behavior).map((row) => row.name)).toEqual([
      "显示文件类型",
      "卡片默认打开方式",
      "双链卡片点击定位",
      "卡片拖拽插入行为",
      "启用章节拖拽插入",
      "新建笔记内容",
    ]);
    expect(rowsOf(appearance).map((row) => row.name)).toEqual([
      "字体大小",
      "紧凑程度",
      "卡片样式",
      "卡片圆角",
      "预览行数",
      "反链默认显示的引用片段数",
      "每张卡片预览最多显示的命中片段",
      "卡片图片",
      "图片显示方式",
      "在导航栏显示条目计数",
      "卡片悬浮预览宽度",
      "卡片悬浮预览高度",
    ]);
    expect(rowsOf(appearance)[6]?.desc).toBe("搜索时最多显示多少个正文命中片段，每个片段占两行。");
    expect(controlOf(rowsOf(appearance)[2])).toMatchObject({
      options: { default: "默认卡片", outline: "极简边框", list: "列表", flat: "扁平", "accent-bar": "左侧强调条" },
    });
    expect(controlOf(rowsOf(behavior)[1])).toMatchObject({
      options: { smart: "当前窗格 / 当前标签页" },
    });
    expect(controlOf(rowsOf(behavior)[3])).toMatchObject({
      options: {
        ask: "每次弹框确认",
        wiki: "插入 wiki link",
        embed: "插入嵌入 link",
        content: "插入卡片内容",
        "title-content": "插入卡片标题&内容",
      },
    });
  });

  it("binds all six visibility toggles to latest shared sections and preserves unrelated hidden rules", async () => {
    const plugin = createPlugin({ hiddenNavSections: ["folders"], hiddenFolderPaths: ["keep"] });
    const settings = plugin.getSettings();
    plugin.getSettings.mockReturnValue(settings);
    plugin.saveSettings.mockImplementation(async (patch) => { Object.assign(settings, patch); });
    const tab = createTab(plugin);
    const navigation = tab.getSettingDefinitions()[2]!;
    expect(navigation.heading).toBe("Navigation");
    expect(navigation.items).toHaveLength(9);
    for (const row of navigation.items.slice(0, 7)) {
      const key = row.control!.key;
      const section = key.slice("navSection:".length);
      expect(tab.getControlValue(key)).toBe(section !== "folders");
      await tab.setControlValue(key, false);
      expect(tab.getControlValue(key)).toBe(false);
    }
    expect(settings.hiddenNavSections).toEqual(["favorites", "folders", "tags", "properties", "boxes", "links", "templates"]);
    await tab.setControlValue("navSection:folders", true);
    expect(settings.hiddenNavSections).not.toContain("folders");
    expect(settings.hiddenFolderPaths).toEqual(["keep"]);
  });

  it.each([false, true])("opens both management dialogs through the shared render callbacks (native: %s)", (native) => {
    const opened = vi.spyOn(NavigationVisibilityModal.prototype, "open").mockImplementation(() => {});
    const getRoot = vi.fn(() => ({ children: [] }));
    const app = { vault: { getRoot, getMarkdownFiles: () => [] }, metadataCache: { getFileCache: vi.fn() } };
    const tab = new CardWorkspaceSettingTab(app as never, createPlugin() as never);
    if (native) {
      const group = new SettingGroup(tab.containerEl as unknown as MockEl);
      for (const row of tab.getSettingDefinitions()[2]!.items.slice(7)) {
        const setting = new Setting(tab.containerEl as unknown as MockEl);
        row.render!(setting as never, group as never);
        setting.buttons[0]?.click();
      }
    } else {
      tab.display();
      groupsIn(tab.containerEl as unknown as MockEl)[2]!.settings.slice(7).forEach((row) => row.buttons[0]?.click());
    }
    expect(opened).toHaveBeenCalledTimes(2);
    expect(getRoot).toHaveBeenCalledTimes(1);
    opened.mockRestore();
  });

  it.each(["en", "zh"])("renders identical legacy groups, order, controls and ranges in %s", (language) => {
    const tab = createTab(createPlugin({}, language));
    tab.display();
    const container = tab.containerEl as unknown as MockEl;
    const definitions = tab.getSettingDefinitions();
    const groups = groupsIn(container);
    expect(groups.map((group) => group.heading)).toEqual(definitions.map((group) => group.heading));
    definitions.forEach((definition, groupIndex) => {
      const settings = groups[groupIndex]!.settings;
      expect(settings.map((row) => row.name)).toEqual(definition.items.map((row) => row.name));
      expect(settings.map((row) => row.desc)).toEqual(definition.items.map((row) => row.desc));
      definition.items.forEach((row, index) => {
        const setting = settings[index]!, control = row.control;
        if (!control) {
          if (row.name === getUiStrings(language).noteInput.quickInputFolderName) {
            expect(setting.texts[0]?.value).toBe("/");
            expect(setting.dropdowns).toHaveLength(0);
          } else if (row.name === getUiStrings(language).noteInput.globalShortcutName) {
            expect(setting.texts).toHaveLength(1);
            expect(setting.buttons.map((button) => button.text)).toEqual([getUiStrings(language).noteInput.apply, getUiStrings(language).noteInput.clearShortcut]);
          } else {
            expect(setting.buttons[0]?.text).toBe(definition.heading === (language === "zh" ? "模板" : "Templates") ? (language === "zh" ? "应用" : "Apply") : (language === "zh" ? "管理" : "Manage"));
          }
          return;
        }
        if (control.type === "dropdown") {
          expect(setting.dropdowns[0]?.options).toEqual(Object.entries(control.options).map(([value, label]) => ({ value, label })));
          expect(setting.dropdowns[0]?.value).toBe(tab.getControlValue(control.key));
        } else if (control.type === "slider") {
          expect(setting.sliders[0]).toMatchObject({ min: control.min, max: control.max, step: control.step, value: tab.getControlValue(control.key), dynamicTooltip: false });
        } else {
          expect(setting.toggles[0]?.value).toBe(tab.getControlValue(control.key));
        }
      });
    });
  });

  it.each([false, true])("updates legacy visibility without refreshDomState or rebuilding controls (1.13 API: %s)", async (supportsNativeApi) => {
    mockState.requireApiVersion.mockReturnValue(supportsNativeApi);
    const plugin = createPlugin();
    const settings = plugin.getSettings();
    plugin.getSettings.mockImplementation(() => settings);
    plugin.saveSettings.mockImplementation(async (patch) => Object.assign(settings, patch));
    const tab = createTab(plugin);
    Object.defineProperty(tab, "refreshDomState", { value: undefined });
    tab.display();
    const container = tab.containerEl as unknown as MockEl;
    const rows = settingsIn(container);
    const fit = rows[14]!, mode = rows[13]!;
    expect(fit.settingEl.style.display).toBe("none");
    mode.dropdowns[0]!.select("inline");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fit.settingEl.style.display).toBe("");
    expect(settingsIn(container)).toEqual(rows);
    await tab.setControlValue("cardImageMode", "off");
    expect(fit.settingEl.style.display).toBe("none");
    await tab.setControlValue("cardImageFit", "cover");
    await rows[10]!.sliders[0]!.slide(8);
    await rows[10]!.sliders[0]!.slide(999);
    expect(settings.previewLines).toBe(8);
    const radius = rows[9]!, cardStyle = rows[8]!;
    expect(radius.settingEl.style.display).toBe("");
    cardStyle.dropdowns[0]!.select("list");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(radius.settingEl.style.display).toBe("none");
    const reloaded = createTab(plugin);
    reloaded.display();
    expect(settingsIn(reloaded.containerEl as unknown as MockEl)[14]?.dropdowns[0]?.value).toBe("cover");
    expect(settingsIn(reloaded.containerEl as unknown as MockEl)[10]?.sliders[0]?.value).toBe(8);
    expect(settingsIn(reloaded.containerEl as unknown as MockEl)[8]?.dropdowns[0]?.value).toBe("list");
  });

  it.each([false, true])("keeps slider values visible without deprecated tooltips (1.13 API: %s)", async (supportsNativeApi) => {
    mockState.requireApiVersion.mockReturnValue(supportsNativeApi);
    const plugin = createPlugin();
    const tab = createTab(plugin);
    tab.display();
    const row = settingsIn(tab.containerEl as unknown as MockEl).find((setting) => setting.name === "Preview lines")!;
    const slider = row.sliders[0]!;
    const labels = row.controlEl.nodes.filter((node): node is MockEl => node instanceof MockEl && node.classes.has("fce-setting-slider-value"));
    expect(slider.dynamicTooltip).toBe(false);
    expect(labels).toHaveLength(supportsNativeApi ? 0 : 1);
    if (!supportsNativeApi) expect(labels[0]!.text).toBe("6");
    await slider.slide(8);
    if (!supportsNativeApi) expect(labels[0]!.text).toBe("8");
    expect(plugin.saveSettings).toHaveBeenCalledWith({ previewLines: 8 });
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

  it.each([false, true])("saves hover dimensions through shared controls (1.13 API: %s)", async (native) => {
    mockState.requireApiVersion.mockReturnValue(native);
    const plugin = createPlugin(), tab = createTab(plugin);
    expect(tab.getControlValue("hoverPreviewWidth")).toBe(600);
    expect(tab.getControlValue("hoverPreviewHeight")).toBe(400);
    tab.display();
    const rows = settingsIn(tab.containerEl as unknown as MockEl);
    await rows.find((row) => row.name === "Card hover preview width")!.sliders[0]!.slide(800);
    await rows.find((row) => row.name === "Card hover preview height")!.sliders[0]!.slide(600);
    for (const value of ["600", NaN, Infinity, 0, 190, 1601, 600.5]) {
      await tab.setControlValue("hoverPreviewWidth", value);
      await tab.setControlValue("hoverPreviewHeight", value);
    }
    expect(plugin.saveSettings.mock.calls).toEqual([
      [{ hoverPreviewWidth: 800 }], [{ hoverPreviewHeight: 600 }],
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

describe("quick input shared setting definitions", () => {
  it("refreshes cached native template choices after creation, rename and removal", () => {
    mockState.requireApiVersion.mockReturnValue(true);
    const plugin = createPlugin();
    const settings = plugin.getSettings();
    plugin.getSettings.mockReturnValue(settings);
    const tab = createTab(plugin);
    tab.update(); // Native hosts cache definitions when registering the tab.
    const options = () => (tab.settingItems[3] as { items: { control: { options: Record<string, string> } }[] }).items[0]!.control.options;
    expect(Object.keys(options())).toEqual([""]);

    settings.noteTemplates = [{ id: "daily", name: "Daily input", filePath: "Templates/Daily.md" }];
    tab.refreshTemplateOptions();
    expect(options().daily).toBe("Daily input");
    settings.noteTemplates = [{ id: "daily", name: "Renamed input", filePath: "Templates/Daily.md" }];
    tab.refreshTemplateOptions();
    expect(options().daily).toBe("Renamed input");
    settings.quickInput = { templateId: "daily", folderPath: "", insertPosition: "end" };
    settings.noteTemplates = [];
    tab.refreshTemplateOptions();
    expect(options().daily).toBe("Template unavailable (daily)");
  });

  it("keeps legacy rendering usable when the native update API is unavailable", () => {
    mockState.requireApiVersion.mockReturnValue(false);
    const plugin = createPlugin();
    const settings = plugin.getSettings();
    plugin.getSettings.mockReturnValue(settings);
    const tab = createTab(plugin);
    Object.defineProperty(tab, "update", { value: undefined });
    settings.noteTemplates = [{ id: "daily", name: "Daily input", filePath: "Templates/Daily.md" }];
    expect(() => tab.refreshTemplateOptions()).not.toThrow();
    tab.display();
    expect(groupsIn(tab.containerEl as unknown as MockEl)[3]!.settings[0]!.dropdowns[0]!.options)
      .toContainEqual({ value: "daily", label: "Daily input" });
  });

  it("shows registered templates, retained missing choices and a custom folder input", () => {
    const tab = createTab(createPlugin({
      noteTemplates: [{ id: "daily", filePath: "Templates/Daily.md" }],
      quickInput: { templateId: "missing", folderPath: "Missing", insertPosition: "start" },
    }));
    const definitions = tab.getSettingDefinitions()[3]!;
    expect(definitions.heading).toBe("Quick input");
    expect(definitions.items[0]?.control).toMatchObject({ type: "dropdown", key: "quickInputTemplateId", options: { "": "No template", daily: "Daily.md", missing: "Template unavailable (missing)" } });
    expect(definitions.items[1]?.control).toBeUndefined();
    expect(definitions.items[1]?.render).toBeTypeOf("function");
    expect(tab.getControlValue("quickInputTemplateId")).toBe("missing");
    expect(tab.getControlValue("quickInputFolderPath")).toBe("Missing");
    expect(tab.getControlValue("quickInputInsertPosition")).toBe("start");
  });

  it.each([false, true])("saves typed and suggested folders through the shared renderer (native: %s)", async (native) => {
    vi.mocked(attachFolderInputSuggest).mockClear();
    const plugin = createPlugin({ quickInput: { templateId: null, folderPath: "Missing", insertPosition: "start" } });
    const settings = plugin.getSettings();
    plugin.getSettings.mockReturnValue(settings);
    plugin.saveSettings.mockImplementation(async (patch) => Object.assign(settings, patch));
    const tab = createTab(plugin);
    let row: Setting;
    if (native) {
      row = new Setting(tab.containerEl as unknown as MockEl);
      tab.getSettingDefinitions()[3]!.items[1]!.render!(row as never, new SettingGroup(tab.containerEl as unknown as MockEl) as never);
    } else {
      tab.display();
      row = groupsIn(tab.containerEl as unknown as MockEl)[3]!.settings[1]!;
    }
    const text = row.texts[0]!;
    expect(text.value).toBe("Missing");
    expect(row.dropdowns).toHaveLength(0);
    const binding = vi.mocked(attachFolderInputSuggest).mock.calls.find((call) => call[1] === text.inputEl as unknown)!;
    expect(binding).toBeDefined();
    text.type("Notes/Inbox");
    expect(plugin.saveSettings).toHaveBeenLastCalledWith({ quickInput: { templateId: null, folderPath: "Notes/Inbox", insertPosition: "start" } });
    binding[2]("Projects");
    expect(text.value).toBe("Projects");
    expect(plugin.saveSettings).toHaveBeenLastCalledWith({ quickInput: { templateId: null, folderPath: "Projects", insertPosition: "start" } });
    binding[2]("");
    expect(text.value).toBe("/");
    for (const value of ["", "/"]) {
      text.type(value);
      expect(plugin.saveSettings).toHaveBeenLastCalledWith({ quickInput: { templateId: null, folderPath: "", insertPosition: "start" } });
    }
    tab.hide();
    for (const result of vi.mocked(attachFolderInputSuggest).mock.results) {
      expect(result.value.dispose).toHaveBeenCalledOnce();
    }
  });

  it.each([false, true])("persists each quick input field against the latest config and updates folder and position visibility (native: %s)", async (native) => {
    mockState.requireApiVersion.mockReturnValue(native);
    const plugin = createPlugin({ quickInput: { templateId: "daily", folderPath: "Inbox", insertPosition: "end" } });
    const settings = plugin.getSettings();
    plugin.getSettings.mockReturnValue(settings);
    plugin.saveSettings.mockImplementation(async (patch) => Object.assign(settings, patch));
    const tab = createTab(plugin);
    const definitions = tab.getSettingDefinitions()[3]!.items;
    const isFolderVisible = definitions[1]!.visible as () => boolean;
    const isPositionVisible = definitions[2]!.visible as () => boolean;
    tab.display();
    const rows = groupsIn(tab.containerEl as unknown as MockEl)[3]!.settings;
    expect(isFolderVisible()).toBe(false);
    expect(isPositionVisible()).toBe(true);
    expect(rows[1]?.settingEl.style.display).toBe("none");
    expect(rows[2]?.settingEl.style.display).toBe("");
    await tab.setControlValue("quickInputTemplateId", "");
    expect(isFolderVisible()).toBe(true);
    expect(isPositionVisible()).toBe(false);
    expect(rows[1]?.settingEl.style.display).toBe("");
    expect(rows[2]?.settingEl.style.display).toBe("none");
    await tab.setControlValue("quickInputFolderPath", "Other");
    await tab.setControlValue("quickInputInsertPosition", "start");
    expect(settings.quickInput).toEqual({ templateId: null, folderPath: "Other", insertPosition: "start" });
    expect(plugin.saveSettings).toHaveBeenCalledTimes(3);
    await tab.setControlValue("quickInputInsertPosition", "middle");
    await tab.setControlValue("quickInputTemplateId", null);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(3);
    expect((tab as unknown as { refreshDomState: ReturnType<typeof vi.fn> }).refreshDomState).toHaveBeenCalledTimes(native ? 1 : 0);
  });

  it.each(["en", "zh"] as const)("declares %s window size sliders and a frame color dropdown", (language) => {
    const strings = getUiStrings(language).noteInput;
    const items = createTab(createPlugin({}, language)).getSettingDefinitions()[3]!.items;
    expect(items[3]).toMatchObject({ name: strings.quickInputWidthName,
      control: { type: "slider", key: "quickInputWidth", min: 320, max: 1200, step: 10 } });
    expect(items[4]).toMatchObject({ name: strings.quickInputHeightName,
      control: { type: "slider", key: "quickInputHeight", min: 200, max: 800, step: 10 } });
    expect(items[5]).toMatchObject({ name: strings.quickInputColorName, control: { type: "dropdown", key: "quickInputColor" } });
    expect(Object.keys((items[5]!.control as { options: Record<string, string> }).options)).toEqual(
      ["random", "accent", "red", "orange", "yellow", "green", "cyan", "blue", "purple", "pink"]);
    expect((items[5]!.control as { options: Record<string, string> }).options.random).toBe(strings.colorRandom);
  });

  it("reads and saves quick input size and color, ignoring out-of-range values", async () => {
    const plugin = createPlugin({ quickInputWidth: 600, quickInputHeight: 300, quickInputColor: "blue" }), tab = createTab(plugin);
    expect(tab.getControlValue("quickInputWidth")).toBe(600);
    expect(tab.getControlValue("quickInputHeight")).toBe(300);
    expect(tab.getControlValue("quickInputColor")).toBe("blue");
    await tab.setControlValue("quickInputWidth", 640);
    await tab.setControlValue("quickInputHeight", 360);
    await tab.setControlValue("quickInputColor", "accent");
    for (const value of ["600", NaN, 100, 5000, 600.5]) {
      await tab.setControlValue("quickInputWidth", value);
      await tab.setControlValue("quickInputHeight", value);
    }
    await tab.setControlValue("quickInputColor", "teal");
    expect(plugin.saveSettings.mock.calls).toEqual([
      [{ quickInputWidth: 640 }], [{ quickInputHeight: 360 }], [{ quickInputColor: "accent" }],
    ]);
  });
});


describe("template storage settings", () => {
  it.each(["en", "zh"])("explains automatic migration and applies the shared field in %s", async (language) => {
    const plugin = createPlugin({ templateStorageFolder: "Card Workspace Templates" }, language);
    const settings = plugin.getSettings(); plugin.getSettings.mockReturnValue(settings);
    plugin.changeTemplateStorageFolder.mockImplementation(async (path) => { settings.templateStorageFolder = path; });
    const tab = createTab(plugin);
    const definition = tab.getSettingDefinitions()[4]!;
    expect(definition.items[0]?.desc).toContain(language === "zh" ? "现有模板会自动迁移" : "moves existing templates");
    tab.display();
    const row = groupsIn(tab.containerEl as unknown as MockEl)[4]!.settings[0]!;
    expect(row.texts[0]!.value).toBe("Card Workspace Templates");
    row.texts[0]!.type("New/Templates");
    expect(plugin.changeTemplateStorageFolder).not.toHaveBeenCalled();
    await row.buttons[0]!.click();
    expect(plugin.changeTemplateStorageFolder).toHaveBeenCalledExactlyOnceWith("New/Templates");
    expect(row.texts[0]!.value).toBe("New/Templates");
    tab.hide();
  });
  it("displays a root storage selection explicitly instead of showing the default-folder placeholder", () => {
    const tab = createTab(createPlugin({ templateStorageFolder: "" })); tab.display();
    const row = groupsIn(tab.containerEl as unknown as MockEl)[4]!.settings[0]!;
    expect(row.texts[0]!.value).toBe("/"); tab.hide();
  });
  it("shows the independent template name in quick-input choices", () => {
    const tab = createTab(createPlugin({ noteTemplates: [{ id: "daily", name: "My daily template", filePath: "Templates/{{date}}.md" }] }));
    expect(tab.getSettingDefinitions()[3]!.items[0]!.control).toMatchObject({ options: { daily: "My daily template" } });
  });
});


describe("explicit global shortcut configuration", () => {
  it.each([false, true])("records without registration and shares Apply/Clear behavior (native: %s)", async (native) => {
    const registered = new Set<string>();
    const register = vi.fn((key: string) => { registered.add(key); return true; });
    const unregister = vi.fn((key: string) => { registered.delete(key); });
    const save = vi.fn(async (_key: string) => {});
    const shortcut = new QuickInputShortcut({ bridge: () => ({ register, unregister, isRegistered: (key) => registered.has(key) }), save, open: vi.fn() });
    const plugin = createPlugin(); plugin.quickInputShortcut = shortcut;
    const tab = createTab(plugin);
    const strings = getUiStrings("en").noteInput;
    let row: Setting;
    if (native) {
      row = new Setting(tab.containerEl as unknown as MockEl);
      tab.getSettingDefinitions()[3]!.items.find((item) => item.name === strings.globalShortcutName)!.render!(row as never, {} as never);
    } else { tab.display(); row = settingsIn(tab.containerEl as unknown as MockEl).find((item) => item.name === strings.globalShortcutName)!; }
    row.texts[0]!.type("Control+Shift+Q"); expect(register).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    row.buttons.find((button) => button.text === strings.apply)!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("Control+Shift+Q"));
    expect(registered.has("Control+Shift+Q")).toBe(true);
    row.buttons.find((button) => button.text === strings.clearShortcut)!.click();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(""));
    expect(unregister).toHaveBeenCalledExactlyOnceWith("Control+Shift+Q"); expect(registered.size).toBe(0);
    tab.hide(); shortcut.dispose();
  });
});


describe("quick input visibility settings", () => {
  it("shares five independent toggles and saves one field without resetting the others", async () => {
    const plugin = createPlugin(); const tab = createTab(plugin);
    const group = tab.getSettingDefinitions().find((entry) => entry.heading === getUiStrings("en").noteInput.quickInputHeading)!;
    const toggles = group.items.filter((entry) => entry.control?.key.startsWith("quickInputVisibility."));
    expect(toggles.map((entry) => entry.control?.key)).toEqual(["title", "folder", "boxes", "tags", "properties"].map((key) => `quickInputVisibility.${key}`));
    expect(toggles.map((entry) => entry.desc)).toEqual([getUiStrings("en").noteInput.visibilityDesc, "", "", "", ""]);
    expect(tab.getControlValue("quickInputVisibility.folder")).toBe(true);
    await tab.setControlValue("quickInputVisibility.title", true);
    expect(plugin.saveSettings).toHaveBeenLastCalledWith({ quickInputVisibility: { title: true, folder: true, boxes: false, tags: false, properties: false } });
  });
});
