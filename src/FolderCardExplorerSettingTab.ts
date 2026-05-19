import { PluginSettingTab, Setting, type App } from "obsidian";
import {
  CARD_CORNER_RADIUS_OPTIONS,
  DEFAULT_CARD_OPEN_BEHAVIOR_OPTIONS,
  PREVIEW_LINES_MAX,
  PREVIEW_LINES_MIN,
  isCardCornerRadius,
  isDefaultCardOpenBehavior,
} from "./settings";
import type FolderCardExplorerPlugin from "./main";

export class FolderCardExplorerSettingTab extends PluginSettingTab {
  private plugin: FolderCardExplorerPlugin;

  constructor(app: App, plugin: FolderCardExplorerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const {
      cardCornerRadius,
      defaultCardOpenBehavior,
      enableFileExplorerFolderClicks,
      previewLines,
    } = this.plugin.getSettings();

    containerEl.empty();

    new Setting(containerEl)
      .setName("Open cards from File Explorer folder clicks")
      .setDesc("When enabled, clicking a folder in Obsidian's File Explorer opens that folder in Card Workspace.")
      .addToggle((toggle) => {
        toggle.setValue(enableFileExplorerFolderClicks).onChange(async (value) => {
          await this.plugin.saveSettings({ enableFileExplorerFolderClicks: value });
        });
      });

    new Setting(containerEl)
      .setName("Default card open behavior")
      .setDesc("Choose what happens when you click a card directly. Right-click menu actions stay available separately.")
      .addDropdown((dropdown) => {
        for (const option of DEFAULT_CARD_OPEN_BEHAVIOR_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown.setValue(defaultCardOpenBehavior).onChange(async (value) => {
          if (!isDefaultCardOpenBehavior(value)) {
            return;
          }

          await this.plugin.saveSettings({ defaultCardOpenBehavior: value });
        });
      });

    new Setting(containerEl)
      .setName("Card corner radius")
      .setDesc("Adjust how square or rounded each card border feels in the panel.")
      .addDropdown((dropdown) => {
        for (const option of CARD_CORNER_RADIUS_OPTIONS) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown.setValue(cardCornerRadius).onChange(async (value) => {
          if (!isCardCornerRadius(value)) {
            return;
          }

          await this.plugin.saveSettings({ cardCornerRadius: value });
        });
      });

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
