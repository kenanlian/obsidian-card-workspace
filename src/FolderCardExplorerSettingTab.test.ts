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

  class MockSetting {
    name = "";
    desc = "";
    slider: MockSliderComponent | null = null;
    dropdown: MockDropdownComponent | null = null;
    toggle: MockToggleComponent | null = null;

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

    addToggle(configure: (toggle: MockToggleComponent) => void): this {
      this.toggle = new MockToggleComponent();
      configure(this.toggle);
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

  it("renders the file explorer toggle, default open dropdown, and preview slider settings", () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "medium",
        defaultCardOpenBehavior: "split-right",
        enableFileExplorerFolderClicks: false,
        previewLines: 6,
      })),
      saveSettings: vi.fn(),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    expect(mockState.containerEl.empty).toHaveBeenCalledTimes(1);
    expect(mockState.settings).toHaveLength(4);
    expect(mockState.settings.map((setting) => setting.name)).toEqual([
      "Link File Explorer folder clicks to Card Workspace",
      "Default card open behavior",
      "Card corner radius",
      "Preview lines",
    ]);
    expect(mockState.settings[0]).toMatchObject({
      desc:
        "When enabled, clicking a folder in Obsidian's File Explorer also opens that folder in Card Workspace. Card Workspace itself still stays available from the sidebar and commands.",
    });
    expect(mockState.settings[0]?.toggle).toMatchObject({
      value: false,
    });
    expect(mockState.settings[1]?.dropdown).toMatchObject({
      value: "split-right",
      options: [
        { value: "smart", label: "Current pane / current tab" },
        { value: "new-tab", label: "Open in new tab" },
        { value: "split-right", label: "Open to the right" },
        { value: "new-window", label: "Open in new window" },
      ],
    });
    expect(mockState.settings[2]?.dropdown).toMatchObject({
      value: "medium",
      options: [
        { value: "compact", label: "Compact" },
        { value: "medium", label: "Softer" },
        { value: "rounded", label: "Rounded" },
      ],
    });
    expect(mockState.settings[3]?.slider).toMatchObject({
      min: 3,
      max: 10,
      step: 1,
      value: 6,
      dynamicTooltip: true,
    });
  });

  it("saves file explorer folder click toggle changes", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        enableFileExplorerFolderClicks: false,
        previewLines: 5,
      })),
      saveSettings: vi.fn(async () => undefined),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[0]?.toggle?.changeHandler?.(true);

    expect(plugin.saveSettings).toHaveBeenCalledWith({ enableFileExplorerFolderClicks: true });
  });

  it("saves defaultCardOpenBehavior changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        enableFileExplorerFolderClicks: false,
        previewLines: 5,
      })),
      saveSettings: vi.fn(async () => undefined),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[1]?.dropdown?.changeHandler?.("new-window");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ defaultCardOpenBehavior: "new-window" });
  });

  it("saves cardCornerRadius changes from the dropdown", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({
        cardCornerRadius: "compact",
        defaultCardOpenBehavior: "smart",
        enableFileExplorerFolderClicks: false,
        previewLines: 5,
      })),
      saveSettings: vi.fn(async () => undefined),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    await mockState.settings[2]?.dropdown?.changeHandler?.("rounded");

    expect(plugin.saveSettings).toHaveBeenCalledWith({ cardCornerRadius: "rounded" });
  });

});
