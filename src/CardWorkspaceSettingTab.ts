import {
  PluginSettingTab, SettingGroup, requireApiVersion, type App, type Setting,
} from "obsidian";
import {
  getCardCornerRadiusOptions,
  getDefaultCardOpenBehaviorOptions,
  getDragInsertActionOptions,
  getNewNoteTemplateOptions,
  getUiStrings,
  getSettingTabStrings,
} from "./i18n";
import {
  PREVIEW_LINES_MAX,
  PREVIEW_LINES_MIN,
  SEARCH_PREVIEW_SNIPPET_COUNT_MIN,
  SEARCH_PREVIEW_SNIPPET_COUNT_MAX,
  isCardCornerRadius,
  isCardImageMode,
  isCardImageFit,
  isDefaultCardOpenBehavior,
  isDragInsertAction,
  isNewNoteTemplate,
  type PartialPluginSettings,
} from "./settings";
import { NavigationVisibilityModal } from "./view/modals/NavigationVisibilityModal";
import { collectNavigationVisibilityPaths } from "./navigation-visibility-inventory";
import { NAVIGATION_SECTION_ORDER } from "./view/navigation-model";
import { normalizeHiddenNavSections } from "./navigation-visibility";
import type CardWorkspacePlugin from "./main";

// These are plugin-owned data shared by both renderers, not newer host APIs.
// The getSettingDefinitions override also checks compatibility with native types.
type WorkspaceSettingControl =
  | { type: "dropdown"; key: string; options: Record<string, string> }
  | { type: "toggle"; key: string }
  | { type: "slider"; key: string; min: number; max: number; step: number };
type WorkspaceSettingDefinition = {
  name: string;
  desc?: string;
  visible?: boolean | (() => boolean);
} & (
  | { control: WorkspaceSettingControl; render?: never }
  | { control?: never; render: (setting: Setting, group: SettingGroup) => void }
);
type WorkspaceSettingGroup = {
  type: "group";
  heading?: string;
  items: WorkspaceSettingDefinition[];
};

function optionRecord(options: readonly { value: string; label: string }[]): Record<string, string> {
  return Object.fromEntries(options.map((option) => [option.value, option.label]));
}

function declarativeSettingPatch(key: string, value: unknown): PartialPluginSettings | null {
  switch (key) {
    case "defaultCardOpenBehavior":
      return typeof value === "string" && isDefaultCardOpenBehavior(value)
        ? { defaultCardOpenBehavior: value }
        : null;
    case "dragInsertAction":
      return typeof value === "string" && isDragInsertAction(value)
        ? { dragInsertAction: value }
        : null;
    case "newNoteTemplate":
      return typeof value === "string" && isNewNoteTemplate(value)
        ? { newNoteTemplate: value }
        : null;
    case "cardCornerRadius":
      return typeof value === "string" && isCardCornerRadius(value)
        ? { cardCornerRadius: value }
        : null;
    case "cardImageMode":
      return isCardImageMode(value) ? { cardImageMode: value } : null;
    case "cardImageFit":
      return isCardImageFit(value) ? { cardImageFit: value } : null;
    case "previewLines":
      return typeof value === "number"
        && Number.isInteger(value)
        && value >= PREVIEW_LINES_MIN
        && value <= PREVIEW_LINES_MAX
        ? { previewLines: value }
        : null;
    case "searchPreviewSnippetCount":
      return typeof value === "number"
        && Number.isInteger(value)
        && value >= SEARCH_PREVIEW_SNIPPET_COUNT_MIN
        && value <= SEARCH_PREVIEW_SNIPPET_COUNT_MAX
        ? { searchPreviewSnippetCount: value }
        : null;
    case "backlinkSnippetCount":
      return value === "all" || value === "1" || value === "2" || value === "3"
        ? { backlinkSnippetCount: value === "all" ? "all" : Number(value) as 1 | 2 | 3 } : null;
    case "showNavItemCounts":
      return typeof value === "boolean" ? { showNavItemCounts: value } : null;
    case "locateLinkCardOnOpen":
      return typeof value === "boolean" ? { locateLinkCardOnOpen: value } : null;
    case "enableHeadingDragInsert":
      return typeof value === "boolean" ? { enableHeadingDragInsert: value } : null;
    default:
      return null;
  }
}

export class CardWorkspaceSettingTab extends PluginSettingTab {
  private plugin: CardWorkspacePlugin;
  private readonly legacyVisibility = new Map<HTMLElement, () => boolean>();

  constructor(app: App, plugin: CardWorkspacePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * Settings live in SettingsStore, so the declarative control binding must not
   * read or write `plugin.settings` / `saveData`.
   */
  getControlValue(key: string): unknown {
    const settings = this.plugin.getSettings();
    const section = this.resolveSectionControl(key);
    if (section) return !settings.hiddenNavSections.includes(section);
    switch (key) {
      case "backlinkSnippetCount":
        return String(settings.backlinkSnippetCount);
      case "defaultCardOpenBehavior":
        return settings.defaultCardOpenBehavior;
      case "dragInsertAction":
        return settings.dragInsertAction;
      case "enableHeadingDragInsert":
        return settings.enableHeadingDragInsert;
      case "newNoteTemplate":
        return settings.newNoteTemplate;
      case "cardCornerRadius":
        return settings.cardCornerRadius;
      case "cardImageMode":
        return settings.cardImageMode;
      case "cardImageFit":
        return settings.cardImageFit;
      case "previewLines":
        return settings.previewLines;
      case "searchPreviewSnippetCount":
        return settings.searchPreviewSnippetCount;
      case "showNavItemCounts":
        return settings.showNavItemCounts;
      case "locateLinkCardOnOpen":
        return settings.locateLinkCardOnOpen;
      default:
        return undefined;
    }
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    await this.saveDeclarativeSetting(key, value);
    if (key === "cardImageMode") {
      if (requireApiVersion("1.13.0")) {
        if (typeof this.refreshDomState === "function") {
          this.refreshDomState();
        }
      }
      this.refreshLegacyVisibility();
    }
  }

  /** Obsidian 1.13+ renders definitions directly and skips this legacy entry point. */
  display(): void {
    this.containerEl.empty();
    this.legacyVisibility.clear();
    for (const definition of this.getSettingDefinitions()) {
      const group = new SettingGroup(this.containerEl);
      if (definition.heading) {
        group.setHeading(definition.heading);
      }
      for (const row of definition.items) {
        group.addSetting((setting) => {
          setting.setName(row.name);
          if (row.desc) {
            setting.setDesc(row.desc);
          }
          if (row.visible !== undefined) {
            const visible = row.visible;
            this.legacyVisibility.set(setting.settingEl, () => typeof visible === "function" ? visible() : visible);
          }
          if (row.render) { row.render(setting, group); return; }
          const control = row.control;
          const value = this.getControlValue(control.key);
          switch (control.type) {
            case "dropdown":
              setting.addDropdown((dropdown) => {
                for (const [key, label] of Object.entries(control.options)) {
                  dropdown.addOption(key, label);
                }
                dropdown.setValue(String(value)).onChange((next) => this.setControlValue(control.key, next));
              });
              break;
            case "toggle":
              setting.addToggle((toggle) => toggle.setValue(Boolean(value)).onChange((next) => this.setControlValue(control.key, next)));
              break;
            case "slider":
              setting.addSlider((slider) => slider
                .setLimits(control.min, control.max, control.step)
                .setValue(Number(value))
                .setDynamicTooltip()
                .onChange((next) => this.setControlValue(control.key, next)));
              break;
          }
        });
      }
    }
    this.refreshLegacyVisibility();
  }

  private refreshLegacyVisibility(): void {
    for (const [element, visible] of this.legacyVisibility) {
      element.style.display = visible() ? "" : "none";
    }
  }

  getSettingDefinitions(): WorkspaceSettingGroup[] {
    const language = this.plugin.getUiLanguage();
    const strings = getSettingTabStrings(language);

    const navigationStrings = getUiStrings(language).navigationVisibility;
    return [
      {
        type: "group",
        heading: strings.behaviorHeading,
        items: [
          {
            name: strings.defaultCardOpenBehaviorName,
            desc: strings.defaultCardOpenBehaviorDesc,
            control: {
              type: "dropdown",
              key: "defaultCardOpenBehavior",
              options: optionRecord(getDefaultCardOpenBehaviorOptions(language)),
            },
          },
          {
            name: strings.locateLinkCardOnOpenName,
            desc: strings.locateLinkCardOnOpenDesc,
            control: { type: "toggle", key: "locateLinkCardOnOpen" },
          },
          {
            name: strings.dragInsertActionName,
            desc: strings.dragInsertActionDesc,
            control: {
              type: "dropdown",
              key: "dragInsertAction",
              options: optionRecord(getDragInsertActionOptions(language)),
            },
          },
          {
            name: strings.enableHeadingDragInsertName,
            desc: strings.enableHeadingDragInsertDesc,
            control: { type: "toggle", key: "enableHeadingDragInsert" },
          },
          {
            name: strings.newNoteTemplateName,
            desc: strings.newNoteTemplateDesc,
            control: {
              type: "dropdown",
              key: "newNoteTemplate",
              options: optionRecord(getNewNoteTemplateOptions(language)),
            },
          },
        ],
      },
      {
        type: "group",
        heading: strings.appearanceHeading,
        items: [
          {
            name: strings.cardCornerRadiusName,
            desc: strings.cardCornerRadiusDesc,
            control: {
              type: "dropdown",
              key: "cardCornerRadius",
              options: optionRecord(getCardCornerRadiusOptions(language)),
            },
          },
          {
            name: strings.previewLinesName,
            desc: strings.previewLinesDesc(PREVIEW_LINES_MIN, PREVIEW_LINES_MAX),
            control: {
              type: "slider",
              key: "previewLines",
              min: PREVIEW_LINES_MIN,
              max: PREVIEW_LINES_MAX,
              step: 1,
            },
          },
          {
            name: strings.backlinkSnippetCountName,
            desc: strings.backlinkSnippetCountDesc,
            control: { type: "dropdown", key: "backlinkSnippetCount", options: { "1": "1", "2": "2", "3": "3", all: strings.allReferenceSnippets } },
          },
          {
            name: strings.searchPreviewSnippetCountName,
            desc: strings.searchPreviewSnippetCountDesc,
            control: {
              type: "slider",
              key: "searchPreviewSnippetCount",
              min: SEARCH_PREVIEW_SNIPPET_COUNT_MIN,
              max: SEARCH_PREVIEW_SNIPPET_COUNT_MAX,
              step: 1,
            },
          },
          {
            name: strings.cardImageModeName,
            desc: strings.cardImageModeDesc,
            control: {
              type: "dropdown",
              key: "cardImageMode",
              options: {
                off: strings.imageOff,
                right: strings.imageRight,
                inline: strings.imageInline,
              },
            },
          },
          {
            name: strings.cardImageFitName,
            desc: strings.cardImageFitDesc,
            visible: () => this.plugin.getSettings().cardImageMode !== "off",
            control: {
              type: "dropdown",
              key: "cardImageFit",
              options: { contain: strings.imageContain, cover: strings.imageCover },
            },
          },
          {
            name: strings.showNavItemCountsName,
            desc: strings.showNavItemCountsDesc,
            control: { type: "toggle", key: "showNavItemCounts" },
          },
        ],
      },
      {
        type: "group",
        heading: navigationStrings.heading,
        items: [
          ...NAVIGATION_SECTION_ORDER.map((section): WorkspaceSettingDefinition => ({
            name: navigationStrings.sections[section],
            desc: navigationStrings.description,
            control: { type: "toggle", key: `navSection:${section}` },
          })),
          ...(["folders", "tags"] as const).map((kind): WorkspaceSettingDefinition => ({
            name: kind === "folders" ? navigationStrings.manageFolders : navigationStrings.manageTags,
            desc: navigationStrings.description,
            render: (setting) => {
              setting.addButton((button) => button.setButtonText(navigationStrings.manage).onClick(() => {
                new NavigationVisibilityModal(this.app, {
                  kind, strings: getUiStrings(language),
                  collectPaths: () => collectNavigationVisibilityPaths(this.app, kind),
                  getSettings: () => this.plugin.getSettings(),
                  saveSettings: (patch) => this.plugin.saveSettings(patch),
                  flushSettings: () => this.plugin.flushSettings(),
                }).open();
              }));
            },
          })),
        ],
      },
    ];
  }

  private resolveSectionControl(key: string) {
    return NAVIGATION_SECTION_ORDER.find((section) => key === `navSection:${section}`);
  }

  private async saveDeclarativeSetting(key: string, value: unknown): Promise<void> {
    const section = this.resolveSectionControl(key);
    const patch = section && typeof value === "boolean"
      ? { hiddenNavSections: value ? this.plugin.getSettings().hiddenNavSections.filter((id) => id !== section)
        : normalizeHiddenNavSections([...this.plugin.getSettings().hiddenNavSections, section]) }
      : declarativeSettingPatch(key, value);
    if (patch === null) {
      return;
    }
    await this.plugin.saveSettings(patch);
  }
}
