import { DropdownComponent, Setting, SettingGroup, TextComponent, ToggleComponent, setIcon, type App } from "obsidian";
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
    let addRowEl: HTMLElement | null = null;
    // SettingGroup only appends, so the "add" row is moved back to the end after each new row.
    const append = (row: PropertyRow) => {
      group.addSetting((setting) => this.renderRow(setting, row));
      addRowEl?.parentElement?.appendChild(addRowEl);
    };
    this.rows.forEach(append);
    group.addSetting((setting) => {
      setting.setClass("fce-property-add-row");
      addRowEl = setting.settingEl;
      const button = setting.controlEl.createEl("button", { cls: "fce-property-add", attr: { type: "button" } });
      setIcon(button.createSpan({ cls: "fce-property-add__icon" }), "plus");
      button.createSpan({ text: this.strings.addRow });
      button.addEventListener("click", () => {
        if (this.isSubmitting()) return;
        const row: PropertyRow = { name: "", type: "text", raw: "", checked: false, items: [], listItemType: "text", manualType: false };
        this.rows.push(row); append(row); this.changed();
      });
    });
    this.renderPicker({ heading: this.strings.removeProperties, candidates: this.snapshot.removeProperties, selected: this.removeKeys, normalize: (name) => editablePropertyKey(name) ?? "", allowNew: false, onChange: () => this.changed(), tone: "remove" });
    this.renderFeedback();
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
      valueEl.dataset.type = row.type;
      if (row.type === "checkbox") {
        valueEl.createSpan({ cls: "fce-property-value-label", text: this.strings.value });
        const toggle = new ToggleComponent(valueEl);
        toggle.setValue(row.checked).onChange((value) => { if (!this.isSubmitting()) { row.checked = value; this.changed(); } });
        releaseValueLock = this.registerLock((locked) => { toggle.setDisabled(locked); });
        return;
      }
      if (row.type === "list") {
        const line = valueEl.createDiv({ cls: "fce-property-value-line" });
        const chips = valueEl.createDiv({ cls: "fce-metadata-chips" });
        const paint = () => this.paintChips(chips, row.items, (_item, index) => { row.items.splice(index, 1); paint(); this.changed(); });
        let input!: HTMLInputElement;
        const commit = (raw: string) => {
          if (!raw.trim()) return;
          const item = row.listItemType === "number" ? Number(raw) : raw;
          if (typeof item === "number" && !Number.isFinite(item)) return;
          if (!row.items.includes(item)) row.items.push(item);
          input.value = ""; paint(); this.changed();
        };
        const itemType = new DropdownComponent(line)
          .addOption("text", this.strings.types.text)
          .addOption("number", this.strings.types.number)
          .setValue(row.listItemType)
          .onChange((value) => { row.listItemType = value === "number" ? "number" : "text"; });
        itemType.selectEl.setAttribute("aria-label", this.strings.itemType);
        const text = new TextComponent(line).setPlaceholder(this.strings.listItem);
        input = text.inputEl;
        input.setAttribute("aria-label", this.strings.value);
        const handle = this.attachSuggest(input, () => propertyValueCandidates(this.snapshot, row.name, "list", row.listItemType).filter((item) => !row.items.includes(row.listItemType === "number" ? Number(item.name) : item.name)), commit);
        valueHandle = handle;
        this.confirmOnEnter(input, handle.isOpen, () => commit(input.value));
        this.createIconButton(line, "plus", this.strings.add, () => commit(input.value));
        paint();
        return;
      }
      const text = new TextComponent(valueEl).setPlaceholder(this.strings.value);
      text.setValue(row.raw).onChange((value) => { if (!this.isSubmitting()) { row.raw = value; this.changed(); } });
      const input = text.inputEl;
      input.type = row.type === "date" ? "date" : row.type === "datetime" ? "datetime-local" : row.type === "number" ? "number" : "text";
      if (row.type === "number") input.step = "any";
      if (row.type === "datetime") input.step = "1";
      input.setAttribute("aria-label", this.strings.value);
      valueHandle = this.attachSuggest(input, () => propertyValueCandidates(this.snapshot, row.name, row.type), (value) => { row.raw = value; input.value = value; this.changed(); });
      // A value input never routes Enter to FormModal.submit().
      input.addEventListener("keydown", (event) => { if (event.key === "Enter" && !event.isComposing) event.preventDefault(); });
    };
    const infer = () => {
      if (row.manualType) return;
      const type = inferPropertyEditType(this.snapshot.values.get(editablePropertyKey(row.name) ?? "") ?? []);
      if (type !== row.type) { row.type = type; typeSelect.value = type; renderValue(); }
    };
    setting.addText((text) => {
      text.setPlaceholder(this.strings.name);
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
    });
    this.createIconButton(setting.controlEl, "trash-2", this.strings.removeRow, () => {
      handles.forEach((handle) => handle.dispose()); valueHandle?.dispose(); releaseValueLock?.();
      this.rows.splice(this.rows.indexOf(row), 1); setting.settingEl.remove(); this.changed();
    });
    renderValue();
  }
  protected handleSubmit(): Promise<boolean> { return this.onSubmit(this.draft()); }
}
