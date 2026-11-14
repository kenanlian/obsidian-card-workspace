import { describe, expect, it, vi } from "vitest";
import {
  asMock,
  elementsIn,
  groupsIn,
  type MockEl,
  type Setting,
  type SettingGroup,
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

function sectionEl(heading: string): MockEl {
  const found = elementsIn(contentOf(), (el) => el.hasClass("fce-box-config-section")
    && elementsIn(el, (child) => child.hasClass("fce-box-config-section__title") && child.text === heading).length > 0)[0];
  if (!found) throw new Error(`section not rendered: ${heading}`);
  return found;
}

function sectionPart(heading: string, cls: string): MockEl {
  const found = elementsIn(sectionEl(heading), (el) => el.hasClass(cls))[0];
  if (!found) throw new Error(`${cls} not rendered in ${heading}`);
  return found;
}

function toggleSection(heading: string): void {
  sectionPart(heading, "fce-box-config-section__toggle").dispatch("click", {});
}

/** Expands the section when needed and returns its settings group. */
function section(heading: string): SettingGroup {
  if (sectionEl(heading).hasClass("is-collapsed")) toggleSection(heading);
  const group = groupsIn(sectionEl(heading))[0];
  if (!group) throw new Error(`section group not rendered: ${heading}`);
  return group;
}

function ruleSettings(): Setting[] {
  return section(strings.box.rulesHeading).settings.filter((setting) => setting.texts.length > 0);
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

    const before = section(strings.box.rulesHeading);
    ruleSettings()[1]?.texts[0]?.type("Inbox");
    expect(section(strings.box.rulesHeading)).toBe(before);
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
  it.each(["en", "zh"] as const)("saves time granularity and shows it only for time grouping in %s", async (locale) => {
    const { onConfirm } = openModal(createBox(), locale);
    const ui = getUiStrings(locale);
    const [dimension, , grain] = section(ui.box.groupHeading).settings;
    expect(grain?.settingEl.style.display).toBe("none");
    dimension?.dropdowns[0]?.select("ctime");
    expect(grain?.settingEl.style.display).toBe("");
    expect(grain?.dropdowns[0]?.value).toBe("day");
    grain?.dropdowns[0]?.select("biweek");
    dimension?.dropdowns[0]?.select("mtime");
    expect(grain?.dropdowns[0]?.value).toBe("biweek");
    await clickButton(ui.box.done); await flush();
    expect(onConfirm.mock.calls[0]?.[0].group).toMatchObject({ dimension: "mtime", timeGranularity: "biweek" });
  });
  it.each(["en", "zh"] as const)("edits box grouping in %s without mutating the source or rebuilding the body", async (locale) => {
    const { box, onConfirm } = openModal(createBox(), locale, ["status", "priority"]);
    const ui = getUiStrings(locale);
    const group = section(ui.box.groupHeading);
    const [dimension, property, , orderBy, orderDirection] = group.settings;

    expect(dimension?.name).toBe(ui.sortGroup.groupHeading);
    expect(dimension?.dropdowns[0]?.value).toBe("box-rule");
    expect(dimension?.dropdowns[0]?.options.map((option) => option.label)).toEqual([
      ui.sortGroup.dimensionNone, ui.sortGroup.dimensionFolder, ui.sortGroup.dimensionTag,
      ui.sortGroup.dimensionTask, ui.sortGroup.dimensionProperty, ui.sortGroup.dimensionBoxRule,
      ui.sortGroup.dimensionCtime, ui.sortGroup.dimensionMtime,
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
    expect(section(ui.box.groupHeading)).toBe(group);
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
    const [dimension, property, , orderBy, orderDirection] = section(strings.box.groupHeading).settings;

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
    const row = section(strings.box.groupHeading).settings[0];
    expect(row?.dropdowns[0]?.options.map((option) => option.value)).toEqual(["none", "folder", "tag", "task", "box-rule", "ctime", "mtime"]);
    expect(row?.desc).toBe(strings.sortGroup.enablePropertyHint);
  });

  it("discards grouping edits on cancel", async () => {
    const { box, onConfirm } = openModal();
    const [dimension] = section(strings.box.groupHeading).settings;
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

  it.each(["en", "zh"] as const)("renders rules, manual, removed, sort, and grouping headings in order in %s", (locale) => {
    openModal(createBox(), locale);
    const ui = getUiStrings(locale);

    const headings = elementsIn(contentOf(), (el) => el.hasClass("fce-box-config-section__title")).map((el) => el.text);
    expect(headings).toEqual([
      ui.box.rulesHeading,
      ui.box.manualHeading,
      ui.box.excludedHeading,
      ui.box.sortHeading,
      ui.box.groupHeading,
      ui.box.drawTitle,
    ]);
  });

  it.each(["en", "zh"] as const)("opens with only rules expanded and summarizes collapsed sections in %s", (locale) => {
    const box = { ...createPopulatedBox(), draw: { mode: "daily" as const, count: 3 } };
    openModal(box, locale);
    const ui = getUiStrings(locale);

    expect(groupsIn(contentOf())).toHaveLength(1);
    expect(sectionPart(ui.box.rulesHeading, "fce-box-config-section__toggle").attrs["aria-expanded"]).toBe("true");
    for (const heading of [ui.box.manualHeading, ui.box.excludedHeading, ui.box.sortHeading, ui.box.groupHeading, ui.box.drawTitle]) {
      expect(sectionEl(heading).hasClass("is-collapsed")).toBe(true);
      expect(sectionPart(heading, "fce-box-config-section__toggle").attrs["aria-expanded"]).toBe("false");
    }
    expect(sectionPart(ui.box.rulesHeading, "fce-box-config-section__count").text).toBe("2");
    expect(sectionPart(ui.box.manualHeading, "fce-box-config-section__count").text).toBe("2");
    expect(sectionPart(ui.box.sortHeading, "fce-box-config-section__summary").text).toBe(ui.toolbar.sortOptions.mtimeDesc);
    expect(sectionPart(ui.box.groupHeading, "fce-box-config-section__summary").text).toBe(ui.sortGroup.dimensionBoxRule);
    expect(sectionPart(ui.box.drawTitle, "fce-box-config-section__summary").text)
      .toBe(`${ui.box.drawDaily} · ${ui.box.drawCountSummary(3)}`);
  });

  it("keeps draft edits and focus when a section is collapsed and reopened", async () => {
    const { onConfirm } = openModal();

    section(strings.box.sortHeading).settings[0]?.dropdowns[0]?.select("name:asc");
    toggleSection(strings.box.sortHeading);
    expect(sectionEl(strings.box.sortHeading).hasClass("is-collapsed")).toBe(true);
    expect(sectionPart(strings.box.sortHeading, "fce-box-config-section__toggle").focused).toBe(true);
    expect(sectionPart(strings.box.sortHeading, "fce-box-config-section__summary").text).toBe(strings.toolbar.sortOptions.nameAsc);
    expect(section(strings.box.sortHeading).settings[0]?.dropdowns[0]?.value).toBe("name:asc");

    await clickButton(strings.box.done);
    await flush();
    expect(onConfirm.mock.calls[0]?.[0].sort).toEqual({ field: "name", direction: "asc" });
  });

  it("previews five members of a long list until show all is pressed", () => {
    const manualPaths = Array.from({ length: 8 }, (_, index) => `Inbox/${index}.md`);
    openModal({ ...createBox(), manualPaths });

    const preview = section(strings.box.manualHeading).settings;
    expect(preview.slice(0, 5).map((setting) => setting.name)).toEqual(manualPaths.slice(0, 5));
    const more = preview[5];
    expect(preview).toHaveLength(6);
    expect(more?.classes).toContain("fce-box-config__show-all");
    expect(more?.buttons[0]?.text).toBe(strings.box.showAllItems(8));

    more?.buttons[0]?.click();
    expect(section(strings.box.manualHeading).settings.map((setting) => setting.name)).toEqual(manualPaths);
  });

  it("seeds the sort dropdown from the box and confirms a changed sort", async () => {
    const { onConfirm } = openModal();

    const sortRow = section(strings.box.sortHeading).settings[0];
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
      const group = section(heading);
      expect(group.settings.map((setting) => setting.name)).toEqual([message]);
      expect(group.settings[0]?.classes).toContain("mod-empty-state");
    }
    expect(sectionPart(strings.box.excludedHeading, "fce-box-config-section__header").buttons).toHaveLength(0);
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

    const manual = section(strings.box.manualHeading);
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
      section(strings.box.manualHeading).settings.map((setting) => setting.name),
    ).toEqual(["Inbox/b.md"]);

    await clickButton(strings.box.done);
    await flush();
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.manualPaths).toEqual(["Inbox/b.md"]);
  });

  it("restores one removed note from its row", async () => {
    const { onConfirm } = openModal(createPopulatedBox());

    const excluded = section(strings.box.excludedHeading);
    expect(excluded.settings[0]?.extraButtons[0]).toMatchObject({
      icon: "undo-2",
      tooltip: strings.box.restoreExcluded,
    });
    excluded.settings[0]?.extraButtons[0]?.click();

    expect(
      section(strings.box.excludedHeading).settings.map((setting) => setting.name),
    ).toEqual(["Old/d.md"]);

    await clickButton(strings.box.done);
    await flush();
    const confirmed = onConfirm.mock.calls[0]?.[0] as CardBoxDefinition;
    expect(confirmed.excludedPaths).toEqual(["Old/d.md"]);
  });

  it("restores every removed note from the group header", async () => {
    const { onConfirm } = openModal(createPopulatedBox());

    const header = sectionPart(strings.box.excludedHeading, "fce-box-config-section__header").buttons[0];
    expect(header).toMatchObject({ icon: "rotate-ccw", tooltip: strings.box.restoreAllExcluded });
    header?.click();

    const refreshed = section(strings.box.excludedHeading);
    expect(refreshed.settings.map((setting) => setting.name)).toEqual([strings.box.noExcludedMembers]);
    expect(sectionPart(strings.box.excludedHeading, "fce-box-config-section__header").buttons).toHaveLength(0);

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

describe("BoxConfigModal draw configuration", () => {
  it.each(["en", "zh"] as const)("edits method and count as a cancelable draft in %s", async locale => {
    const source = createBox();
    const { onConfirm } = openModal(source, locale);
    const ui = getUiStrings(locale);
    const group = section(ui.box.drawTitle);
    expect(group.settings[0]?.dropdowns[0]?.value).toBe("random");
    expect(group.settings[1]?.sliders[0]?.value).toBe(5);
    group.settings[0]?.dropdowns[0]?.select("daily");
    await group.settings[1]?.sliders[0]?.slide(12);
    expect(source.draw).toBeUndefined();
    await clickButton(ui.box.done);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ draw: { mode: "daily", count: 12 } }));
  });
  it("does not persist draw draft edits on cancel", async () => {
    const { onConfirm } = openModal();
    section(strings.box.drawTitle).settings[0]?.dropdowns[0]?.select("cycle");
    await clickButton(strings.box.cancel);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
