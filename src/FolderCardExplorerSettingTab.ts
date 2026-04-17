import { PluginSettingTab, Setting, type App } from "obsidian";
import { PREVIEW_LINES_MAX, PREVIEW_LINES_MIN } from "./settings";
import type FolderCardExplorerPlugin from "./main";

export class FolderCardExplorerSettingTab extends PluginSettingTab {
  private plugin: FolderCardExplorerPlugin;

  constructor(app: App, plugin: FolderCardExplorerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const { previewLines } = this.plugin.getSettings();

    containerEl.empty();

    new Setting(containerEl)
      .setName("Preview lines")
      .setDesc(
        `Choose how many normalized summary lines each card preview can show (${PREVIEW_LINES_MIN}-${PREVIEW_LINES_MAX}).`,
      )
      .addSlider((slider) => {
        slider
          .setLimits(PREVIEW_LINES_MIN, PREVIEW_LINES_MAX, 1)
          .setValue(previewLines)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.saveSettings({ previewLines: value });
          });
      });
  }
}
