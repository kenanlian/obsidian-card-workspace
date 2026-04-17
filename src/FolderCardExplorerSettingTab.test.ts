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

  class MockSetting {
    name = "";
    desc = "";
    slider: MockSliderComponent | null = null;

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

  it("clears the container and renders the previewLines slider with 3..10 bounds", () => {
    const plugin = {
      getSettings: vi.fn(() => ({ previewLines: 6 })),
      saveSettings: vi.fn(),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    expect(mockState.containerEl.empty).toHaveBeenCalledTimes(1);
    expect(mockState.settings).toHaveLength(1);
    expect(mockState.settings[0]?.name).toBe("Preview lines");
    expect(mockState.settings[0]?.slider).toMatchObject({
      min: 3,
      max: 10,
      step: 1,
      value: 6,
      dynamicTooltip: true,
    });
  });

  it("persists previewLines through the plugin saveSettings seam", async () => {
    const plugin = {
      getSettings: vi.fn(() => ({ previewLines: 5 })),
      saveSettings: vi.fn(async () => undefined),
    };

    const tab = new FolderCardExplorerSettingTab({} as never, plugin as never);
    tab.display();

    const slider = mockState.settings[0]?.slider;
    expect(slider?.changeHandler).toBeTypeOf("function");

    await slider?.changeHandler?.(8);

    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(plugin.saveSettings).toHaveBeenCalledWith({ previewLines: 8 });
  });
});
