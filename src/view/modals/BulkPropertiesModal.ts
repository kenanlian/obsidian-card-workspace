import { Setting, SettingGroup, type App } from "obsidian";
import { editablePropertyKey, inferPropertyEditType, propertyValueCandidates, validPropertiesDraft, type BulkPropertiesDraft, type BulkPropertySet, type BulkPropertyType, type BulkPropertyValue } from "../bulk-metadata";
import { BulkMetadataModal, type BulkMetadataModalOptions } from "./BulkMetadataModal";

interface PropertyRow {
  name: string;
  type: BulkPropertyType;
  raw: string;
  checked: boolean;
  items: Array<string | number>;
  listItemType: "text" | "number";
  manualType: boolean;
}

export class BulkPropertiesModal extends BulkMetadataModal {
  private readonly rows: PropertyRow[] = [];
  private readonly removeKeys: string[] = [];
  constructor(app: App, options: BulkMetadataModalOptions, private readonly onSubmit: (draft: BulkPropertiesDraft) => Promise<boolean>) { super(app, options); }
  private value(row: PropertyRow): BulkPropertyValue {
    if (row.type === "list") return [...row.items];
    if (row.type === "checkbox") return row.checked;
    if (row.type === "number") return row.raw.trim() ? Number(row.raw) : NaN;
    if (row.type === "datetime" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(row.raw)) return `${row.raw}:00`;
    return row.raw;
  }
  private draft(): BulkPropertiesDraft {
    return { setProperties: this.rows.map((row): BulkPropertySet => ({ name: row.name, type: row.type, value: this.value(row) })), removeKeys: [...this.removeKeys] };
  }
  protected override isSubmitDisabled(): boolean { return !validPropertiesDraft(this.draft()); }
  private changed(): void { this.updateValidation(!this.isSubmitDisabled(), this.rows.length + this.removeKeys.length > 0); }
  protected renderBody(): void {
    this.setTitle(this.strings.propertiesTitle);
    this.renderIntro();
    const group = new SettingGroup(this.contentEl).setHeading(this.strings.setProperties);
    const append = (row: PropertyRow) => group.addSetting((setting) => this.renderRow(setting, row));
    this.rows.forEach(append);
    new Setting(this.contentEl).addButton((button) => button.setButtonText(this.strings.addRow).onClick(() => {
      if (this.isSubmitting()) return;
      const row: PropertyRow = { name: "", type: "text", raw: "", checked: false, items: [], listItemType: "text", manualType: false };
      this.rows.push(row); append(row); this.changed();
    }));
    this.renderPicker(this.strings.removeProperties, this.snapshot.removeProperties, this.removeKeys, (name) => editablePropertyKey(name) ?? "", false, () => this.changed());
    this.changed();
  }
  private renderRow(setting: Setting, row: PropertyRow): void {
    setting.setClass("fce-property-edit-row");
    const valueEl = setting.settingEl.createDiv({ cls: "fce-property-value-editor" });
    const handles: Array<{ dispose: () => void }> = [];
    let valueHandle: { dispose: () => void } | null = null;
    let releaseValueLock: (() => void) | null = null;
    let typeSelect: HTMLSelectElement;
    const renderValue = () => {
      valueHandle?.dispose(); valueHandle = null;
      releaseValueLock?.(); releaseValueLock = null;
      valueEl.empty();
      const control = new Setting(valueEl).setName(this.strings.value);
      if (row.type === "checkbox") {
        control.addToggle((toggle) => {
          toggle.setValue(row.checked).onChange((value) => { if (!this.isSubmitting()) { row.checked = value; this.changed(); } });
          releaseValueLock = this.registerLock((locked) => toggle.setDisabled(locked));
        });
        return;
      }
      if (row.type === "list") {
        const chips = valueEl.createDiv({ cls: "fce-metadata-chips" });
        const paint = () => {
          chips.empty();
          row.items.forEach((item, index) => {
            const button = chips.createEl("button", { text: `${item} ×`, attr: { type: "button", "aria-label": `${this.strings.remove}: ${item}` } });
            button.addEventListener("click", () => { if (!this.isSubmitting()) { row.items.splice(index, 1); paint(); this.changed(); } });
          });
        };
        let input: HTMLInputElement;
        const commit = (raw: string) => {
          if (!raw.trim()) return;
          const item = row.listItemType === "number" ? Number(raw) : raw;
          if (typeof item === "number" && !Number.isFinite(item)) return;
          if (!row.items.includes(item)) row.items.push(item);
          input.value = ""; paint(); this.changed();
        };
        control.addDropdown((dropdown) => dropdown.addOption("text", this.strings.types.text).addOption("number", this.strings.types.number).setValue(row.listItemType).onChange((value) => { row.listItemType = value === "number" ? "number" : "text"; }));
        control.addText((text) => {
          input = text.inputEl;
          input.setAttribute("aria-label", this.strings.value);
          const handle = this.attachSuggest(input, () => propertyValueCandidates(this.snapshot, row.name, "list", row.listItemType).filter((item) => !row.items.includes(row.listItemType === "number" ? Number(item.name) : item.name)), commit);
          valueHandle = handle;
          this.confirmOnEnter(input, handle.isOpen, () => commit(input.value));
        }).addButton((button) => button.setButtonText(this.strings.add).onClick(() => { if (!this.isSubmitting()) commit(input.value); }));
        paint();
        return;
      }
      control.addText((text) => {
        text.setValue(row.raw).onChange((value) => { if (!this.isSubmitting()) { row.raw = value; this.changed(); } });
        const input = text.inputEl;
        input.type = row.type === "date" ? "date" : row.type === "datetime" ? "datetime-local" : row.type === "number" ? "number" : "text";
        if (row.type === "number") input.step = "any";
        if (row.type === "datetime") input.step = "1";
        input.setAttribute("aria-label", this.strings.value);
        valueHandle = this.attachSuggest(input, () => propertyValueCandidates(this.snapshot, row.name, row.type), (value) => { row.raw = value; input.value = value; this.changed(); });
        // A value input never routes Enter to FormModal.submit().
        input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) event.preventDefault(); });
      });
    };
    const infer = () => {
      if (row.manualType) return;
      const type = inferPropertyEditType(this.snapshot.values.get(editablePropertyKey(row.name) ?? "") ?? []);
      if (type !== row.type) { row.type = type; typeSelect.value = type; renderValue(); }
    };
    setting.setName(this.strings.name).addText((text) => {
      text.setValue(row.name).onChange((value) => { if (!this.isSubmitting()) { row.name = value; infer(); this.changed(); } });
      text.inputEl.setAttribute("aria-label", this.strings.name);
      handles.push(this.attachSuggest(text.inputEl, () => this.snapshot.properties.filter((item) => !this.rows.some((other) => other !== row && editablePropertyKey(other.name) === editablePropertyKey(item.name))), (name) => { row.name = name; text.setValue(name); infer(); this.changed(); }));
      text.inputEl.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); infer(); this.changed(); } });
    }).addDropdown((dropdown) => {
      typeSelect = dropdown.selectEl;
      typeSelect.setAttribute("aria-label", this.strings.type);
      for (const [type, label] of Object.entries(this.strings.types)) dropdown.addOption(type, label);
      dropdown.setValue(row.type).onChange((value) => {
        if (this.isSubmitting()) return;
        row.type = value as BulkPropertyType; row.manualType = true; renderValue(); this.changed();
      });
    }).addButton((button) => button.setButtonText(this.strings.remove).onClick(() => {
      if (this.isSubmitting()) return;
      handles.forEach((handle) => handle.dispose()); valueHandle?.dispose(); releaseValueLock?.();
      this.rows.splice(this.rows.indexOf(row), 1); setting.settingEl.remove(); this.changed();
    }));
    renderValue();
  }
  protected handleSubmit(): Promise<boolean> { return this.onSubmit(this.draft()); }
}
