import { Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import {
  normalizePropertyKey,
  normalizeVisiblePropertyKeys,
  type PropertyInventorySnapshot,
} from "../../property-filter-settings";
import { FormModal } from "./FormModal";

export interface PropertyPickerModalOptions {
  strings: UiStrings;
  /** Currently persisted visible keys; seeds the draft selection. */
  selectedKeys: readonly string[];
  /** Fresh vault frontmatter inventory; called exactly once per open. */
  collectPropertyInventory: () => PropertyInventorySnapshot;
  /** Called once from Done with the normalized draft; never called on Cancel or a no-change Done. */
  onSubmit: (visibleKeys: string[]) => Promise<void>;
}

interface PropertyPickerRow {
  key: string;
  label: string;
  available: boolean;
  selected: boolean;
}

function compareRowsByIdentity(a: PropertyPickerRow, b: PropertyPickerRow): number {
  return a.key.localeCompare(b.key);
}

/**
 * Searchable draft-state chooser for the visible property keys (C9).
 *
 * Checkbox toggles edit only the local draft; Done persists once via
 * `onSubmit`, Cancel persists nothing. The vault inventory is collected
 * exactly once per opening — re-renders never rescan. A selected key that is
 * absent from the latest inventory stays listed as unavailable so it can be
 * removed; inventory status never erases current selections.
 */
export class PropertyPickerModal extends FormModal {
  private readonly options: PropertyPickerModalOptions;
  private readonly inventory: PropertyInventorySnapshot;
  private readonly draftKeys: Set<string>;
  private searchQuery = "";
  private listEl: HTMLElement | null = null;

  constructor(app: App, options: PropertyPickerModalOptions) {
    super(app, {
      cancel: options.strings.box.cancel,
      submit: options.strings.box.done,
      submitting: options.strings.box.done,
    });
    this.options = options;
    this.inventory = options.collectPropertyInventory();
    this.draftKeys = new Set(normalizeVisiblePropertyKeys(options.selectedKeys));
  }

  /** Selected keys first, then the rest, each group sorted by normalized identity. */
  private buildRows(): PropertyPickerRow[] {
    const byKey = new Map<string, { key: string; label: string; available: boolean }>();
    for (const option of this.inventory.options) {
      const key = normalizePropertyKey(option.key);
      if (key !== null && !byKey.has(key)) {
        byKey.set(key, { key, label: option.label, available: option.available });
      }
    }
    // Selected keys missing from the latest inventory remain listed, unavailable.
    for (const key of this.draftKeys) {
      if (!byKey.has(key)) {
        byKey.set(key, { key, label: key, available: false });
      }
    }

    const selected: PropertyPickerRow[] = [];
    const remaining: PropertyPickerRow[] = [];
    for (const option of byKey.values()) {
      const row = { ...option, selected: this.draftKeys.has(option.key) };
      (row.selected ? selected : remaining).push(row);
    }
    selected.sort(compareRowsByIdentity);
    remaining.sort(compareRowsByIdentity);

    const query = this.searchQuery.trim().toLowerCase();
    const rows = [...selected, ...remaining];
    if (query.length === 0) {
      return rows;
    }
    return rows.filter((row) =>
      row.key.includes(query) || row.label.toLowerCase().includes(query));
  }

  protected renderBody(): void {
    const strings = this.options.strings.property;
    this.setTitle(strings.chooseVisible);
    this.contentEl.addClass("fce-property-picker");

    new Setting(this.contentEl).addText((text) => {
      text.inputEl.setAttribute("aria-label", strings.searchPlaceholder);
      text
        .setPlaceholder(strings.searchPlaceholder)
        .setValue(this.searchQuery)
        .onChange((value) => {
          this.searchQuery = value;
          this.renderList();
        });
    });

    this.listEl = this.contentEl.createDiv({ cls: "fce-property-picker__list" });
    this.renderList();
  }

  private renderList(): void {
    const listEl = this.listEl;
    if (listEl === null) {
      return;
    }
    listEl.empty();
    const strings = this.options.strings.property;

    if (this.inventory.status === "partial") {
      listEl.createEl("p", { text: strings.partialWarning, cls: "fce-property-picker__warning" });
    } else if (this.inventory.status === "unavailable") {
      listEl.createEl("p", { text: strings.unavailable, cls: "fce-property-picker__warning" });
    }

    const rows = this.buildRows();
    if (rows.length === 0) {
      if (this.inventory.status === "ready") {
        listEl.createEl("p", { text: strings.emptyNoProperties, cls: "fce-property-picker__empty" });
      }
      return;
    }

    for (const row of rows) {
      const setting = new Setting(listEl).setName(row.label);
      if (!row.available) {
        setting.setDesc(strings.unavailable);
        setting.setClass("fce-property-picker__unavailable");
      }
      setting.addToggle((toggle) => {
        toggle.setValue(row.selected).onChange((checked) => {
          // Draft-only: no persistence and no re-render until Done/search.
          if (checked) {
            this.draftKeys.add(row.key);
          } else {
            this.draftKeys.delete(row.key);
          }
        });
      });
    }
  }

  protected async handleSubmit(): Promise<boolean> {
    const nextKeys = normalizeVisiblePropertyKeys([...this.draftKeys]);
    const currentKeys = normalizeVisiblePropertyKeys(this.options.selectedKeys);
    const unchanged = nextKeys.length === currentKeys.length
      && nextKeys.every((key, index) => key === currentKeys[index]);
    if (!unchanged) {
      await this.options.onSubmit(nextKeys);
    }
    return true;
  }
}
