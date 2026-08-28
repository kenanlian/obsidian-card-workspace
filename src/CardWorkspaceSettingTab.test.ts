import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
  const settingTabs: unknown[] = [];
  const settings: MockSetting[] = [];
  const containerEl = {
    empty: vi.fn(),
  };

  class MockSliderComponent {
    min = 0;
    max = 0;
    step = 0;
    value = 0;
    dynamicTooltip = false;
    changeHandler: ((value: number) => Promise<void> | void) | null = null;

    setLimits(min: number, max: number, step: number): this {
      this.min = min;
      this.max = max;
      this.step = step;
      return this;
    }

    setValue(value: number): this {
      this.value = value;
      return this;
    }

    setDynamicTooltip(): this {
      this.dynamicTooltip = true;
      return this;
    }

    onChange(handler: (value: number) => Promise<void> | void): this {
      this.changeHandler = handler;
      return this;
    }
  }

  class MockDropdownComponent {
    options: Array<{ value: string; label: string }> = [];
    value = "";
    changeHandler: ((value: string) => Promise<void> | void) | null = null;

    addOption(value: string, label: string): this {
      this.options.push({ value, label });
      return this;
    }

    setValue(value: string): this {
      this.value = value;
      return this;
    }

    onChange(handler: (value: string) => Promise<void> | void): this {
      this.changeHandler = handler;
      return this;
    }
  }

  class MockToggleComponent {
    value = false;
    changeHandler: ((value: boolean) => Promise<void> | void) | null = null;

    setValue(value: boolean): this {
      this.value = value;
      return this;
    }

    onChange(handler: (value: boolean) => Promise<void> | void): this {
      this.changeHandler = handler;
      return this;
    }
  }

  class MockExtraButtonComponent {
    icon = "";
    tooltip = "";
    disabled = false;
    clickHandler: (() => Promise<void> | void) | null = null;

    setIcon(icon: string): this {
      this.icon = icon;
      return this;
    }

    setTooltip(tooltip: string): this {
      this.tooltip = tooltip;
      return this;
    }

    setDisabled(disabled: boolean): this {
      this.disabled = disabled;
      return this;
    }

    onClick(handler: () => Promise<void> | void): this {
      this.clickHandler = handler;
      return this;
    }
  }

  class MockButtonComponent {
    buttonText = "";
    disabled = false;
    clickHandler: (() => Promise<void> | void) | null = null;

    setButtonText(text: string): this {
      this.buttonText = text;
      return this;
    }

    setDisabled(disabled: boolean): this {
      this.disabled = disabled;
      return this;
    }

    onClick(handler: () => Promise<void> | void): this {
      this.clickHandler = handler;
      return this;
    }
  }

  class MockSetting {
    name = "";
    desc = "";
    heading = false;
    slider: MockSliderComponent | null = null;
    dropdown: MockDropdownComponent | null = null;
    toggle: MockToggleComponent | null = null;
    extraButtons: MockExtraButtonComponent[] = [];
    button: MockButtonComponent | null = null;

    constructor(_containerEl: unknown) {
      settings.push(this);
    }

    setName(name: string): this {
      this.name = name;
      return this;
    }

    setDesc(desc: string): this {
      this.desc = desc;
      return this;
    }

    setHeading(): this {
      this.heading = true;
      return this;
    }

    addSlider(configure: (slider: MockSliderComponent) => void): this {
      this.slider = new MockSliderComponent();
      configure(this.slider);
      return this;
    }

    addDropdown(configure: (dropdown: MockDropdownComponent) => void): this {
      this.dropdown = new MockDropdownComponent();
      configure(this.dropdown);
      return this;
    }

    addToggle(configure: (toggle: MockToggleComponent) => void): this {
      this.toggle = new MockToggleComponent();
      configure(this.toggle);
      return this;
    }

    addExtraButton(configure: (button: MockExtraButtonComponent) => void): this {
      const extra = new MockExtraButtonComponent();
      configure(extra);
      this.extraButtons.push(extra);
      return this;
    }

    addButton(configure: (button: MockButtonComponent) => void): this {
      this.button = new MockButtonComponent();
      configure(this.button);
      return this;
    }
  }

  class MockPluginSettingTab {
    app: unknown;
    plugin: unknown;
    containerEl = containerEl;

    constructor(app: unknown, plugin: unknown) {
      this.app = app;
      this.plugin = plugin;
      settingTabs.push(this);
    }
  }

  return {
    MockPluginSettingTab,
    MockSetting,
    containerEl,
    settings,
    settingTabs,
  };
});

vi.mock("obsidian", () => {
  return {
    PluginSettingTab: mockState.MockPluginSettingTab,
    Setting: mockState.MockSetting,
  };
});

import { CardWorkspaceSettingTab } from "./CardWorkspaceSettingTab";

const DEFAULT_NAV_SECTION_ORDER = ["favorites", "folders", "tags", "boxes"];

function sectionRows() {
  return mockState.settings.filter((setting) => setting.extraButtons.length === 2);
}

describe("CardWorkspaceSettingTab", () => {
  beforeEach(() => {
    mockState.settings.length = 0;
    vi.clearAllMocks();
  });

  it("renders the card behavior dropdowns, preview slider, and navigation toggle", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    expect(mockState.containerEl.empty).toHaveBeenCalledTimes(1);
    expect(mockState.settings).toHaveLength(12);
    expect(mockState.settings.map((setting) => setting.name)).toEqual([
      "Default card open behavior",
      "Card drag insert behavior",
      "New note content",
      "Card corner radius",
      "Preview lines",
      "Show item counts in navigation",
      "Navigation section order",
      "Favorites",
      "Folders",
      "Tags",
      "Boxes",
      "",
    ]);
    expect(mockState.settings[0]?.dropdown).toMatchObject({
      value: "split-right",
      options: [
        { value: "smart", label: "Current pane / current tab" },
        { value: "new-tab", label: "Open in new tab" },
        { value: "split-right", label: "Open to the right" },
        { value: "new-window", label: "Open in new window" },
      ],
    });
    expect(mockState.settings[1]?.dropdown).toMatchObject({
      value: "embed",
      options: [
        { value: "ask", label: "Ask every time" },
        { value: "wiki", label: "Insert wiki link" },
        { value: "embed", label: "Insert embed link" },
        { value: "content", label: "Insert card content" },
        { value: "title-content", label: "Insert card title & content" },
      ],
    });
    expect(mockState.settings[2]?.dropdown).toMatchObject({
      value: "blank",
      options: [
        { value: "tags-frontmatter", label: "Start with a tags property" },
        { value: "blank", label: "Start blank" },
      ],
    });
    expect(mockState.settings[3]?.dropdown).toMatchObject({
      value: "medium",
      options: [
        { value: "compact", label: "Compact" },
        { value: "medium", label: "Softer" },
        { value: "rounded", label: "Rounded" },
      ],
    });
    expect(mockState.settings[4]?.slider).toMatchObject({
      min: 3,
      max: 8,
      step: 1,
      value: 6,
      dynamicTooltip: true,
    });
    expect(mockState.settings[5]?.toggle).toMatchObject({
      value: false,
    });
    expect(mockState.settings[11]?.button?.buttonText).toBe("Restore default order");
  });

  it("renders Chinese labels when the Obsidian language is Chinese", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "tags-frontmatter",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(),
      getUiLanguage: vi.fn(() => "zh"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    expect(mockState.settings.map((setting) => setting.name)).toEqual([
      "卡片默认打开方式",
      "卡片拖拽插入行为",
      "新建笔记内容",
      "卡片圆角",
      "预览行数",
      "在导航栏显示条目计数",
      "导航区分区顺序",
      "收藏",
      "文件夹",
      "标签",
      "卡片盒",
      "",
    ]);
    expect(mockState.settings[0]?.dropdown?.options[0]).toEqual({
      value: "smart",
      label: "当前窗格 / 当前标签页",
    });
    expect(mockState.settings[1]?.dropdown?.options).toEqual([
      { value: "ask", label: "每次弹框确认" },
      { value: "wiki", label: "插入 wiki link" },
      { value: "embed", label: "插入嵌入 link" },
      { value: "content", label: "插入卡片内容" },
      { value: "title-content", label: "插入卡片标题&内容" },
    ]);
    expect(mockState.settings[2]?.dropdown?.options).toEqual([
      { value: "tags-frontmatter", label: "带 tags 属性" },
      { value: "blank", label: "完全空白" },
    ]);
    expect(mockState.settings[11]?.button?.buttonText).toBe("恢复默认顺序");
  });

  it("saves defaultCardOpenBehavior changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        dragInsertAction: "ask",
        newNoteTemplate: "tags-frontmatter",
        previewLines: 5,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[0]?.dropdown?.changeHandler?.("new-window");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ defaultCardOpenBehavior: "new-window" });
  });

  it("saves dragInsertAction changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        dragInsertAction: "ask",
        newNoteTemplate: "tags-frontmatter",
        previewLines: 5,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[1]?.dropdown?.changeHandler?.("embed");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ dragInsertAction: "embed" });
  });

  it("saves newNoteTemplate changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        dragInsertAction: "ask",
        newNoteTemplate: "tags-frontmatter",
        previewLines: 5,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[2]?.dropdown?.changeHandler?.("blank");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ newNoteTemplate: "blank" });
  });

  it("ignores unsupported newNoteTemplate values from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        dragInsertAction: "ask",
        newNoteTemplate: "tags-frontmatter",
        previewLines: 5,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[2]?.dropdown?.changeHandler?.("daily-note");

    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("saves cardCornerRadius changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        dragInsertAction: "ask",
        newNoteTemplate: "tags-frontmatter",
        previewLines: 5,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[3]?.dropdown?.changeHandler?.("rounded");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ cardCornerRadius: "rounded" });
  });

  it("renders section rows in the persisted navigation order", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: ["boxes", "tags", "folders", "favorites"],
      })),
      saveSettings: vi.fn(),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    expect(sectionRows().map((setting) => setting.name)).toEqual([
      "Boxes",
      "Tags",
      "Folders",
      "Favorites",
    ]);
  });

  it("disables only the first-row up button and the last-row down button", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    const rows = sectionRows();
    expect(rows).toHaveLength(4);
    expect(rows.flatMap((row) => row.extraButtons.map((button) => button.disabled))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("saves the swapped order when the second row moves up", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await sectionRows()[1]?.extraButtons[0]?.clickHandler?.();

    expect(plugin.saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["folders", "favorites", "tags", "boxes"],
    });
  });

  it("does not save when a disabled end move still fires", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: DEFAULT_NAV_SECTION_ORDER,
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await sectionRows()[0]?.extraButtons[0]?.clickHandler?.();

    expect(plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("saves the default order when restore default is clicked", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: ["boxes", "tags", "folders", "favorites"],
      })),
      saveSettings: vi.fn(async () => undefined),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[11]?.button?.clickHandler?.();

    expect(plugin.saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["favorites", "folders", "tags", "boxes"],
    });
  });

  it("applies sequential moves correctly when clicks overlap an in-flight save", async () => {
    let stored: string[] = [...DEFAULT_NAV_SECTION_ORDER];
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: stored,
      })),
      // Mirrors SettingsStore.commitPatch: memory updates synchronously while the
      // returned promise still waits for persistence.
      saveSettings: vi.fn(async (patch: { navSectionOrder: string[] }) => {
        stored = patch.navSectionOrder;
      }),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    const tagsMoveUp = sectionRows()[2]?.extraButtons[0]?.clickHandler;
    await Promise.all([tagsMoveUp?.(), tagsMoveUp?.()]);

    expect(plugin.saveSettings.mock.calls.map((call) => call[0].navSectionOrder)).toEqual([
      ["favorites", "tags", "folders", "boxes"],
      ["tags", "favorites", "folders", "boxes"],
    ]);
    expect(stored).toEqual(["tags", "favorites", "folders", "boxes"]);
  });

  it("does not persist from a control that rendered disabled when an overlapping move frees it", async () => {
    let stored: string[] = [...DEFAULT_NAV_SECTION_ORDER];
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: stored,
      })),
      saveSettings: vi.fn(async (patch: { navSectionOrder: string[] }) => {
        stored = patch.navSectionOrder;
      }),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    // Favorites renders first, so its up control is disabled; Folders' up control is not.
    const favoritesMoveUp = sectionRows()[0]?.extraButtons[0]?.clickHandler;
    const foldersMoveUp = sectionRows()[1]?.extraButtons[0]?.clickHandler;
    await Promise.all([foldersMoveUp?.(), favoritesMoveUp?.()]);

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.saveSettings).toHaveBeenCalledWith({
      navSectionOrder: ["folders", "favorites", "tags", "boxes"],
    });
    expect(stored).toEqual(["folders", "favorites", "tags", "boxes"]);
  });

  it("renders four normalized section rows when the stored order is malformed", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        dragInsertAction: "embed",
        newNoteTemplate: "blank",
        previewLines: 6,
        showNavItemCounts: false,
        navSectionOrder: ["tags", "tags", "unknown", "boxes"],
      })),
      saveSettings: vi.fn(),
      getUiLanguage: vi.fn(() => "en"),
    };

    const tab = new CardWorkspaceSettingTab({} as never, plugin as never);
    tab.display();

    expect(sectionRows().map((setting) => setting.name)).toEqual([
      "Tags",
      "Boxes",
      "Favorites",
      "Folders",
    ]);
  });
});
