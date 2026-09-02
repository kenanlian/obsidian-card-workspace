import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../../i18n";
import type { PropertyInventorySnapshot } from "../../property-filter-settings";

interface TextRecord {
  placeholder: string;
  value: string;
  ariaLabel: string;
  onChange: ((value: string) => void) | null;
}

interface ToggleRecord {
  value: boolean;
  onChange: ((checked: boolean) => void) | null;
}

interface ButtonRecord {
  text: string;
  cta: boolean;
  disabled: boolean;
  onClick: (() => void) | null;
}

interface SettingRecord {
  name: string;
  desc: string;
  classes: string[];
  texts: TextRecord[];
  toggles: ToggleRecord[];
  buttons: ButtonRecord[];
}

interface ElRecord {
  tag: string;
  text: string;
  cls: string;
}

interface MockElementShape {
  isConnected: boolean;
  cls: string;
  classes: string[];
  settings: SettingRecord[];
  els: ElRecord[];
  divs: MockElementShape[];
}

const mockState = vi.hoisted(() => ({
  title: "",
}));

vi.mock("obsidian", () => {
  class MockElement {
    isConnected = true;
    cls = "";
    classes: string[] = [];
    settings: SettingRecord[] = [];
    els: ElRecord[] = [];
    divs: MockElement[] = [];

    addClass(cls: string): void {
      this.classes.push(cls);
    }

    empty(): void {
      this.settings.length = 0;
      this.els.length = 0;
      this.divs.length = 0;
    }

    createEl(tag: string, options?: { text?: string; cls?: string }): MockElement {
      this.els.push({ tag, text: options?.text ?? "", cls: options?.cls ?? "" });
      return new MockElement();
    }

    createDiv(options?: { cls?: string }): MockElement {
      const div = new MockElement();
      div.cls = options?.cls ?? "";
      this.divs.push(div);
      return div;
    }
  }

  class Modal {
    app: unknown;
    contentEl = new MockElement();
    closeCount = 0;

    constructor(app: unknown) {
      this.app = app;
    }

    setTitle(title: string): this {
      mockState.title = title;
      return this;
    }

    open(): void {
      (this as unknown as { onOpen?: () => void }).onOpen?.();
    }

    close(): void {
      this.closeCount += 1;
      this.contentEl.isConnected = false;
      (this as unknown as { onClose?: () => void }).onClose?.();
    }
  }

  class Setting {
    private readonly record: SettingRecord;

    constructor(containerEl: MockElement) {
      this.record = { name: "", desc: "", classes: [], texts: [], toggles: [], buttons: [] };
      containerEl.settings.push(this.record);
    }

    setName(name: string): this {
      this.record.name = name;
      return this;
    }

    setDesc(desc: string): this {
      this.record.desc = desc;
      return this;
    }

    setClass(cls: string): this {
      this.record.classes.push(cls);
      return this;
    }

    addText(configure: (text: unknown) => void): this {
      const record: TextRecord = { placeholder: "", value: "", ariaLabel: "", onChange: null };
      const chain = {
        inputEl: {
          setAttribute: (name: string, value: string) => {
            if (name === "aria-label") {
              record.ariaLabel = value;
            }
          },
        },
        setPlaceholder: (placeholder: string) => {
          record.placeholder = placeholder;
          return chain;
        },
        setValue: (value: string) => {
          record.value = value;
          return chain;
        },
        onChange: (handler: (value: string) => void) => {
          record.onChange = handler;
          return chain;
        },
      };
      configure(chain);
      this.record.texts.push(record);
      return this;
    }

    addToggle(configure: (toggle: unknown) => void): this {
      const record: ToggleRecord = { value: false, onChange: null };
      const chain = {
        setValue: (value: boolean) => {
          record.value = value;
          return chain;
        },
        onChange: (handler: (checked: boolean) => void) => {
          record.onChange = handler;
          return chain;
        },
      };
      configure(chain);
      this.record.toggles.push(record);
      return this;
    }

    addButton(configure: (button: unknown) => void): this {
      const record: ButtonRecord = { text: "", cta: false, disabled: false, onClick: null };
      const chain = {
        setButtonText: (text: string) => {
          record.text = text;
          return chain;
        },
        setCta: () => {
          record.cta = true;
          return chain;
        },
        setDisabled: (disabled: boolean) => {
          record.disabled = disabled;
          return chain;
        },
        onClick: (handler: () => void) => {
          record.onClick = handler;
          return chain;
        },
      };
      configure(chain);
      this.record.buttons.push(record);
      return this;
    }
  }

  return { Modal, Setting };
});

const { PropertyPickerModal } = await import("./PropertyPickerModal");
type PropertyPickerModalInstance = InstanceType<typeof PropertyPickerModal>;

const strings = getUiStrings("en");

function contentOf(modal: PropertyPickerModalInstance): MockElementShape {
  return modal.contentEl as unknown as MockElementShape;
}

function listElOf(modal: PropertyPickerModalInstance): MockElementShape {
  const list = contentOf(modal).divs.find((div) => div.cls === "fce-property-picker__list");
  if (!list) {
    throw new Error("property picker list element not rendered");
  }
  return list;
}

function rowSettings(modal: PropertyPickerModalInstance): SettingRecord[] {
  return listElOf(modal).settings;
}

function rowNames(modal: PropertyPickerModalInstance): string[] {
  return rowSettings(modal).map((setting) => setting.name);
}

function noticeTexts(modal: PropertyPickerModalInstance): string[] {
  return listElOf(modal).els.map((el) => el.text);
}

function searchInput(modal: PropertyPickerModalInstance): TextRecord {
  const input = contentOf(modal).settings[0]?.texts[0];
  if (!input) {
    throw new Error("search input not rendered");
  }
  return input;
}

function clickButton(modal: PropertyPickerModalInstance, predicate: (button: ButtonRecord) => boolean): void {
  const button = contentOf(modal).settings
    .flatMap((setting) => setting.buttons)
    .find(predicate);
  if (!button) {
    throw new Error("button not rendered");
  }
  button.onClick?.();
}

function clickCancel(modal: PropertyPickerModalInstance): void {
  clickButton(modal, (button) => button.text === strings.box.cancel && !button.cta);
}

function clickDone(modal: PropertyPickerModalInstance): void {
  clickButton(modal, (button) => button.cta);
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function openModal(options: {
  selectedKeys?: string[];
  inventory?: PropertyInventorySnapshot;
  onSubmit?: (keys: string[]) => Promise<void>;
} = {}) {
  const collect = vi.fn((): PropertyInventorySnapshot =>
    options.inventory ?? { status: "ready", options: [] });
  const onSubmit = vi.fn(options.onSubmit ?? (async () => {}));
  const modal = new PropertyPickerModal({} as never, {
    strings,
    selectedKeys: options.selectedKeys ?? [],
    collectPropertyInventory: collect,
    onSubmit,
  });
  modal.open();
  return { modal, onSubmit, collect };
}

describe("PropertyPickerModal", () => {
  beforeEach(() => {
    mockState.title = "";
  });

  it("collects the inventory exactly once per open and never on re-render", () => {
    const { modal, collect } = openModal({
      inventory: {
        status: "ready",
        options: [
          { key: "alpha", label: "alpha", available: true },
          { key: "beta", label: "beta", available: true },
        ],
      },
    });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(mockState.title).toBe(strings.property.chooseVisible);

    searchInput(modal).onChange?.("alp");
    searchInput(modal).onChange?.("");
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it("lists selected keys first, then remaining keys, each group sorted by identity", () => {
    const { modal } = openModal({
      selectedKeys: ["zeta", "alpha"],
      inventory: {
        status: "ready",
        options: [
          // Labels deliberately sort differently from key identity.
          { key: "gamma", label: "aaa-gamma", available: true },
          { key: "zeta", label: "ZZZ Zeta", available: true },
          { key: "beta", label: "beta", available: true },
          { key: "alpha", label: "yyy-alpha", available: true },
        ],
      },
    });

    expect(rowNames(modal)).toEqual(["yyy-alpha", "ZZZ Zeta", "beta", "aaa-gamma"]);
    const toggles = rowSettings(modal).map((setting) => setting.toggles[0]?.value);
    expect(toggles).toEqual([true, true, false, false]);
  });

  it("filters rows by label or identity on search without touching the draft", async () => {
    const { modal, onSubmit } = openModal({
      inventory: {
        status: "ready",
        options: [
          { key: "alpha", label: "Alpha Label", available: true },
          { key: "beta", label: "Beta", available: true },
        ],
      },
    });

    // Toggle beta on, then hide it behind a search; the draft must survive.
    rowSettings(modal)[1]?.toggles[0]?.onChange?.(true);
    searchInput(modal).onChange?.("alpha label");
    expect(rowNames(modal)).toEqual(["Alpha Label"]);

    searchInput(modal).onChange?.("beta");
    expect(rowNames(modal)).toEqual(["Beta"]);

    clickDone(modal);
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(["beta"]);
  });

  it("toggles only the draft: no save and no re-render until Done", () => {
    const { modal, onSubmit } = openModal({
      selectedKeys: ["alpha"],
      inventory: {
        status: "ready",
        options: [
          { key: "alpha", label: "alpha", available: true },
          { key: "beta", label: "beta", available: true },
        ],
      },
    });

    const before = rowNames(modal);
    rowSettings(modal)[1]?.toggles[0]?.onChange?.(true);
    expect(onSubmit).not.toHaveBeenCalled();
    // No re-render: rows keep their initial grouping and identity.
    expect(rowSettings(modal)[1]?.toggles[0]?.value).toBe(false);
    expect(rowNames(modal)).toEqual(before);
  });

  it("keeps a stale selected key listed as unavailable and removable", async () => {
    const { modal, onSubmit } = openModal({
      selectedKeys: ["ghost"],
      inventory: {
        status: "ready",
        options: [{ key: "real", label: "real", available: true }],
      },
    });

    expect(rowNames(modal)).toEqual(["ghost", "real"]);
    const ghost = rowSettings(modal)[0];
    expect(ghost?.classes).toContain("fce-property-picker__unavailable");
    expect(ghost?.desc).toBe(strings.property.unavailable);
    expect(ghost?.toggles[0]?.value).toBe(true);

    ghost?.toggles[0]?.onChange?.(false);
    clickDone(modal);
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith([]);
  });

  it("never erases current selections from inventory status alone", async () => {
    const { modal, onSubmit } = openModal({
      selectedKeys: ["ghost"],
      inventory: { status: "unavailable", options: [] },
    });

    // Still listed and removable even when the inventory is unavailable.
    expect(rowNames(modal)).toEqual(["ghost"]);
    clickDone(modal);
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows the empty copy for a ready inventory with no properties", () => {
    const { modal } = openModal({ inventory: { status: "ready", options: [] } });

    expect(noticeTexts(modal)).toEqual([strings.property.emptyNoProperties]);
    expect(rowSettings(modal)).toHaveLength(0);
  });

  it("shows discovered options plus a non-blocking warning for a partial inventory", () => {
    const { modal } = openModal({
      inventory: {
        status: "partial",
        options: [{ key: "alpha", label: "alpha", available: true }],
      },
    });

    expect(noticeTexts(modal)).toEqual([strings.property.partialWarning]);
    expect(rowNames(modal)).toEqual(["alpha"]);
  });

  it("shows the unavailable copy and still allows cancellation", () => {
    const { modal, onSubmit } = openModal({ inventory: { status: "unavailable", options: [] } });

    expect(noticeTexts(modal)).toEqual([strings.property.unavailable]);
    clickCancel(modal);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("writes nothing on Cancel even after draft edits", () => {
    const { modal, onSubmit } = openModal({
      inventory: {
        status: "ready",
        options: [{ key: "alpha", label: "alpha", available: true }],
      },
    });

    rowSettings(modal)[0]?.toggles[0]?.onChange?.(true);
    clickCancel(modal);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("writes nothing on a no-change Done but still closes", async () => {
    const { modal, onSubmit } = openModal({
      selectedKeys: ["alpha"],
      inventory: {
        status: "ready",
        options: [{ key: "alpha", label: "alpha", available: true }],
      },
    });

    clickDone(modal);
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
    expect((modal as unknown as { closeCount: number }).closeCount).toBe(1);
  });

  it("commits the normalized draft exactly once on Done", async () => {
    const { modal, onSubmit } = openModal({
      selectedKeys: ["alpha"],
      inventory: {
        status: "ready",
        options: [
          { key: "alpha", label: "alpha", available: true },
          { key: "gamma", label: "gamma", available: true },
          { key: "beta", label: "beta", available: true },
        ],
      },
    });

    // Rows: alpha (selected), then beta, gamma (remaining, identity-sorted).
    rowSettings(modal)[0]?.toggles[0]?.onChange?.(false);
    rowSettings(modal)[1]?.toggles[0]?.onChange?.(true);
    rowSettings(modal)[2]?.toggles[0]?.onChange?.(true);
    clickDone(modal);
    await flush();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(["beta", "gamma"]);
    expect((modal as unknown as { closeCount: number }).closeCount).toBe(1);
  });

  it("keeps the modal open after a rejected submit and permits retry", async () => {
    const deferreds: Deferred[] = [];
    class TestPickerModal extends PropertyPickerModal {
      triggerSubmit(): Promise<void> {
        return this.submit();
      }
    }
    const onSubmit = vi.fn((_keys: string[]) => {
      const deferred = createDeferred();
      deferreds.push(deferred);
      return deferred.promise;
    });
    const modal = new TestPickerModal({} as never, {
      strings,
      selectedKeys: [],
      collectPropertyInventory: () => ({
        status: "ready",
        options: [{ key: "alpha", label: "alpha", available: true }],
      }),
      onSubmit,
    });
    modal.open();

    rowSettings(modal)[0]?.toggles[0]?.onChange?.(true);

    const first = modal.triggerSubmit();
    const firstAssertion = expect(first).rejects.toThrow("save failed");
    deferreds[0]?.reject(new Error("save failed"));
    await firstAssertion;
    expect((modal as unknown as { closeCount: number }).closeCount).toBe(0);
    expect(contentOf(modal).isConnected).toBe(true);

    const second = modal.triggerSubmit();
    deferreds[1]?.resolve();
    await second;
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect((modal as unknown as { closeCount: number }).closeCount).toBe(1);
  });

  it("runs a single submit flight even when Done is clicked repeatedly", async () => {
    const deferred = createDeferred();
    const onSubmit = vi.fn((_keys: string[]) => deferred.promise);
    const { modal } = openModal({
      inventory: {
        status: "ready",
        options: [{ key: "alpha", label: "alpha", available: true }],
      },
      onSubmit,
    });

    rowSettings(modal)[0]?.toggles[0]?.onChange?.(true);
    clickDone(modal);
    clickDone(modal);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    deferred.resolve();
    await flush();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect((modal as unknown as { closeCount: number }).closeCount).toBe(1);
  });
});
