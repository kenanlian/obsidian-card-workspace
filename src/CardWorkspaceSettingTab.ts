import {
  PluginSettingTab, SettingGroup, Notice, requireApiVersion, type App, type Setting,
} from "obsidian";
import {
  getCardCornerRadiusOptions,
  getCardStyleOptions,
  getUiDensityOptions,
  getUiFontSizeOptions,
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
  HOVER_PREVIEW_WIDTH_MIN,
  HOVER_PREVIEW_WIDTH_MAX,
  DEFAULT_HOVER_PREVIEW_WIDTH,
  HOVER_PREVIEW_HEIGHT_MIN,
  HOVER_PREVIEW_HEIGHT_MAX,
  DEFAULT_HOVER_PREVIEW_HEIGHT,
  QUICK_INPUT_WIDTH_MIN,
  QUICK_INPUT_WIDTH_MAX,
  DEFAULT_QUICK_INPUT_WIDTH,
  QUICK_INPUT_HEIGHT_MIN,
  QUICK_INPUT_HEIGHT_MAX,
  DEFAULT_QUICK_INPUT_HEIGHT,
  QUICK_INPUT_TINTS,
  isQuickInputColor,
  isCardCornerRadius,
  isCardStyle,
  isUiDensity,
  isUiFontSize,
  isCardImageMode,
  isCardImageFit,
  isDefaultCardOpenBehavior,
  isDragInsertAction,
  isNewNoteTemplate,
  type PartialPluginSettings,
} from "./settings";
import { DEFAULT_TEMPLATE_STORAGE_FOLDER, normalizeQuickInput, resolveTemplateName } from "./note-input";
import { attachFolderInputSuggest } from "./view/folder-input-suggest";
import { onPlainEnter } from "./view/metadata-input-suggest";
import { TemplateStorageError } from "./services/TemplateStorageService";
import type { NoteInputStrings } from "./i18n/noteInput";
import { NavigationVisibilityModal } from "./view/modals/NavigationVisibilityModal";
import { collectNavigationVisibilityPaths } from "./navigation-visibility-inventory";
import { NAVIGATION_SECTION_ORDER } from "./view/navigation-model";
import { normalizeHiddenNavSections } from "./navigation-visibility";
import { captureQuickInputAccelerator } from "./input/QuickInputShortcut";
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
    case "uiFontSize":
      return isUiFontSize(value) ? { uiFontSize: value } : null;
    case "uiDensity":
      return isUiDensity(value) ? { uiDensity: value } : null;
    case "cardStyle":
      return isCardStyle(value) ? { cardStyle: value } : null;
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
    case "hoverPreviewWidth":
      return typeof value === "number" && Number.isInteger(value)
        && value >= HOVER_PREVIEW_WIDTH_MIN && value <= HOVER_PREVIEW_WIDTH_MAX
        ? { hoverPreviewWidth: value } : null;
    case "hoverPreviewHeight":
      return typeof value === "number" && Number.isInteger(value)
        && value >= HOVER_PREVIEW_HEIGHT_MIN && value <= HOVER_PREVIEW_HEIGHT_MAX
        ? { hoverPreviewHeight: value } : null;
    case "quickInputWidth":
      return typeof value === "number" && Number.isInteger(value)
        && value >= QUICK_INPUT_WIDTH_MIN && value <= QUICK_INPUT_WIDTH_MAX
        ? { quickInputWidth: value } : null;
    case "quickInputHeight":
      return typeof value === "number" && Number.isInteger(value)
        && value >= QUICK_INPUT_HEIGHT_MIN && value <= QUICK_INPUT_HEIGHT_MAX
        ? { quickInputHeight: value } : null;
    case "quickInputColor":
      return isQuickInputColor(value) ? { quickInputColor: value } : null;
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
  private readonly folderSuggests = new Set<ReturnType<typeof attachFolderInputSuggest>>();

  constructor(app: App, plugin: CardWorkspacePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /** Native hosts cache definitions at registration, before settings finish loading. */
  refreshTemplateOptions(): void {
    if (requireApiVersion("1.13.0") && typeof this.update === "function") {
      this.disposeFolderSuggests();
      this.update();
    }
    // Legacy display() builds fresh options each time the tab is opened.
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
      case "quickInputTemplateId":
        return normalizeQuickInput(settings.quickInput).templateId ?? "";
      case "quickInputFolderPath":
        return normalizeQuickInput(settings.quickInput).folderPath;
      case "quickInputInsertPosition":
        return normalizeQuickInput(settings.quickInput).insertPosition;
      case "quickInputWidth":
        return settings.quickInputWidth;
      case "quickInputHeight":
        return settings.quickInputHeight;
      case "quickInputColor":
        return settings.quickInputColor;
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
      case "uiFontSize":
        return settings.uiFontSize;
      case "uiDensity":
        return settings.uiDensity;
      case "cardStyle":
        return settings.cardStyle;
      case "cardImageMode":
        return settings.cardImageMode;
      case "cardImageFit":
        return settings.cardImageFit;
      case "previewLines":
        return settings.previewLines;
      case "searchPreviewSnippetCount":
        return settings.searchPreviewSnippetCount;
      case "hoverPreviewWidth":
        return settings.hoverPreviewWidth;
      case "hoverPreviewHeight":
        return settings.hoverPreviewHeight;
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
    if (key === "cardImageMode" || key === "cardStyle" || (key === "quickInputTemplateId" && typeof value === "string")) {
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
    this.disposeFolderSuggests();
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
              setting.addSlider((slider) => {
                slider.setLimits(control.min, control.max, control.step).setValue(Number(value));
                // 1.13+ displays the value natively; older hosts need an inline label.
                const valueEl = requireApiVersion("1.13.0") ? null
                  : setting.controlEl.createSpan({ cls: "fce-setting-slider-value", text: String(value) });
                slider.onChange((next) => {
                  valueEl?.setText(String(next));
                  return this.setControlValue(control.key, next);
                });
              });
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

  hide(): void { this.disposeFolderSuggests(); }
  private disposeFolderSuggests(): void {
    this.shortcutCleanups.splice(0).forEach((cleanup) => cleanup());
    this.folderSuggests.forEach((suggest) => suggest.dispose()); this.folderSuggests.clear();
  }

  private renderQuickInputShortcutSetting(setting: Setting, strings: NoteInputStrings): void {
    setting.settingEl.addClass("fce-shortcut-setting");
    let draft = this.plugin.getSettings().quickInputGlobalShortcut;
    let input!: HTMLInputElement;
    const capture = (event: KeyboardEvent) => {
      const accelerator = captureQuickInputAccelerator(event);
      if (!accelerator) return;
      event.preventDefault(); event.stopPropagation(); draft = accelerator; input.value = draft;
    };
    setting.addText((text) => {
      input = text.inputEl;
      text.setValue(draft).setPlaceholder("Control+Shift+Q").onChange((value) => { draft = value; });
      input.addEventListener("keydown", capture);
    });
    let disableApply!: (disabled: boolean) => void;
    let disableClear!: (disabled: boolean) => void;
    setting.addButton((apply) => {
      disableApply = (disabled) => { apply.setDisabled(disabled); };
      apply.setButtonText(strings.apply).onClick(() => { void this.plugin.quickInputShortcut.apply(draft); });
    });
    setting.addButton((clear) => {
      disableClear = (disabled) => { clear.setDisabled(disabled); };
      clear.setButtonText(strings.clearShortcut).onClick(() => { draft = ""; input.value = ""; void this.plugin.quickInputShortcut.apply(""); });
    });
    const status = setting.settingEl.createDiv({ cls: "fce-shortcut-status", attr: { role: "status", "aria-live": "polite" } });
    const unsubscribe = this.plugin.quickInputShortcut.subscribe((state) => {
      disableApply(state.pending); disableClear(state.pending); input.disabled = state.pending;
      const errors = { invalid: strings.shortcutInvalid, conflict: strings.shortcutConflict,
        unavailable: strings.desktopUnavailable, "save-failed": strings.shortcutSaveFailed };
      status.textContent = [state.active.length ? strings.shortcutActive(state.active.join(", ")) : strings.shortcutInactive,
        state.error ? errors[state.error] : ""].filter(Boolean).join(" · ");
    });
    this.shortcutCleanups.push(() => { unsubscribe(); input.removeEventListener("keydown", capture); });
  }
  private readonly shortcutCleanups: Array<() => void> = [];

  private renderQuickInputFolderSetting(setting: Setting): void {
    setting.addText((text) => {
      text.setValue(String(this.getControlValue("quickInputFolderPath")) || "/")
        .setPlaceholder("/")
        .onChange((value) => this.setControlValue("quickInputFolderPath", value === "/" ? "" : value));
      const suggest = attachFolderInputSuggest(this.app, text.inputEl, (path) => {
        text.setValue(path || "/");
        void this.setControlValue("quickInputFolderPath", path);
      });
      this.folderSuggests.add(suggest);
    });
  }

  private renderTemplateFolderSetting(setting: Setting, strings: NoteInputStrings): void {
    let draft = this.plugin.getSettings().templateStorageFolder ?? DEFAULT_TEMPLATE_STORAGE_FOLDER;
    if (draft === "") draft = "/";
    let pending = false;
    setting.addText((text) => {
      text.setValue(draft).setPlaceholder(DEFAULT_TEMPLATE_STORAGE_FOLDER).onChange((value) => { draft = value; });
      const suggest = attachFolderInputSuggest(this.app, text.inputEl, (path) => { draft = path || "/"; text.setValue(draft); });
      this.folderSuggests.add(suggest);
      setting.addButton((button) => {
        const apply = async () => {
          if (pending) return;
          pending = true; suggest.close(); text.inputEl.disabled = true;
          button.setDisabled(true).setButtonText(strings.applying);
          try {
            await this.plugin.changeTemplateStorageFolder(draft);
            draft = this.plugin.getSettings().templateStorageFolder || "/"; text.setValue(draft);
          } catch (error) {
            const reason = error instanceof TemplateStorageError
              ? error.code === "invalid-folder" ? strings.invalidTemplateFolder
                : error.code === "missing-template" ? `${strings.templateNotFound} ${error.path}`
                  : `${strings.targetConflict} ${error.path}` : String(error);
            new Notice(strings.saveTemplateFailed(reason));
          } finally { pending = false; text.inputEl.disabled = false; button.setDisabled(false).setButtonText(strings.apply); }
        };
        const submit = () => { void apply(); };
        button.setButtonText(strings.apply).onClick(submit);
        onPlainEnter(text.inputEl, suggest.isOpen, submit);
      });
    });
  }

  getSettingDefinitions(): WorkspaceSettingGroup[] {
    const language = this.plugin.getUiLanguage();
    const strings = getSettingTabStrings(language);

    const navigationStrings = getUiStrings(language).navigationVisibility;
    const inputStrings = getUiStrings(language).noteInput;
    const settings = this.plugin.getSettings();
    const quickInput = normalizeQuickInput(settings.quickInput);
    const templateOptions: Record<string, string> = Object.create(null) as Record<string, string>;
    templateOptions[""] = inputStrings.noTemplate;
    for (const template of settings.noteTemplates ?? []) {
      templateOptions[template.id] = resolveTemplateName(template);
    }
    if (quickInput.templateId && !Object.prototype.hasOwnProperty.call(templateOptions, quickInput.templateId)) {
      templateOptions[quickInput.templateId] = `${inputStrings.templateUnavailable} (${quickInput.templateId})`;
    }
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
            name: strings.uiFontSizeName,
            desc: strings.uiFontSizeDesc,
            control: { type: "dropdown", key: "uiFontSize", options: optionRecord(getUiFontSizeOptions(language)) },
          },
          {
            name: strings.uiDensityName,
            desc: strings.uiDensityDesc,
            control: { type: "dropdown", key: "uiDensity", options: optionRecord(getUiDensityOptions(language)) },
          },
          {
            name: strings.cardStyleName,
            desc: strings.cardStyleDesc,
            control: { type: "dropdown", key: "cardStyle", options: optionRecord(getCardStyleOptions(language)) },
          },
          {
            name: strings.cardCornerRadiusName,
            desc: strings.cardCornerRadiusDesc,
            visible: () => this.plugin.getSettings().cardStyle !== "list",
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
          {
            name: strings.hoverPreviewWidthName,
            desc: strings.hoverPreviewDimensionDesc(HOVER_PREVIEW_WIDTH_MIN, HOVER_PREVIEW_WIDTH_MAX, DEFAULT_HOVER_PREVIEW_WIDTH),
            control: { type: "slider", key: "hoverPreviewWidth", min: HOVER_PREVIEW_WIDTH_MIN, max: HOVER_PREVIEW_WIDTH_MAX, step: 10 },
          },
          {
            name: strings.hoverPreviewHeightName,
            desc: strings.hoverPreviewDimensionDesc(HOVER_PREVIEW_HEIGHT_MIN, HOVER_PREVIEW_HEIGHT_MAX, DEFAULT_HOVER_PREVIEW_HEIGHT),
            control: { type: "slider", key: "hoverPreviewHeight", min: HOVER_PREVIEW_HEIGHT_MIN, max: HOVER_PREVIEW_HEIGHT_MAX, step: 10 },
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
      {
        type: "group",
        heading: inputStrings.quickInputHeading,
        items: [
          { name: inputStrings.quickInputTemplateName, desc: inputStrings.quickInputTemplateDesc,
            control: { type: "dropdown", key: "quickInputTemplateId", options: templateOptions } },
          { name: inputStrings.quickInputFolderName, desc: inputStrings.quickInputFolderDesc,
            visible: () => normalizeQuickInput(this.plugin.getSettings().quickInput).templateId === null,
            render: (setting) => this.renderQuickInputFolderSetting(setting) },
          { name: inputStrings.quickInputPositionName, desc: inputStrings.quickInputPositionDesc,
            visible: () => normalizeQuickInput(this.plugin.getSettings().quickInput).templateId !== null,
            control: { type: "dropdown", key: "quickInputInsertPosition", options: { start: inputStrings.insertStart, end: inputStrings.insertEnd } } },
          { name: inputStrings.quickInputWidthName,
            desc: inputStrings.quickInputDimensionDesc(QUICK_INPUT_WIDTH_MIN, QUICK_INPUT_WIDTH_MAX, DEFAULT_QUICK_INPUT_WIDTH),
            control: { type: "slider", key: "quickInputWidth", min: QUICK_INPUT_WIDTH_MIN, max: QUICK_INPUT_WIDTH_MAX, step: 10 } },
          { name: inputStrings.quickInputHeightName,
            desc: inputStrings.quickInputDimensionDesc(QUICK_INPUT_HEIGHT_MIN, QUICK_INPUT_HEIGHT_MAX, DEFAULT_QUICK_INPUT_HEIGHT),
            control: { type: "slider", key: "quickInputHeight", min: QUICK_INPUT_HEIGHT_MIN, max: QUICK_INPUT_HEIGHT_MAX, step: 10 } },
          { name: inputStrings.quickInputColorName, desc: inputStrings.quickInputColorDesc,
            control: { type: "dropdown", key: "quickInputColor", options: {
              random: inputStrings.colorRandom, accent: inputStrings.colorAccent,
              ...Object.fromEntries(QUICK_INPUT_TINTS.map((tint) => [tint, inputStrings.colorNames[tint]])),
            } } },
          { name: inputStrings.globalShortcutName, desc: inputStrings.globalShortcutDesc,
            render: (setting) => this.renderQuickInputShortcutSetting(setting, inputStrings) },
        ],
      },
      {
        type: "group", heading: inputStrings.templates,
        items: [{ name: inputStrings.templateStorageFolder, desc: inputStrings.templateStorageFolderDesc,
          render: (setting) => this.renderTemplateFolderSetting(setting, inputStrings) }],
      },
    ];
  }

  private resolveSectionControl(key: string) {
    return NAVIGATION_SECTION_ORDER.find((section) => key === `navSection:${section}`);
  }

  private async saveDeclarativeSetting(key: string, value: unknown): Promise<void> {
    if (key === "quickInputTemplateId" || key === "quickInputFolderPath" || key === "quickInputInsertPosition") {
      if (typeof value !== "string") return;
      if (key === "quickInputInsertPosition" && value !== "start" && value !== "end") return;
      const config = normalizeQuickInput(this.plugin.getSettings().quickInput);
      if (key === "quickInputTemplateId") config.templateId = value || null;
      if (key === "quickInputFolderPath") config.folderPath = value;
      if (key === "quickInputInsertPosition") config.insertPosition = value as "start" | "end";
      await this.plugin.saveSettings({ quickInput: config });
      return;
    }
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
