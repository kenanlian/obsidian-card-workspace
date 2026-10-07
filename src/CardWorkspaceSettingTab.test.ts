import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SettingDefinition, SettingDefinitionGroup, SettingDefinitionItem } from "obsidian";
import { MockEl, groupsIn, settingsIn } from "./__mocks__/obsidian-modal-mock";

const mockState = vi.hoisted(() => {
  class MockPluginSettingTab {
    app: unknown;
    plugin: unknown;
    refreshDomState = vi.fn();
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

import { CardWorkspaceSettingTab } from "./CardWorkspaceSettingTab";

interface PluginStub {
  getSettings: ReturnType<typeof vi.fn<() => Record<string, unknown>>>;
  saveSettings: ReturnType<typeof vi.fn<(patch: Record<string, unknown>) => Promise<unknown>>>;
  getUiLanguage: ReturnType<typeof vi.fn<() => string>>;
}

function createPlugin(
  settings: Record<string, unknown> = {},
  language = "en",
): PluginStub {
  return {
    getSettings: vi.fn(() => ({
      cardCornerRadius: "medium",
      defaultCardOpenBehavior: "split-right",
      locateLinkCardOnOpen: false,
      dragInsertAction: "embed",
      enableHeadingDragInsert: false,
      newNoteTemplate: "blank",
      previewLines: 6,
      backlinkSnippetCount: 3,
      searchPreviewSnippetCount: 2,
      showNavItemCounts: false,
      cardImageMode: "off",
      cardImageFit: "contain",
      ...settings,
    })),
    saveSettings: vi.fn(async () => undefined),
    getUiLanguage: vi.fn(() => language),
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
    expect(definitions).toHaveLength(2);
    expect(behavior?.type).toBe("group");
    expect(behavior?.heading).toBe("Behavior");
    expect(appearance?.heading).toBe("Appearance");

    expect(rowsOf(behavior).map((row) => row.name)).toEqual([
      "Default card open behavior",
      "Jump to link location when opening a link card",
      "Card drag insert behavior",
      "Enable section drag insertion",
      "New note content",
    ]);
    expect(rowsOf(appearance).map((row) => row.name)).toEqual([
      "Card corner radius",
      "Preview lines",
      "Default backlink reference snippets",
      "Maximum search hit snippets in each card preview",
      "Card images",
      "Image fit",
      "Show item counts in navigation",
    ]);
  });

  it("binds each row to a persisted key with the expected option sets", () => {
    const [behavior, appearance] = groupsOf(createTab().getSettingDefinitions());
    const behaviorRows = rowsOf(behavior);
    const appearanceRows = rowsOf(appearance);

    expect(controlOf(behaviorRows[0])).toEqual({
      type: "dropdown",
      key: "defaultCardOpenBehavior",
      options: {
        smart: "Current pane / current tab",
        "new-tab": "Open in new tab",
        "split-right": "Open to the right",
        "new-window": "Open in new window",
      },
    });
    expect(controlOf(behaviorRows[1])).toEqual({ type: "toggle", key: "locateLinkCardOnOpen" });
    expect(controlOf(behaviorRows[2])).toEqual({
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
    expect(controlOf(behaviorRows[3])).toEqual({ type: "toggle", key: "enableHeadingDragInsert" });
    expect(controlOf(behaviorRows[4])).toEqual({
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
  });

  it("keeps descriptions on every row, including the Remember Cursor Position caveat", () => {
    const [behavior, appearance] = groupsOf(createTab().getSettingDefinitions());
    const rows = [...rowsOf(behavior), ...rowsOf(appearance)];

    expect(rows.every((row) => typeof row.desc === "string" && row.desc.length > 0)).toBe(true);
    expect(rowsOf(behavior)[1]?.desc).toContain("Remember Cursor Position");
    expect(rowsOf(appearance)[1]?.desc).toBe(
      "Choose how many normalized summary lines each card preview can show (0-8).",
    );
  });

  it("only offers the image fit row while card images are enabled", () => {
    const plugin = createPlugin({ cardImageMode: "off" });
    const tab = createTab(plugin);
    const fit = rowsOf(groupsOf(tab.getSettingDefinitions())[1])[5];
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
      "卡片默认打开方式",
      "双链卡片点击定位",
      "卡片拖拽插入行为",
      "启用章节拖拽插入",
      "新建笔记内容",
    ]);
    expect(rowsOf(appearance).map((row) => row.name)).toEqual([
      "卡片圆角",
      "预览行数",
      "反链默认显示的引用片段数",
      "每张卡片预览最多显示的命中片段",
      "卡片图片",
      "图片显示方式",
      "在导航栏显示条目计数",
    ]);
    expect(rowsOf(appearance)[3]?.desc).toBe("搜索时最多显示多少个正文命中片段，每个片段占两行。");
    expect(controlOf(rowsOf(behavior)[0])).toMatchObject({
      options: { smart: "当前窗格 / 当前标签页" },
    });
    expect(controlOf(rowsOf(behavior)[2])).toMatchObject({
      options: {
        ask: "每次弹框确认",
        wiki: "插入 wiki link",
        embed: "插入嵌入 link",
        content: "插入卡片内容",
        "title-content": "插入卡片标题&内容",
      },
    });
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
        if (control.type === "dropdown") {
          expect(setting.dropdowns[0]?.options).toEqual(Object.entries(control.options).map(([value, label]) => ({ value, label })));
          expect(setting.dropdowns[0]?.value).toBe(tab.getControlValue(control.key));
        } else if (control.type === "slider") {
          expect(setting.sliders[0]).toMatchObject({ min: control.min, max: control.max, step: control.step, value: tab.getControlValue(control.key), dynamicTooltip: true });
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
    const fit = rows[10]!, mode = rows[9]!;
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
    await rows[6]!.sliders[0]!.slide(8);
    await rows[6]!.sliders[0]!.slide(999);
    expect(settings.previewLines).toBe(8);
    const reloaded = createTab(plugin);
    reloaded.display();
    expect(settingsIn(reloaded.containerEl as unknown as MockEl)[10]?.dropdowns[0]?.value).toBe("cover");
    expect(settingsIn(reloaded.containerEl as unknown as MockEl)[6]?.sliders[0]?.value).toBe(8);
  });

  it("reads control values from the settings store only", () => {
    const tab = createTab();

    expect(tab.getControlValue("defaultCardOpenBehavior")).toBe("split-right");
    expect(tab.getControlValue("dragInsertAction")).toBe("embed");
    expect(tab.getControlValue("enableHeadingDragInsert")).toBe(false);
    expect(tab.getControlValue("newNoteTemplate")).toBe("blank");
    expect(tab.getControlValue("cardCornerRadius")).toBe("medium");
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
