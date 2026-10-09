/**
 * Recording stand-ins for the Obsidian modal and settings primitives.
 *
 * Use as the `obsidian` module in node-project tests that exercise `FormModal`
 * subclasses: `vi.mock("obsidian", async () => await import("../../__mocks__/obsidian-modal-mock"))`.
 * Rendered structure is kept as an ordered `nodes` tree so tests can assert
 * grouping, row order, and component state without a DOM. Nothing here
 * imports `obsidian`, so the module is safe behind the alias.
 */

type Listener = (event: unknown) => void;

export function requireApiVersion(_version: string): boolean {
  return true;
}

export type MockNode = MockEl | Setting | SettingGroup;

export class MockEl {
  readonly style = { display: "" };
  readonly buttons: MockButton[] = [];
  isConnected = true;
  tag = "div";
  text = "";
  scrollTop = 0;
  readonly classes = new Set<string>();
  readonly attrs: Record<string, string> = {};
  readonly nodes: MockNode[] = [];
  private readonly listeners = new Map<string, Listener[]>();

  addClass(...classes: string[]): void {
    for (const cls of classes) {
      this.classes.add(cls);
    }
  }

  removeClass(...classes: string[]): void {
    for (const cls of classes) {
      this.classes.delete(cls);
    }
  }

  hasClass(cls: string): boolean {
    return this.classes.has(cls);
  }

  toggleClass(cls: string, on: boolean): void {
    if (on) {
      this.classes.add(cls);
    } else {
      this.classes.delete(cls);
    }
  }

  empty(): void {
    this.nodes.length = 0;
    this.text = "";
  }

  setText(text: string): void {
    this.text = text;
  }

  setAttribute(name: string, value: string): void {
    this.attrs[name] = value;
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  createEl(tag: string, options: { text?: string; cls?: string | string[] } = {}): MockEl {
    const child = new MockEl();
    child.tag = tag;
    child.text = options.text ?? "";
    child.addClass(...(Array.isArray(options.cls) ? options.cls : options.cls ? [options.cls] : []));
    this.nodes.push(child);
    return child;
  }

  createDiv(options: { text?: string; cls?: string | string[] } = {}): MockEl {
    return this.createEl("div", options);
  }

  createSpan(options: { text?: string; cls?: string | string[] } = {}): MockEl {
    return this.createEl("span", options);
  }
}

export class MockButton {
  text = "";
  icon = "";
  tooltip = "";
  cta = false;
  warning = false;
  disabled = false;
  handler: (() => unknown) | null = null;

  setButtonText(text: string): this {
    this.text = text;
    return this;
  }

  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }

  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }

  setCta(): this {
    this.cta = true;
    return this;
  }

  setWarning(): this {
    this.warning = true;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.disabled = disabled;
    return this;
  }

  onClick(handler: () => unknown): this {
    this.handler = handler;
    return this;
  }

  click(): unknown {
    return this.disabled ? undefined : this.handler?.();
  }
}

export class ButtonComponent extends MockButton {
  readonly buttonEl = { get disabled() { return false; } };

  constructor(containerEl: MockEl) {
    super();
    Object.defineProperty(this.buttonEl, "disabled", { get: () => this.disabled });
    containerEl.buttons.push(this);
  }
}

export class MockText {
  value = "";
  placeholder = "";
  readonly inputEl = new MockEl();
  private handler: ((value: string) => unknown) | null = null;

  get ariaLabel(): string {
    return this.inputEl.attrs["aria-label"] ?? "";
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.placeholder = placeholder;
    return this;
  }

  onChange(handler: (value: string) => unknown): this {
    this.handler = handler;
    return this;
  }

  type(value: string): void {
    this.value = value;
    this.handler?.(value);
  }
}

export class MockToggle {
  value = false;
  disabled = false;

  setDisabled(value: boolean): this { this.disabled = value; return this; }
  private handler: ((value: boolean) => unknown) | null = null;

  setValue(value: boolean): this {
    this.value = value;
    return this;
  }

  onChange(handler: (value: boolean) => unknown): this {
    this.handler = handler;
    return this;
  }

  set(value: boolean): void {
    this.value = value;
    this.handler?.(value);
  }
}

export class MockDropdown {
  value = "";
  readonly options: Array<{ value: string; label: string }> = [];
  private handler: ((value: string) => unknown) | null = null;

  addOption(value: string, label: string): this {
    this.options.push({ value, label });
    return this;
  }

  setValue(value: string): this {
    this.value = value;
    return this;
  }

  onChange(handler: (value: string) => unknown): this {
    this.handler = handler;
    return this;
  }

  select(value: string): void {
    this.value = value;
    this.handler?.(value);
  }
}

export class MockSlider {
  value = 0;
  min = 0;
  max = 0;
  step = 0;
  dynamicTooltip = false;
  private handler: ((value: number) => unknown) | null = null;

  setLimits(min: number, max: number, step: number): this {
    Object.assign(this, { min, max, step });
    return this;
  }

  setValue(value: number): this {
    this.value = value;
    return this;
  }

  setDynamicTooltip(): this {
    this.dynamicTooltip = true;
    return this;
  }

  onChange(handler: (value: number) => unknown): this {
    this.handler = handler;
    return this;
  }

  async slide(value: number): Promise<void> {
    this.value = value;
    await this.handler?.(value);
  }
}

export class Setting {
  readonly settingEl = new MockEl();
  readonly controlEl = this.settingEl.createDiv();
  name = "";
  desc = "";
  readonly classes: string[] = [];
  readonly texts: MockText[] = [];
  readonly searches: MockText[] = [];
  readonly toggles: MockToggle[] = [];
  readonly dropdowns: MockDropdown[] = [];
  readonly sliders: MockSlider[] = [];
  readonly buttons: MockButton[] = [];
  readonly extraButtons: MockButton[] = [];

  constructor(containerEl: MockEl) {
    containerEl.nodes.push(this);
  }

  setName(name: string): this {
    this.name = name;
    return this;
  }

  setDesc(desc: string): this {
    this.desc = desc;
    return this;
  }

  setClass(cls: string): this {
    this.classes.push(cls);
    return this;
  }

  addText(configure: (text: MockText) => unknown): this {
    const text = new MockText();
    configure(text);
    this.texts.push(text);
    return this;
  }

  addSearch(configure: (text: MockText) => unknown): this {
    const text = new MockText();
    configure(text);
    this.searches.push(text);
    return this;
  }

  addToggle(configure: (toggle: MockToggle) => unknown): this {
    const toggle = new MockToggle();
    configure(toggle);
    this.toggles.push(toggle);
    return this;
  }

  addDropdown(configure: (dropdown: MockDropdown) => unknown): this {
    const dropdown = new MockDropdown();
    configure(dropdown);
    this.dropdowns.push(dropdown);
    return this;
  }

  addSlider(configure: (slider: MockSlider) => unknown): this {
    const slider = new MockSlider();
    configure(slider);
    this.sliders.push(slider);
    return this;
  }

  addButton(configure: (button: MockButton) => unknown): this {
    const button = new MockButton();
    configure(button);
    this.buttons.push(button);
    return this;
  }

  addExtraButton(configure: (button: MockButton) => unknown): this {
    const button = new MockButton();
    configure(button);
    this.extraButtons.push(button);
    return this;
  }
}

export class SettingGroup {
  heading = "";
  readonly classes: string[] = [];
  readonly settings: Setting[] = [];
  readonly extraButtons: MockButton[] = [];
  readonly searches: MockText[] = [];
  readonly listEl = new MockEl();

  constructor(containerEl: MockEl) {
    containerEl.nodes.push(this);
  }

  setHeading(text: string): this {
    this.heading = text;
    return this;
  }

  addClass(...classes: string[]): this {
    this.classes.push(...classes);
    return this;
  }

  addSetting(configure: (setting: Setting) => unknown): this {
    const setting = new Setting(this.listEl);
    this.settings.push(setting);
    configure(setting);
    return this;
  }

  addSearch(configure: (text: MockText) => unknown): this {
    const text = new MockText();
    configure(text);
    this.searches.push(text);
    return this;
  }

  addExtraButton(configure: (button: MockButton) => unknown): this {
    const button = new MockButton();
    configure(button);
    this.extraButtons.push(button);
    return this;
  }
}

export class Modal {
  app: unknown;
  title = "";
  closeCount = 0;
  readonly contentEl = new MockEl();
  readonly modalEl = new MockEl();

  constructor(app: unknown) {
    this.app = app;
  }

  setTitle(title: string): this {
    this.title = title;
    return this;
  }

  setContent(content: string): this {
    this.contentEl.setText(content);
    return this;
  }

  onOpen(): void {}

  onClose(): void {}

  open(): void {
    this.contentEl.isConnected = true;
    this.onOpen();
  }

  close(): void {
    this.closeCount += 1;
    this.contentEl.isConnected = false;
    this.onClose();
  }
}

export class ConfirmationButton extends MockButton {
  cancel = false;
  initialFocus = false;
  secondary = false;

  constructor(private readonly modal: Modal) {
    super();
  }

  setCancel(): this {
    this.cancel = true;
    return this;
  }

  setInitialFocus(): this {
    this.initialFocus = true;
    return this;
  }

  setSecondary(): this {
    this.secondary = true;
    return this;
  }

  /** Mirrors the native contract: the dialog closes after the handler unless it returns truthy. */
  override async click(): Promise<void> {
    if (this.disabled) {
      return;
    }
    const keepOpen = await this.handler?.();
    if (!keepOpen) {
      this.modal.close();
    }
  }
}

export class ConfirmationModal extends Modal {
  readonly buttons: ConfirmationButton[] = [];

  addClass(cls: string): this {
    this.modalEl.addClass(cls);
    return this;
  }

  addButton(configure: (button: ConfirmationButton) => unknown): this {
    const button = new ConfirmationButton(this);
    this.buttons.push(button);
    configure(button);
    return this;
  }

  addCancelButton(text = "Cancel"): this {
    return this.addButton((button) => {
      button.setButtonText(text).setCancel();
    });
  }
}

export class Notice {
  static messages: string[] = [];

  constructor(message: string) {
    Notice.messages.push(message);
  }
}

export function resetNotices(): void {
  Notice.messages.length = 0;
}

export function settingsIn(root: MockEl): Setting[] {
  const found: Setting[] = [];
  for (const node of root.nodes) {
    if (node instanceof Setting) {
      found.push(node);
    } else if (node instanceof SettingGroup) {
      found.push(...settingsIn(node.listEl));
    } else {
      found.push(...settingsIn(node));
    }
  }
  return found;
}

export function groupsIn(root: MockEl): SettingGroup[] {
  const found: SettingGroup[] = [];
  for (const node of root.nodes) {
    if (node instanceof SettingGroup) {
      found.push(node);
    } else if (node instanceof MockEl) {
      found.push(...groupsIn(node));
    }
  }
  return found;
}

export function requireGroup(root: MockEl, heading: string): SettingGroup {
  const group = groupsIn(root).find((candidate) => candidate.heading === heading);
  if (!group) {
    throw new Error(`setting group not rendered: ${heading}`);
  }
  return group;
}

export function elementsIn(root: MockEl, predicate: (el: MockEl) => boolean): MockEl[] {
  const found: MockEl[] = [];
  for (const node of root.nodes) {
    if (node instanceof MockEl) {
      if (predicate(node)) {
        found.push(node);
      }
      found.push(...elementsIn(node, predicate));
    } else if (node instanceof Setting) {
      found.push(...elementsIn(node.settingEl, predicate));
    } else if (node instanceof SettingGroup) {
      found.push(...elementsIn(node.listEl, predicate));
    }
  }
  return found;
}

/** Views a real-typed modal instance as its recording mock (the `obsidian` module is aliased in these tests). */
export function asMock(modal: unknown): ConfirmationModal {
  return modal as ConfirmationModal;
}
