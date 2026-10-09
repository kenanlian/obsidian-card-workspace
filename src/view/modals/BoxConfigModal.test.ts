import { describe, expect, it, vi } from "vitest";
import {
  asMock,
  requireGroup,
  settingsIn,
  type MockEl,
  type Setting,
} from "../../__mocks__/obsidian-modal-mock";
import { getUiStrings } from "../../i18n";
import { describeBoxRule } from "../box-rule-identity";
import type { CardBoxDefinition, Rule } from "../types";

vi.mock("obsidian", async () => await import("../../__mocks__/obsidian-modal-mock"));

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

let current: InstanceType<typeof BoxConfigModal>;

function contentOf(modal: InstanceType<typeof BoxConfigModal> = current): MockEl {
  return modal.contentEl as unknown as MockEl;
}

function openModal(box: CardBoxDefinition = createBox(), locale: "en" | "zh" = "en", visiblePropertyKeys: string[] = []) {
  const onConfirm = vi.fn(async (_confirmed: CardBoxDefinition) => {});
  const modal = new BoxConfigModal({} as never, {
    box,
    visiblePropertyKeys,
    strings: getUiStrings(locale),
    describeRule: (rule) => `${rule.folder} (${rule.tags.join(",")})`,
    isRuleFolderMissing: () => false,
    describeMemberPath: (path) => path,
    onConfirm,
  });
  modal.open();
  current = modal;
  return { box, modal, onConfirm };
}

function ruleSettings(): Setting[] {
  return requireGroup(contentOf(), strings.box.rulesHeading).settings.filter((setting) => setting.texts.length > 0);
}

async function clickButton(text: string): Promise<void> {
  await asMock(current).buttons.find((candidate) => candidate.text === text)?.click();
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("BoxConfigModal rule names", () => {
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

    const before = requireGroup(contentOf(), strings.box.rulesHeading);
    ruleSettings()[1]?.texts[0]?.type("Inbox");
    expect(requireGroup(contentOf(), strings.box.rulesHeading)).toBe(before);
  });

  it("confirms only the edited rule's name and preserves both rule ids", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[1]?.texts[0]?.type("Inbox");
    await clickButton(strings.box.done);
    await flush();

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules.map((rule) => rule.id)).toEqual(["rule-1", "rule-2"]);
    expect(confirmed.rules.map((rule) => rule.name)).toEqual(["", "Inbox"]);
  });

  it("passes an all-whitespace name through to the confirm handler", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[0]?.texts[0]?.type("   ");
    await clickButton(strings.box.done);
    await flush();

    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules[0]?.name).toBe("   ");
  });

  it("retains the box group on the confirmed draft", async () => {
    const { box, onConfirm } = openModal();

    await clickButton(strings.box.done);
    await flush();

    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.group).toEqual(box.group);
    expect(confirmed.group).not.toBe(box.group);
  });

  it("does not confirm when cancel is pressed", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[1]?.texts[0]?.type("Inbox");
    await clickButton(strings.box.cancel);
    await flush();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("removes the rule at the clicked index while another name field holds a draft edit", async () => {
    const { onConfirm } = openModal();

    ruleSettings()[1]?.texts[0]?.type("Inbox");
    expect(() => ruleSettings()[0]?.extraButtons[0]?.click()).not.toThrow();

    const remaining = ruleSettings();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.texts[0]?.value).toBe("Inbox");

    await clickButton(strings.box.done);
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
      visiblePropertyKeys: [],
      strings,
      describeRule: (rule) => describeBoxRule(strings, rule),
      isRuleFolderMissing: () => false,
      describeMemberPath: (path) => path,
      onConfirm: vi.fn(async () => {}),
    });
    modal.open();
    current = modal;

    expect(ruleSettings()[0]?.name).toBe(
      `Projects (${strings.box.ruleSubfolderSuffix})${strings.box.rulePropertiesSeparator}status: open`,
    );
  });

  it("isolates the draft's property clauses from the source box (V-E)", async () => {
    const clause = { key: "status", values: [{ kind: "text" as const, value: "open" }] };
    const box = createBox();
    box.rules = [createRule({ properties: [clause] })];
    const { onConfirm } = openModal(box);

    ruleSettings()[0]?.texts[0]?.type("Renamed");
    expect(() => ruleSettings()[0]?.extraButtons[0]?.click()).not.toThrow();
    await clickButton(strings.box.done);
    await flush();

    expect(box.rules).toHaveLength(1);
    expect(box.rules[0]?.name).toBe("");
    expect(box.rules[0]?.properties).toEqual([clause]);
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.rules).toHaveLength(0);
  });
});

describe("BoxConfigModal grouping", () => {
  it.each(["en", "zh"] as const)("edits box grouping in %s without mutating the source or rebuilding the body", async (locale) => {
    const { box, onConfirm } = openModal(createBox(), locale, ["status", "priority"]);
    const ui = getUiStrings(locale);
    const group = requireGroup(contentOf(), ui.box.groupHeading);
    const [dimension, property, orderBy, orderDirection] = group.settings;

    expect(dimension?.name).toBe(ui.sortGroup.groupHeading);
    expect(dimension?.dropdowns[0]?.value).toBe("box-rule");
    expect(dimension?.dropdowns[0]?.options.map((option) => option.label)).toEqual([
      ui.sortGroup.dimensionNone, ui.sortGroup.dimensionFolder, ui.sortGroup.dimensionTag,
      ui.sortGroup.dimensionTask, ui.sortGroup.dimensionProperty, ui.sortGroup.dimensionBoxRule,
    ]);
    expect(property?.settingEl.style.display).toBe("none");
    expect(orderBy?.dropdowns[0]?.value).toBe("name");
    expect(orderDirection?.dropdowns[0]?.value).toBe("desc");

    dimension?.dropdowns[0]?.select("property");
    expect(property?.settingEl.style.display).toBe("");
    property?.dropdowns[0]?.select("priority");
    orderBy?.dropdowns[0]?.select("count");
    orderDirection?.dropdowns[0]?.select("asc");
    dimension?.dropdowns[0]?.select("tag");
    dimension?.dropdowns[0]?.select("property");
    expect(property?.dropdowns[0]?.value).toBe("priority");
    expect(requireGroup(contentOf(), ui.box.groupHeading)).toBe(group);
    expect(box.group).toEqual({ dimension: "box-rule", orderBy: "name", orderDirection: "desc" });
    expect(onConfirm).not.toHaveBeenCalled();

    await clickButton(ui.box.done);
    await flush();
    expect(onConfirm.mock.calls[0]?.[0].group).toEqual({
      dimension: "property", propertyKey: "priority", orderBy: "count", orderDirection: "asc",
    });
  });

  it("hides group ordering for an ungrouped box and clears the property key on a dimension change", async () => {
    const box = createBox();
    box.group = { dimension: "property", propertyKey: "priority", orderBy: "count", orderDirection: "desc" };
    const { onConfirm } = openModal(box, "en", ["status", "priority"]);
    const [dimension, property, orderBy, orderDirection] = requireGroup(contentOf(), strings.box.groupHeading).settings;

    expect(property?.dropdowns[0]?.value).toBe("priority");
    dimension?.dropdowns[0]?.select("none");
    expect(property?.settingEl.style.display).toBe("none");
    expect(orderBy?.settingEl.style.display).toBe("none");
    expect(orderDirection?.settingEl.style.display).toBe("none");
    dimension?.dropdowns[0]?.select("folder");
    expect(orderBy?.settingEl.style.display).toBe("");
    expect(orderDirection?.settingEl.style.display).toBe("");

    await clickButton(strings.box.done);
    await flush();
    expect(onConfirm.mock.calls[0]?.[0].group).toEqual({ dimension: "folder", orderBy: "count", orderDirection: "desc" });
  });

  it("omits property grouping when no properties are enabled and explains how to enable it", () => {
    openModal();
    const row = requireGroup(contentOf(), strings.box.groupHeading).settings[0];
    expect(row?.dropdowns[0]?.options.map((option) => option.value)).toEqual(["none", "folder", "tag", "task", "box-rule"]);
    expect(row?.desc).toBe(strings.sortGroup.enablePropertyHint);
  });

  it("discards grouping edits on cancel", async () => {
    const { box, onConfirm } = openModal();
    const [dimension] = requireGroup(contentOf(), strings.box.groupHeading).settings;
    dimension?.dropdowns[0]?.select("task");
    await clickButton(strings.box.cancel);
    await flush();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(box.group).toEqual({ dimension: "box-rule", orderBy: "name", orderDirection: "desc" });
  });
});

describe("BoxConfigModal layout", () => {
  function createPopulatedBox(): CardBoxDefinition {
    return {
      ...createBox(),
      manualPaths: ["Inbox/a.md", "Inbox/b.md"],
      excludedPaths: ["Old/c.md", "Old/d.md"],
    };
  }

  it("uses the native footer with the primary action before cancel and a scrolling body", () => {
    const { modal } = openModal();

    expect(asMock(modal).buttons.map((button) => button.text)).toEqual([strings.box.done, strings.box.cancel]);
    expect(asMock(modal).buttons[0]?.cta).toBe(true);
    expect(asMock(modal).modalEl.hasClass("mod-scrollable-content")).toBe(true);
    expect(asMock(modal).title).toBe(strings.box.configTitle("Reading"));
  });

  it("renders sort, grouping, rules, manual, and removed groups in order", () => {
    openModal();

    const content = contentOf();
    const headings = content.nodes.map((node) => (node as { heading?: string }).heading);
    expect(headings).toEqual([
      "",
      strings.box.groupHeading,
      strings.box.rulesHeading,
      strings.box.manualHeading,
      strings.box.excludedHeading,
    ]);
  });

  it("seeds the sort dropdown from the box and confirms a changed sort", async () => {
    const { onConfirm } = openModal();

    const sortRow = settingsIn(contentOf())[0];
    expect(sortRow?.name).toBe(strings.box.sortHeading);
    expect(sortRow?.dropdowns[0]?.value).toBe("mtime:desc");
    expect(sortRow?.dropdowns[0]?.options.map((option) => option.label)).toEqual([
      strings.toolbar.sortOptions.mtimeDesc,
      strings.toolbar.sortOptions.mtimeAsc,
      strings.toolbar.sortOptions.ctimeDesc,
      strings.toolbar.sortOptions.ctimeAsc,
      strings.toolbar.sortOptions.nameAsc,
      strings.toolbar.sortOptions.nameDesc,
    ]);

    sortRow?.dropdowns[0]?.select("name:asc");
    await clickButton(strings.box.done);
    await flush();

    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.sort).toEqual({ field: "name", direction: "asc" });
  });

  it("shows an empty-state row in each list group that has no entries", () => {
    const box = createBox();
    box.rules = [];
    openModal(box);

    for (const [heading, message] of [
      [strings.box.rulesHeading, strings.box.noRules],
      [strings.box.manualHeading, strings.box.noManualMembers],
      [strings.box.excludedHeading, strings.box.noExcludedMembers],
    ] as const) {
      const group = requireGroup(contentOf(), heading);
      expect(group.settings.map((setting) => setting.name)).toEqual([message]);
      expect(group.settings[0]?.classes).toContain("mod-empty-state");
    }
    expect(requireGroup(contentOf(), strings.box.excludedHeading).extraButtons).toHaveLength(0);
  });

  it("flags a rule whose folder is gone without changing its row structure", () => {
    const modal = new BoxConfigModal({} as never, {
      box: createBox(),
      visiblePropertyKeys: [],
      strings,
      describeRule: (rule) => rule.folder,
      isRuleFolderMissing: (rule) => rule.id === "rule-2",
      describeMemberPath: (path) => path,
      onConfirm: vi.fn(async () => {}),
    });
    modal.open();
    current = modal;

    const [first, second] = ruleSettings();
    expect(first?.desc).toBe("");
    expect(second?.desc).toBe(strings.box.ruleFolderMissing);
    expect(second?.classes).toContain("fce-box-config__rule-missing");
  });

  it("removes a manual member from the draft with a close icon", async () => {
    const { onConfirm } = openModal(createPopulatedBox());

    const manual = requireGroup(contentOf(), strings.box.manualHeading);
    expect(manual.settings.map((setting) => [setting.name, setting.desc])).toEqual([
      ["Inbox/a.md", "Inbox/a.md"],
      ["Inbox/b.md", "Inbox/b.md"],
    ]);
    expect(manual.settings[0]?.extraButtons[0]).toMatchObject({
      icon: "x",
      tooltip: strings.box.removeManualMember,
    });

    manual.settings[0]?.extraButtons[0]?.click();
    expect(
      requireGroup(contentOf(), strings.box.manualHeading).settings.map((setting) => setting.name),
    ).toEqual(["Inbox/b.md"]);

    await clickButton(strings.box.done);
    await flush();
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.manualPaths).toEqual(["Inbox/b.md"]);
  });

  it("restores one removed note from its row", async () => {
    const { onConfirm } = openModal(createPopulatedBox());

    const excluded = requireGroup(contentOf(), strings.box.excludedHeading);
    expect(excluded.settings[0]?.extraButtons[0]).toMatchObject({
      icon: "undo-2",
      tooltip: strings.box.restoreExcluded,
    });
    excluded.settings[0]?.extraButtons[0]?.click();

    expect(
      requireGroup(contentOf(), strings.box.excludedHeading).settings.map((setting) => setting.name),
    ).toEqual(["Old/d.md"]);

    await clickButton(strings.box.done);
    await flush();
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.excludedPaths).toEqual(["Old/d.md"]);
  });

  it("restores every removed note from the group header", async () => {
    const { onConfirm } = openModal(createPopulatedBox());

    const header = requireGroup(contentOf(), strings.box.excludedHeading).extraButtons[0];
    expect(header).toMatchObject({ icon: "rotate-ccw", tooltip: strings.box.restoreAllExcluded });
    header?.click();

    const refreshed = requireGroup(contentOf(), strings.box.excludedHeading);
    expect(refreshed.settings.map((setting) => setting.name)).toEqual([strings.box.noExcludedMembers]);
    expect(refreshed.extraButtons).toHaveLength(0);

    await clickButton(strings.box.done);
    await flush();
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.excludedPaths).toEqual([]);
  });

  it("closes after a confirmed Done and stays open while the save is pending", async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => {
      finish = resolve;
    }));
    const modal = new BoxConfigModal({} as never, {
      box: createBox(),
      visiblePropertyKeys: [],
      strings,
      describeRule: (rule) => rule.folder,
      isRuleFolderMissing: () => false,
      describeMemberPath: (path) => path,
      onConfirm,
    });
    modal.open();
    current = modal;

    await clickButton(strings.box.done);
    await clickButton(strings.box.done);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(asMock(modal).closeCount).toBe(0);
    expect(asMock(modal).buttons[0]?.disabled).toBe(true);

    finish();
    await flush();
    expect(asMock(modal).closeCount).toBe(1);
  });
});
