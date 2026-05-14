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

  class MockSetting {
    name = "";
    desc = "";
    slider: MockSliderComponent | null = null;
    dropdown: MockDropdownComponent | null = null;

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

import { FolderCardExplorerSettingTab } from "./FolderCardExplorerSettingTab";

describe("FolderCardExplorerSettingTab", () => {
  beforeEach(() => {
    mockState.settings.length = 0;
    vi.clearAllMocks();
  });

  it("renders the default open dropdown and preview slider settings", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        previewLines: 6,
      })),
      saveSettings: vi.fn(),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    expect(mockState.containerEl.empty).toHaveBeenCalledTimes(1);
    expect(mockState.settings).toHaveLength(3);
    expect(mockState.settings.map((setting) => setting.name)).toEqual([
      "Default card open behavior",
      "Card corner radius",
      "Preview lines",
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
      value: "medium",
      options: [
        { value: "compact", label: "Compact" },
        { value: "medium", label: "Softer" },
        { value: "rounded", label: "Rounded" },
      ],
    });
    expect(mockState.settings[2]?.slider).toMatchObject({
      min: 3,
      max: 10,
      step: 1,
      value: 6,
      dynamicTooltip: true,
    });
  });

  it("saves defaultCardOpenBehavior changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        previewLines: 5,
      })),
      saveSettings: vi.fn(async () => undefined),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[0]?.dropdown?.changeHandler?.("new-window");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ defaultCardOpenBehavior: "new-window" });
  });

  it("saves cardCornerRadius changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        previewLines: 5,
      })),
      saveSettings: vi.fn(async () => undefined),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[1]?.dropdown?.changeHandler?.("rounded");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ cardCornerRadius: "rounded" });
  });

});
