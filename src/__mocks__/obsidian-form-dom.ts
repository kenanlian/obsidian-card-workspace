export function installFormDomHelpers(): void {
  const prototype = HTMLElement.prototype;
  prototype.empty = function () { this.replaceChildren(); };
  prototype.setText = function (text: string) { this.textContent = text; };
  Object.defineProperty(prototype, "createEl", { configurable: true, writable: true, value: function (this: HTMLElement, tag: string, options: { cls?: string; text?: string; type?: string; attr?: Record<string, string> } = {}) {
    const el = this.ownerDocument.createElement(tag);
    if (options.cls) el.className = options.cls;
    if (options.text !== undefined) el.textContent = options.text;
    if (options.type) el.setAttribute("type", options.type);
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
    this.appendChild(el);
    return el;
  } });
  prototype.createDiv = function (options = {}) { return this.createEl("div", options); };
}

/** Real-DOM controls for form interaction tests; the input suggest uses its shared mock. */
export class Modal {
  modalEl = document.createElement("div");
  contentEl = document.createElement("div");
  constructor(public app: unknown) { this.modalEl.appendChild(this.contentEl); }
  setTitle(title: string): void { this.modalEl.setAttribute("aria-label", title); }
  onOpen(): void {}
  onClose(): void {}
  open(): void { document.body.appendChild(this.modalEl); this.onOpen(); }
  close(): void { this.onClose(); this.modalEl.remove(); }
}
export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(container: HTMLElement) { this.buttonEl = container.createEl("button", { attr: { type: "button" } }); }
  setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
  setCta(): this { this.buttonEl.classList.add("mod-cta"); return this; }
  setWarning(): this { return this; }
  setDisabled(value: boolean): this { this.buttonEl.disabled = value; return this; }
  onClick(handler: (event: MouseEvent) => unknown): this { this.buttonEl.addEventListener("click", handler); return this; }
}
export class ConfirmationButton extends ButtonComponent {}
export class ConfirmationModal extends Modal {
  addClass(name: string): this { this.modalEl.classList.add(name); return this; }
  addButton(configure: (button: ConfirmationButton) => unknown): this { configure(new ConfirmationButton(this.modalEl)); return this; }
  addCancelButton(text: string): this { this.addButton((button) => button.setButtonText(text).onClick(() => this.close())); return this; }
}
class Text {
  inputEl: HTMLInputElement;
  constructor(container: HTMLElement) { this.inputEl = container.createEl("input"); }
  setValue(value: string): this { this.inputEl.value = value; return this; }
  onChange(handler: (value: string) => void): this { this.inputEl.addEventListener("input", () => handler(this.inputEl.value)); return this; }
}
class Dropdown {
  selectEl: HTMLSelectElement;
  constructor(container: HTMLElement) { this.selectEl = container.createEl("select"); }
  addOption(value: string, label: string): this { this.selectEl.add(new Option(label, value)); return this; }
  setValue(value: string): this { this.selectEl.value = value; return this; }
  onChange(handler: (value: string) => void): this { this.selectEl.addEventListener("change", () => handler(this.selectEl.value)); return this; }
}
class Toggle {
  inputEl: HTMLInputElement;
  constructor(container: HTMLElement) { this.inputEl = container.createEl("input", { type: "checkbox" }); }
  setValue(value: boolean): this { this.inputEl.checked = value; return this; }
  setDisabled(value: boolean): this { this.inputEl.disabled = value; return this; }
  onChange(handler: (value: boolean) => void): this { this.inputEl.addEventListener("change", () => handler(this.inputEl.checked)); return this; }
}
export class Setting {
  settingEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(container: HTMLElement) { this.settingEl = container.createDiv({ cls: "setting-item" }); this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" }); }
  setName(name: string): this { this.settingEl.setAttribute("aria-label", name); return this; }
  setClass(name: string): this { this.settingEl.classList.add(name); return this; }
  addText(configure: (text: Text) => unknown): this { configure(new Text(this.controlEl)); return this; }
  addDropdown(configure: (dropdown: Dropdown) => unknown): this { configure(new Dropdown(this.controlEl)); return this; }
  addToggle(configure: (toggle: Toggle) => unknown): this { configure(new Toggle(this.controlEl)); return this; }
  addButton(configure: (button: ButtonComponent) => unknown): this { configure(new ButtonComponent(this.controlEl)); return this; }
}
export class SettingGroup {
  private container: HTMLElement;
  constructor(container: HTMLElement) { this.container = container.createDiv(); }
  setHeading(heading: string): this { this.container.createEl("h3", { text: heading }); return this; }
  addSetting(configure: (setting: Setting) => unknown): this { configure(new Setting(this.container)); return this; }
}
