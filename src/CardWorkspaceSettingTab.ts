import { PluginSettingTab, Setting, type App } from "obsidian";
import {
  getCardCornerRadiusOptions,
  getDefaultCardOpenBehaviorOptions,
  getDragInsertActionOptions,
  getSettingTabStrings,
} from "./i18n";
import {
  PREVIEW_LINES_MAX,
  PREVIEW_LINES_MIN,
  isCardCornerRadius,
  isDefaultCardOpenBehavior,
  isDragInsertAction,
} from "./settings";
import type CardWorkspacePlugin from "./main";

export class CardWorkspaceSettingTab extends PluginSettingTab {
  private plugin: CardWorkspacePlugin;

  constructor(app: App, plugin: CardWorkspacePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const {
      cardCornerRadius,
      defaultCardOpenBehavior,
      dragInsertAction,
      enableFileExplorerFolderClicks,
      previewLines,
      showNavItemCounts,
    } = this.plugin.getSettings();
    const language = this.plugin.getUiLanguage();
    const strings = getSettingTabStrings(language);

    containerEl.empty();

    new Setting(containerEl)
      .setName(strings.enableFileExplorerFolderClicksName)
      .setDesc(strings.enableFileExplorerFolderClicksDesc)
      .addToggle((toggle) => {
        toggle.setValue(enableFileExplorerFolderClicks).onChange(async (value) => {
          await this.plugin.saveSettings({ enableFileExplorerFolderClicks: value });
        });
      });

    new Setting(containerEl)
      .setName(strings.defaultCardOpenBehaviorName)
      .setDesc(strings.defaultCardOpenBehaviorDesc)
      .addDropdown((dropdown) => {
        for (const option of getDefaultCardOpenBehaviorOptions(language)) {
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
      .setName(strings.dragInsertActionName)
      .setDesc(strings.dragInsertActionDesc)
      .addDropdown((dropdown) => {
        for (const option of getDragInsertActionOptions(language)) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown.setValue(dragInsertAction).onChange(async (value) => {
          if (!isDragInsertAction(value)) {
            return;
          }

          await this.plugin.saveSettings({ dragInsertAction: value });
        });
      });

    new Setting(containerEl)
      .setName(strings.cardCornerRadiusName)
      .setDesc(strings.cardCornerRadiusDesc)
      .addDropdown((dropdown) => {
        for (const option of getCardCornerRadiusOptions(language)) {
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
      .setName(strings.previewLinesName)
      .setDesc(strings.previewLinesDesc(PREVIEW_LINES_MIN, PREVIEW_LINES_MAX))
      .addSlider((slider) => {
        slider
          .setLimits(PREVIEW_LINES_MIN, PREVIEW_LINES_MAX, 1)
          .setValue(previewLines)
          .setDynamicTooltip()
          .onChange(async (value) => {
            await this.plugin.saveSettings({ previewLines: value });
          });
      });

    new Setting(containerEl)
      .setName(strings.showNavItemCountsName)
      .setDesc(strings.showNavItemCountsDesc)
      .addToggle((toggle) => {
        toggle.setValue(showNavItemCounts).onChange(async (value) => {
          await this.plugin.saveSettings({ showNavItemCounts: value });
        });
      });
  }
}
