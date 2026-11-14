import { normalizeBoxDraw, type BoxDrawMode } from "../box-draw";
import { CompatConfirmationModal } from "./compat-modal";
import { ExtraButtonComponent, setIcon, type App, type Setting, type SettingGroup } from "obsidian";
import { TIME_GROUP_GRANULARITIES, isTimeGroupDimension, isTimeGroupGranularity, normalizeGroupSpec, type GroupDimension, type GroupOrderBy } from "../../card-grouping-settings";
import type { UiStrings } from "../../i18n";
import { normalizePropertyFilterClauses } from "../../property-filter-settings";
import type { SortDirection, SortField } from "../../settings";
import type { CardBoxDefinition, CardBoxSortSpec, Rule } from "../types";
import { removeRuleFromBox, restoreExcludedPaths } from "../card-boxes";
import { BOX_GROUP_DIMENSIONS } from "../source-capabilities";
import { FormModal } from "./FormModal";
import { addEmptyGroupRow, createModalGroup } from "./modal-layout";

export interface BoxConfigModalOptions {
  box: CardBoxDefinition;
  visiblePropertyKeys: readonly string[];
  strings: UiStrings;
  describeRule: (rule: Rule) => string;
  isRuleFolderMissing: (rule: Rule) => boolean;
  describeMemberPath: (path: string) => string;
  onResetDraw?: () => Promise<void>;
  drawPoolSize?: number;
  getDrawStatus?: () => { round: number; drawn: number; total: number };
  onConfirm: (box: CardBoxDefinition) => Promise<void>;
}

const SORT_CHOICES: ReadonlyArray<{
  value: string;
  field: SortField;
  direction: SortDirection;
  labelKey: keyof UiStrings["toolbar"]["sortOptions"];
}> = [
  { value: "mtime:desc", field: "mtime", direction: "desc", labelKey: "mtimeDesc" },
  { value: "mtime:asc", field: "mtime", direction: "asc", labelKey: "mtimeAsc" },
  { value: "ctime:desc", field: "ctime", direction: "desc", labelKey: "ctimeDesc" },
  { value: "ctime:asc", field: "ctime", direction: "asc", labelKey: "ctimeAsc" },
  { value: "name:asc", field: "name", direction: "asc", labelKey: "nameAsc" },
  { value: "name:desc", field: "name", direction: "desc", labelKey: "nameDesc" },
];

type BoxConfigSectionId = "rules" | "manual" | "excluded" | "sort" | "group" | "draw";

interface BoxConfigSectionOptions {
  heading: string;
  count?: number;
  /** Shown beside the heading only while the section is collapsed. */
  summary?: string;
  compact?: boolean;
  action?: (headerEl: HTMLElement) => void;
}

const LIST_PREVIEW_LIMIT = 5;

/**
 * Draft-state configuration modal for a card box.
 *
 * Edits a local draft; nothing is persisted until "Done" is pressed.
 * This is the only place to edit rules, manual members, and removed members.
 */
export class BoxConfigModal extends FormModal {
  private readonly options: BoxConfigModalOptions;
  private draft: CardBoxDefinition;
  private readonly expandedSections = new Set<BoxConfigSectionId>(["rules"]);
  private readonly fullLists = new Set<BoxConfigSectionId>();
  private focusSectionAfterRender: BoxConfigSectionId | null = null;

  constructor(app: App, options: BoxConfigModalOptions) {
    super(app, {
      cancel: options.strings.box.cancel,
      submit: options.strings.box.done,
      submitting: options.strings.box.done,
    });
    this.addClass("fce-box-config");
    this.useScrollableLayout();
    this.options = options;
    this.draft = {
      ...options.box,
      rules: options.box.rules.map((rule) => ({
        ...rule,
        tags: [...rule.tags],
        properties: normalizePropertyFilterClauses(rule.properties),
      })),
      manualPaths: [...options.box.manualPaths],
      excludedPaths: [...options.box.excludedPaths],
      pinnedPaths: [...options.box.pinnedPaths],
      sort: { ...options.box.sort },
      group: { ...options.box.group },
    };
  }

  private sortValue(sort: CardBoxSortSpec): string {
    return `${sort.field}:${sort.direction}`;
  }

  /** Returns the section's settings group, or null while the section is collapsed. */
  private renderSection(id: BoxConfigSectionId, options: BoxConfigSectionOptions): SettingGroup | null {
    const expanded = this.expandedSections.has(id);
    const sectionEl = this.contentEl.createDiv({ cls: "fce-box-config-section" });
    sectionEl.toggleClass("is-collapsed", !expanded);
    const headerEl = sectionEl.createDiv({ cls: "fce-box-config-section__header" });
    const toggleEl = headerEl.createEl("button", { cls: "fce-box-config-section__toggle" });
    toggleEl.setAttribute("type", "button");
    toggleEl.setAttribute("aria-expanded", String(expanded));
    setIcon(toggleEl.createSpan({ cls: "fce-box-config-section__chevron" }), "chevron-right");
    toggleEl.createSpan({ cls: "fce-box-config-section__title", text: options.heading });
    if (options.count !== undefined) {
      toggleEl.createSpan({ cls: "fce-box-config-section__count", text: String(options.count) });
    }
    if (!expanded && options.summary) {
      toggleEl.createSpan({ cls: "fce-box-config-section__summary", text: options.summary });
    }
    toggleEl.addEventListener("click", () => {
      if (expanded) this.expandedSections.delete(id);
      else this.expandedSections.add(id);
      this.focusSectionAfterRender = id;
      this.render();
    });
    if (this.focusSectionAfterRender === id) {
      this.focusSectionAfterRender = null;
      toggleEl.focus();
    }
    options.action?.(headerEl);
    return expanded ? createModalGroup(sectionEl, { compact: options.compact }) : null;
  }

  /** Long member lists show a preview until the user asks for the rest. */
  private visibleListItems<T>(id: BoxConfigSectionId, items: readonly T[]): readonly T[] {
    if (items.length <= LIST_PREVIEW_LIMIT || this.fullLists.has(id)) return items;
    return items.slice(0, LIST_PREVIEW_LIMIT);
  }

  private addShowAllRow(id: BoxConfigSectionId, group: SettingGroup, total: number): void {
    if (total <= LIST_PREVIEW_LIMIT || this.fullLists.has(id)) return;
    group.addSetting((setting) => {
      setting.setClass("fce-box-config__show-all").addButton((button) => {
        button.setButtonText(this.options.strings.box.showAllItems(total)).onClick(() => {
          this.fullLists.add(id);
          this.render();
        });
      });
    });
  }

  protected override render(): void {
    const scrollTop = this.contentEl.scrollTop;
    super.render();
    this.contentEl.scrollTop = scrollTop;
  }

  protected renderBody(): void {
    const strings = this.options.strings.box;
    this.setTitle(strings.configTitle(this.draft.name));

    this.renderRulesGroup();
    this.renderManualGroup();
    this.renderExcludedGroup();
    this.renderSortGroup();
    this.renderGroupingGroup();
    this.renderDrawGroup();
  }

  private renderDrawGroup(): void {
    const strings = this.options.strings.box;
    const config = normalizeBoxDraw(this.draft.draw);
    const modeLabels: Record<BoxDrawMode, string> = { random: strings.drawRandom, cycle: strings.drawCycle, daily: strings.drawDaily };
    const group = this.renderSection("draw", {
      heading: strings.drawTitle,
      summary: `${modeLabels[config.mode]} · ${strings.drawCountSummary(config.count)}`,
    });
    if (group === null) return;
    group.addSetting(setting => { setting.setName(strings.drawTitle).addDropdown(dropdown => {
      dropdown.addOption("random", strings.drawRandom).addOption("cycle", strings.drawCycle).addOption("daily", strings.drawDaily).setValue(config.mode)
        .onChange(mode => { this.draft = { ...this.draft, draw: { ...normalizeBoxDraw(this.draft.draw), mode: mode as BoxDrawMode } }; });
    }); });
    group.addSetting(setting => { setting.setName(strings.drawCount).setDesc(String(config.count)).addSlider(slider => {
      slider.setLimits(1, 100, 1).setValue(config.count).onChange(count => {
        setting.setDesc(String(count));
        this.draft = { ...this.draft, draw: { ...normalizeBoxDraw(this.draft.draw), count } };
      });
    }); });
    const progress = this.draft.drawProgress;
    const status = this.options.getDrawStatus?.() ?? { round: progress?.round ?? 1, drawn: progress?.drawnPaths.length ?? 0, total: this.options.drawPoolSize ?? 0 };
    group.addSetting(setting => { setting.setName(strings.drawProgress(status.round, status.drawn, status.total)).addButton(button => {
      button.setButtonText(strings.drawReset).onClick(() => {
        const modal = new CompatConfirmationModal(this.app);
        modal.setTitle(strings.drawReset); modal.setContent(strings.drawResetConfirm);
        modal.addButton(confirm => confirm.setButtonText(strings.drawReset).setWarning().onClick(async () => {
          await this.options.onResetDraw?.();
          this.draft = { ...this.draft, drawProgress: undefined };
          if (this.contentEl.isConnected) this.render();
        }));
        modal.addCancelButton(strings.cancel); modal.open();
      });
    }); });
  }

  private renderSortGroup(): void {
    const strings = this.options.strings;
    const current = SORT_CHOICES.find((choice) => choice.value === this.sortValue(this.draft.sort));
    const group = this.renderSection("sort", {
      heading: strings.box.sortHeading,
      summary: current ? strings.toolbar.sortOptions[current.labelKey] : undefined,
    });
    group?.addSetting((setting) => {
      setting.setName(strings.box.sortHeading).addDropdown((dropdown) => {
        for (const choice of SORT_CHOICES) {
          dropdown.addOption(choice.value, strings.toolbar.sortOptions[choice.labelKey]);
        }
        dropdown.setValue(this.sortValue(this.draft.sort)).onChange((value) => {
          const choice = SORT_CHOICES.find((entry) => entry.value === value);
          if (choice) {
            this.draft = {
              ...this.draft,
              sort: { field: choice.field, direction: choice.direction },
            };
          }
        });
      });
    });
  }

  private renderGroupingGroup(): void {
    const strings = this.options.strings;
    const labels = strings.sortGroup;
    const propertyKeys = this.options.visiblePropertyKeys;
    let selectedPropertyKey = this.draft.group.propertyKey ?? propertyKeys[0];
    const dimensionLabels: Record<GroupDimension, string> = {
      ctime: labels.dimensionCtime,
      mtime: labels.dimensionMtime,
      none: labels.dimensionNone,
      folder: labels.dimensionFolder,
      tag: labels.dimensionTag,
      task: labels.dimensionTask,
      property: labels.dimensionProperty,
      "box-rule": labels.dimensionBoxRule,
    };
    const spec = this.draft.group;
    const detail = spec.dimension === "property" ? spec.propertyKey
      : isTimeGroupDimension(spec.dimension) ? labels.timeGranularities[spec.timeGranularity ?? "day"]
      : undefined;
    const group = this.renderSection("group", {
      heading: strings.box.groupHeading,
      summary: detail ? `${dimensionLabels[spec.dimension]} · ${detail}` : dimensionLabels[spec.dimension],
    });
    if (group === null) return;
    const dimensions = BOX_GROUP_DIMENSIONS.filter((dimension) =>
      dimension !== "property" || propertyKeys.length > 0,
    );
    let propertyRow: Setting;
    let timeRow: Setting;
    let timeDropdown: import("obsidian").DropdownComponent;
    let orderByRow: Setting;
    let orderDirectionRow: Setting;
    const refreshVisibility = (): void => {
      timeDropdown.setValue(this.draft.group.timeGranularity ?? "day");
      timeRow.settingEl.style.display = isTimeGroupDimension(this.draft.group.dimension) ? "" : "none";
      propertyRow.settingEl.style.display = this.draft.group.dimension === "property" ? "" : "none";
      const orderDisplay = this.draft.group.dimension === "none" ? "none" : "";
      orderByRow.settingEl.style.display = orderDisplay;
      orderDirectionRow.settingEl.style.display = orderDisplay;
    };

    group.addSetting((setting) => {
      setting.setName(labels.groupHeading);
      if (propertyKeys.length === 0) setting.setDesc(labels.enablePropertyHint);
      setting.addDropdown((dropdown) => {
        for (const dimension of dimensions) {
          dropdown.addOption(dimension, dimensionLabels[dimension]);
        }
        dropdown.setValue(this.draft.group.dimension).onChange((value) => {
          const dimension = dimensions.find((candidate) => candidate === value);
          if (dimension === undefined) return;
          this.draft = {
            ...this.draft,
            group: normalizeGroupSpec({
              ...this.draft.group,
              dimension,
              propertyKey: selectedPropertyKey,
            }),
          };
          refreshVisibility();
        });
      });
    });
    group.addSetting((setting) => {
      propertyRow = setting;
      setting.setName(strings.box.groupPropertyLabel).addDropdown((dropdown) => {
        for (const key of propertyKeys) dropdown.addOption(key, key);
        dropdown.setValue(selectedPropertyKey ?? "").onChange((key) => {
          if (this.draft.group.dimension !== "property" || !propertyKeys.includes(key)) return;
          selectedPropertyKey = key;
          this.draft = { ...this.draft, group: { ...this.draft.group, propertyKey: key } };
        });
      });
    });
    group.addSetting((setting) => {
      timeRow = setting;
      setting.setName(labels.timeGranularity).addDropdown((dropdown) => {
        timeDropdown = dropdown;
        for (const grain of TIME_GROUP_GRANULARITIES) dropdown.addOption(grain, labels.timeGranularities[grain]);
        dropdown.setValue(this.draft.group.timeGranularity ?? "day").onChange((value) => {
          if (!isTimeGroupDimension(this.draft.group.dimension) || !isTimeGroupGranularity(value)) return;
          this.draft = { ...this.draft, group: { ...this.draft.group, timeGranularity: value } };
        });
      });
    });
    const orderLabels: Record<GroupOrderBy, string> = {
      default: labels.orderDefault,
      name: labels.orderName,
      count: labels.orderCount,
    };
    group.addSetting((setting) => {
      orderByRow = setting;
      setting.setName(strings.box.groupOrderByLabel).addDropdown((dropdown) => {
        const choices: GroupOrderBy[] = ["default", "name", "count"];
        for (const choice of choices) dropdown.addOption(choice, orderLabels[choice]);
        dropdown.setValue(this.draft.group.orderBy).onChange((value) => {
          const orderBy = choices.find((candidate) => candidate === value);
          if (orderBy === undefined) return;
          this.draft = { ...this.draft, group: { ...this.draft.group, orderBy } };
        });
      });
    });
    group.addSetting((setting) => {
      orderDirectionRow = setting;
      setting.setName(strings.box.groupOrderDirectionLabel).addDropdown((dropdown) => {
        dropdown.addOption("asc", labels.directionAsc).addOption("desc", labels.directionDesc);
        dropdown.setValue(this.draft.group.orderDirection).onChange((orderDirection) => {
          if (orderDirection !== "asc" && orderDirection !== "desc") return;
          this.draft = { ...this.draft, group: { ...this.draft.group, orderDirection } };
        });
      });
    });
    refreshVisibility();
  }

  private renderRulesGroup(): void {
    const strings = this.options.strings.box;
    const group = this.renderSection("rules", { heading: strings.rulesHeading, count: this.draft.rules.length, compact: true });
    if (group === null) return;
    if (this.draft.rules.length === 0) {
      addEmptyGroupRow(group, strings.noRules);
      return;
    }

    this.visibleListItems("rules", this.draft.rules).forEach((rule, index) => {
      group.addSetting((setting) => {
        setting.setName(this.options.describeRule(rule));
        if (this.options.isRuleFolderMissing(rule)) {
          setting.setDesc(strings.ruleFolderMissing);
          setting.setClass("fce-box-config__rule-missing");
        }
        setting.addText((text) => {
          text.inputEl.setAttribute("aria-label", strings.ruleNameLabel);
          text
            .setPlaceholder(strings.ruleNamePlaceholder)
            .setValue(rule.name)
            .onChange((value) => {
              this.draft = {
                ...this.draft,
                rules: this.draft.rules.map((entry, entryIndex) => (
                  entryIndex === index ? { ...entry, name: value } : entry
                )),
              };
            });
        });
        setting.addExtraButton((button) => {
          button
            .setIcon("x")
            .setTooltip(strings.removeRule)
            .onClick(() => {
              this.draft = removeRuleFromBox(this.draft, index);
              this.render();
            });
        });
      });
    });
    this.addShowAllRow("rules", group, this.draft.rules.length);
  }

  private renderManualGroup(): void {
    const strings = this.options.strings.box;
    const group = this.renderSection("manual", { heading: strings.manualHeading, count: this.draft.manualPaths.length, compact: true });
    if (group === null) return;
    if (this.draft.manualPaths.length === 0) {
      addEmptyGroupRow(group, strings.noManualMembers);
      return;
    }

    for (const path of this.visibleListItems("manual", this.draft.manualPaths)) {
      group.addSetting((setting) => {
        setting
          .setName(this.options.describeMemberPath(path))
          .setDesc(path)
          .addExtraButton((button) => {
            button
              .setIcon("x")
              .setTooltip(strings.removeManualMember)
              .onClick(() => {
                this.draft = {
                  ...this.draft,
                  manualPaths: this.draft.manualPaths.filter((candidate) => candidate !== path),
                };
                this.render();
              });
          });
      });
    }
    this.addShowAllRow("manual", group, this.draft.manualPaths.length);
  }

  private renderExcludedGroup(): void {
    const strings = this.options.strings.box;
    const group = this.renderSection("excluded", {
      heading: strings.excludedHeading,
      count: this.draft.excludedPaths.length,
      compact: true,
      action: this.draft.excludedPaths.length === 0 ? undefined : (headerEl) => {
        new ExtraButtonComponent(headerEl)
          .setIcon("rotate-ccw")
          .setTooltip(strings.restoreAllExcluded)
          .onClick(() => {
            this.draft = restoreExcludedPaths(this.draft);
            this.render();
          });
      },
    });
    if (group === null) return;
    if (this.draft.excludedPaths.length === 0) {
      addEmptyGroupRow(group, strings.noExcludedMembers);
      return;
    }

    for (const path of this.visibleListItems("excluded", this.draft.excludedPaths)) {
      group.addSetting((setting) => {
        setting
          .setName(this.options.describeMemberPath(path))
          .setDesc(path)
          .addExtraButton((button) => {
            button
              .setIcon("undo-2")
              .setTooltip(strings.restoreExcluded)
              .onClick(() => {
                this.draft = restoreExcludedPaths(this.draft, [path]);
                this.render();
              });
          });
      });
    }
    this.addShowAllRow("excluded", group, this.draft.excludedPaths.length);
  }

  protected async handleSubmit(): Promise<boolean> {
    await this.options.onConfirm(this.draft);
    return true;
  }
}
