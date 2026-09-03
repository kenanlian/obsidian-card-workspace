import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../../i18n";
import { describeBoxRule } from "../box-rule-identity";
import type { CardBoxDefinition, Rule } from "../types";

interface TextRecord {
  placeholder: string;
  value: string;
  ariaLabel: string;
  onChange: ((value: string) => void) | null;
}

interface ButtonRecord {
  text: string;
  icon: string;
  cta: boolean;
  onClick: (() => void) | null;
}

interface SettingRecord {
  name: string;
  desc: string;
  classes: string[];
  texts: TextRecord[];
  buttons: ButtonRecord[];
  extraButtons: ButtonRecord[];
}

const mockState = vi.hoisted(() => ({
  settings: [] as SettingRecord[],
  title: "",
}));

vi.mock("obsidian", () => {
  class MockElement {
    addClass(): void {}

    empty(): void {
      mockState.settings.length = 0;
    }

    createEl(): MockElement {
      return new MockElement();
    }

    createDiv(): MockElement {
      return new MockElement();
    }
  }

  class Modal {
    app: unknown;
    contentEl = new MockElement();

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
      (this as unknown as { onClose?: () => void }).onClose?.();
    }
  }

  class Setting {
    private readonly record: SettingRecord;

    constructor(_containerEl: unknown) {
      this.record = { name: "", desc: "", classes: [], texts: [], buttons: [], extraButtons: [] };
      mockState.settings.push(this.record);
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

    addDropdown(configure: (dropdown: unknown) => void): this {
      const chain = {
        addOption: () => chain,
        setValue: () => chain,
        onChange: () => chain,
      };
      configure(chain);
      return this;
    }

    addExtraButton(configure: (button: unknown) => void): this {
      const record: ButtonRecord = { text: "", icon: "", cta: false, onClick: null };
      const chain = {
        setIcon: (icon: string) => {
          record.icon = icon;
          return chain;
        },
        setTooltip: () => chain,
        onClick: (handler: () => void) => {
          record.onClick = handler;
          return chain;
        },
      };
      configure(chain);
      this.record.extraButtons.push(record);
      return this;
    }

    addButton(configure: (button: unknown) => void): this {
      const record: ButtonRecord = { text: "", icon: "", cta: false, onClick: null };
      const chain = {
        setButtonText: (text: string) => {
          record.text = text;
          return chain;
        },
        setCta: () => {
          record.cta = true;
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

const { BoxConfigModal } = await import("./BoxConfigModal");

const strings = getUiStrings("en");

function createRule(partial: Partial<Rule> = {}): Rule {
  return {
    folder: "Projects",
    includeSubfolders: true,
    tags: [],
    properties: [],
    id: "rule-1",
    name: "",
    ...partial,
  };
}

function createBox(): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Reading",
    rules: [
      createRule(),
      createRule({ folder: "Notes", includeSubfolders: false, tags: ["#todo"], id: "rule-2", name: "Todo notes" }),
    ],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    group: { dimension: "box-rule", orderBy: "name", orderDirection: "desc" },
  };
}

function openModal(box: CardBoxDefinition = createBox()) {
  const onConfirm = vi.fn(async (_confirmed: CardBoxDefinition) => {});
  const modal = new BoxConfigModal({} as never, {
    box,
    strings,
    describeRule: (rule) => `${rule.folder} (${rule.tags.join(",")})`,
    isRuleFolderMissing: () => false,
    describeMemberPath: (path) => path,
    onConfirm,
  });
  modal.open();
  return { box, modal, onConfirm };
}

function ruleSettings(): SettingRecord[] {
  return mockState.settings.filter((setting) => setting.texts.length > 0);
}

function clickButton(text: string): void {
  const button = mockState.settings
    .flatMap((setting) => setting.buttons)
    .find((candidate) => candidate.text === text);
  button?.onClick?.();
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BoxConfigModal rule names", () => {
  beforeEach(() => {
    mockState.settings.length = 0;
    mockState.title = "";
  });

  it("renders one name input per rule seeded from the rule name", () => {
    openModal();

    const rules = ruleSettings();
    expect(rules).toHaveLength(2);
    expect(rules.map((setting) => setting.texts[0]?.value)).toEqual(["", "Todo notes"]);
    expect(rules[0]?.texts[0]?.placeholder).toBe(strings.box.ruleNamePlaceholder);
    expect(rules[0]?.texts[0]?.ariaLabel).toBe(strings.box.ruleNameLabel);
  });

  it("keeps the derived rule description as the setting name", () => {
    openModal();

    expect(ruleSettings().map((setting) => setting.name)).toEqual([
      "Projects ()",
      "Notes (#todo)",
    ]);
  });

  it("does not re-render while a name input is edited", () => {
    openModal();

    const before = mockState.settings.length;
    ruleSettings()[1]?.texts[0]?.onChange?.("Inbox");
    expect(mockState.settings.length).toBe(before);
  });

  it("confirms only the edited rule's name and preserves both rule ids", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[1]?.texts[0]?.onChange?.("Inbox");
    clickButton(strings.box.done);
    await flush();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules.map((rule) => rule.id)).toEqual(["rule-1", "rule-2"]);
    expect(confirmed.rules.map((rule) => rule.name)).toEqual(["", "Inbox"]);
  });

  it("passes an all-whitespace name through to the confirm handler", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[0]?.texts[0]?.onChange?.("   ");
    clickButton(strings.box.done);
    await flush();

    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules[0]?.name).toBe("   ");
  });

  it("retains the box group on the confirmed draft", async () => {
    const { box, onConfirm } = openModal();

    clickButton(strings.box.done);
    await flush();

    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.group).toEqual(box.group);
    expect(confirmed.group).not.toBe(box.group);
  });

  it("does not confirm when cancel is pressed", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[1]?.texts[0]?.onChange?.("Inbox");
    clickButton(strings.box.cancel);
    await flush();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("removes the rule at the clicked index while another name field holds a draft edit", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[1]?.texts[0]?.onChange?.("Inbox");
    expect(() => ruleSettings()[0]?.extraButtons[0]?.onClick?.()).not.toThrow();

    const remaining = ruleSettings();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.texts[0]?.value).toBe("Inbox");

    clickButton(strings.box.done);
    await flush();

    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules).toHaveLength(1);
    expect(confirmed.rules[0]?.id).toBe("rule-2");
    expect(confirmed.rules[0]?.name).toBe("Inbox");
  });

  it("shows the property summary in the rule row title via describeRule (S7/V-E)", () => {
    const box = createBox();
    box.rules = [
      createRule({
        properties: [{ key: "status", values: [{ kind: "text", value: "open" }] }],
      }),
    ];
    const modal = new BoxConfigModal({} as never, {
      box,
      strings,
      describeRule: (rule) => describeBoxRule(strings, rule),
      isRuleFolderMissing: () => false,
      describeMemberPath: (path) => path,
      onConfirm: vi.fn(async () => {}),
    });
    modal.open();

    expect(ruleSettings()[0]?.name).toBe(
      `Projects (${strings.box.ruleSubfolderSuffix})${strings.box.rulePropertiesSeparator}status: open`,
    );
  });

  it("isolates the draft's property clauses from the source box (V-E)", async () => {
    const clause = { key: "status", values: [{ kind: "text" as const, value: "open" }] };
    const box = createBox();
    box.rules = [createRule({ properties: [clause] })];
    const { onConfirm } = openModal(box);

    ruleSettings()[0]?.texts[0]?.onChange?.("Renamed");
    expect(() => ruleSettings()[0]?.extraButtons[0]?.onClick?.()).not.toThrow();
    clickButton(strings.box.done);
    await flush();

    expect(box.rules).toHaveLength(1);
    expect(box.rules[0]?.name).toBe("");
    expect(box.rules[0]?.properties).toEqual([clause]);
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules).toHaveLength(0);
  });
});
