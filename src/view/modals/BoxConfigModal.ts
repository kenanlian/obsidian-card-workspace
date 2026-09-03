import { Modal, Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import { normalizePropertyFilterClauses } from "../../property-filter-settings";
import type { SortDirection, SortField } from "../../settings";
import type { CardBoxDefinition, CardBoxSortSpec, Rule } from "../types";
import { removeRuleFromBox, restoreExcludedPaths } from "../card-boxes";

export interface BoxConfigModalOptions {
  box: CardBoxDefinition;
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
export class BoxConfigModal extends Modal {
  private readonly options: BoxConfigModalOptions;
  private draft: CardBoxDefinition;
  private submitting = false;

  constructor(app: App, options: BoxConfigModalOptions) {
    super(app);
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

  onOpen(): void {
    this.render();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private sortValue(sort: CardBoxSortSpec): string {
    return `${sort.field}:${sort.direction}`;
  }

  private render(): void {
    const strings = this.options.strings.box;
    this.setTitle(strings.configTitle(this.draft.name));
    this.contentEl.empty();
    this.contentEl.addClass("fce-box-config");

    // Rules section.
    this.contentEl.createEl("h4", { text: strings.rulesHeading, cls: "fce-box-config__heading" });

    if (this.draft.rules.length === 0) {
      this.contentEl.createEl("p", { text: strings.noRules, cls: "fce-box-config__empty" });
    } else {
      this.draft.rules.forEach((rule, index) => {
        const setting = new Setting(this.contentEl).setName(this.options.describeRule(rule));
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
            .setIcon("trash-2")
            .setTooltip(strings.removeRule)
            .onClick(() => {
              this.draft = removeRuleFromBox(this.draft, index);
              this.render();
            });
        });
      });
    }

    // Sort section.
    this.contentEl.createEl("h4", { text: strings.sortHeading, cls: "fce-box-config__heading" });
    new Setting(this.contentEl).addDropdown((dropdown) => {
      for (const choice of SORT_CHOICES) {
        dropdown.addOption(choice.value, this.options.strings.toolbar.sortOptions[choice.labelKey]);
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

    // Manually added members section.
    this.contentEl.createEl("h4", { text: strings.manualHeading, cls: "fce-box-config__heading" });
    if (this.draft.manualPaths.length === 0) {
      this.contentEl.createEl("p", { text: strings.noManualMembers, cls: "fce-box-config__empty" });
    } else {
      const list = this.contentEl.createDiv({ cls: "fce-box-config__member-list" });
      for (const path of this.draft.manualPaths) {
        new Setting(list)
          .setName(this.options.describeMemberPath(path))
          .setDesc(path)
          .addExtraButton((button) => {
            button
              .setIcon("trash-2")
              .setTooltip(strings.removeManualMember)
              .onClick(() => {
                this.draft = {
                  ...this.draft,
                  manualPaths: this.draft.manualPaths.filter((candidate) => candidate !== path),
                };
                this.render();
              });
          });
      }
    }

    // Excluded members section.
    this.contentEl.createEl("h4", { text: strings.excludedHeading, cls: "fce-box-config__heading" });
    if (this.draft.excludedPaths.length === 0) {
      this.contentEl.createEl("p", { text: strings.noExcludedMembers, cls: "fce-box-config__empty" });
    } else {
      const list = this.contentEl.createDiv({ cls: "fce-box-config__member-list" });
      for (const path of this.draft.excludedPaths) {
        new Setting(list)
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
      }
      new Setting(this.contentEl).addButton((button) => {
        button.setButtonText(strings.restoreAllExcluded).onClick(() => {
          this.draft = restoreExcludedPaths(this.draft);
          this.render();
        });
      });
    }

    // Footer.
    new Setting(this.contentEl)
      .addButton((button) => {
        button.setButtonText(strings.cancel).onClick(() => {
          this.close();
        });
      })
      .addButton((button) => {
        button
          .setCta()
          .setButtonText(strings.done)
          .onClick(() => {
            void this.submit();
          });
      });
  }

  private async submit(): Promise<void> {
    if (this.submitting) {
      return;
    }
    this.submitting = true;
    try {
      await this.options.onConfirm(this.draft);
      this.close();
    } finally {
      this.submitting = false;
    }
  }
}
