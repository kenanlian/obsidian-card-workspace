import { PluginSettingTab, Setting, type App } from "obsidian";
import {
  getCardCornerRadiusOptions,
  getDefaultCardOpenBehaviorOptions,
  getDragInsertActionOptions,
  getNewNoteTemplateOptions,
  getSettingTabStrings,
  getToolbarStrings,
} from "./i18n";
import {
  defaultNavSectionOrder,
  moveNavSection,
  normalizeNavSectionOrder,
} from "./navigation-section-order";
import {
  PREVIEW_LINES_MAX,
  PREVIEW_LINES_MIN,
  isCardCornerRadius,
  isDefaultCardOpenBehavior,
  isDragInsertAction,
  isNewNoteTemplate,
} from "./settings";
import type CardWorkspacePlugin from "./main";
import type { NavSectionId } from "./view/types";

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
      newNoteTemplate,
      previewLines,
      showNavItemCounts,
      navSectionOrder,
    } = this.plugin.getSettings();
    const language = this.plugin.getUiLanguage();
    const strings = getSettingTabStrings(language);

    containerEl.empty();

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
      .setName(strings.newNoteTemplateName)
      .setDesc(strings.newNoteTemplateDesc)
      .addDropdown((dropdown) => {
        for (const option of getNewNoteTemplateOptions(language)) {
          dropdown.addOption(option.value, option.label);
        }

        dropdown.setValue(newNoteTemplate).onChange(async (value) => {
          if (!isNewNoteTemplate(value)) {
            return;
          }

          await this.plugin.saveSettings({ newNoteTemplate: value });
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

    const order = normalizeNavSectionOrder(navSectionOrder);
    const navPane = getToolbarStrings(language).navPane;
    const sectionLabels: Record<NavSectionId, string> = {
      favorites: navPane.favoritesSection,
      folders: navPane.foldersSection,
      tags: navPane.tagsSection,
      boxes: navPane.boxesSection,
    };

    new Setting(containerEl)
      .setName(strings.navSectionOrderName)
      .setDesc(strings.navSectionOrderDesc)
      .setHeading();

    for (const [index, section] of order.entries()) {
      const canMoveUp = index > 0;
      const canMoveDown = index < order.length - 1;
      new Setting(containerEl)
        .setName(sectionLabels[section])
        .addExtraButton((button) => {
          button
            .setIcon("arrow-up")
            .setTooltip(strings.navSectionOrderMoveUp)
            .setDisabled(!canMoveUp)
            .onClick(() => this.moveNavSectionFromCurrent(section, -1, canMoveUp));
        })
        .addExtraButton((button) => {
          button
            .setIcon("arrow-down")
            .setTooltip(strings.navSectionOrderMoveDown)
            .setDisabled(!canMoveDown)
            .onClick(() => this.moveNavSectionFromCurrent(section, 1, canMoveDown));
        });
    }

    new Setting(containerEl).addButton((button) => {
      button.setButtonText(strings.navSectionOrderReset).onClick(() => {
        return this.applyNavSectionOrder(defaultNavSectionOrder());
      });
    });
  }

  /**
   * Rows stay live until the awaited save resolves and display() re-renders. The swap
   * reads current settings so overlapping clicks compose, while `enabled` carries the
   * render-time affordance so a control that rendered disabled never persists.
   */
  private moveNavSectionFromCurrent(
    section: NavSectionId,
    delta: -1 | 1,
    enabled: boolean,
  ): Promise<void> {
    if (!enabled) return Promise.resolve();
    const current = this.plugin.getSettings().navSectionOrder;
    return this.applyNavSectionOrder(moveNavSection(current, section, delta));
  }

  private async applyNavSectionOrder(next: NavSectionId[] | null): Promise<void> {
    if (next === null) return;
    await this.plugin.saveSettings({ navSectionOrder: next });
    this.display();
  }
}
