import type { App, Setting } from "obsidian";
import { normalizeGroupSpec, type GroupDimension, type GroupOrderBy } from "../../card-grouping-settings";
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

/**
 * Draft-state configuration modal for a card box.
 *
 * Edits a local draft; nothing is persisted until "Done" is pressed.
 * This is the only place to edit rules, manual members, and removed members.
 */
export class BoxConfigModal extends FormModal {
  private readonly options: BoxConfigModalOptions;
  private draft: CardBoxDefinition;

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

  protected override render(): void {
    const scrollTop = this.contentEl.scrollTop;
    super.render();
    this.contentEl.scrollTop = scrollTop;
  }

  protected renderBody(): void {
    const strings = this.options.strings.box;
    this.setTitle(strings.configTitle(this.draft.name));

    this.renderSortGroup();
    this.renderGroupingGroup();
    this.renderRulesGroup();
    this.renderManualGroup();
    this.renderExcludedGroup();
  }

  private renderSortGroup(): void {
    const strings = this.options.strings;
    createModalGroup(this.contentEl).addSetting((setting) => {
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
    const group = createModalGroup(this.contentEl, { heading: strings.box.groupHeading });
    const dimensionLabels: Record<GroupDimension, string> = {
      none: labels.dimensionNone,
      folder: labels.dimensionFolder,
      tag: labels.dimensionTag,
      task: labels.dimensionTask,
      property: labels.dimensionProperty,
      "box-rule": labels.dimensionBoxRule,
    };
    const dimensions = BOX_GROUP_DIMENSIONS.filter((dimension) =>
      dimension !== "property" || propertyKeys.length > 0,
    );
    let propertyRow: Setting;
    let orderByRow: Setting;
    let orderDirectionRow: Setting;
    const refreshVisibility = (): void => {
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
    const group = createModalGroup(this.contentEl, { heading: strings.rulesHeading, compact: true });
    if (this.draft.rules.length === 0) {
      addEmptyGroupRow(group, strings.noRules);
      return;
    }

    this.draft.rules.forEach((rule, index) => {
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
  }

  private renderManualGroup(): void {
    const strings = this.options.strings.box;
    const group = createModalGroup(this.contentEl, { heading: strings.manualHeading, compact: true });
    if (this.draft.manualPaths.length === 0) {
      addEmptyGroupRow(group, strings.noManualMembers);
      return;
    }

    for (const path of this.draft.manualPaths) {
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
  }

  private renderExcludedGroup(): void {
    const strings = this.options.strings.box;
    const group = createModalGroup(this.contentEl, { heading: strings.excludedHeading, compact: true });
    if (this.draft.excludedPaths.length === 0) {
      addEmptyGroupRow(group, strings.noExcludedMembers);
      return;
    }

    group.addExtraButton((button) => {
      button
        .setIcon("rotate-ccw")
        .setTooltip(strings.restoreAllExcluded)
        .onClick(() => {
          this.draft = restoreExcludedPaths(this.draft);
          this.render();
        });
    });
    for (const path of this.draft.excludedPaths) {
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
  }

  protected async handleSubmit(): Promise<boolean> {
    await this.options.onConfirm(this.draft);
    return true;
  }
}
