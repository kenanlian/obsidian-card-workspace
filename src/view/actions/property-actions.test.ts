import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../../i18n";
import type {
  PropertyFilterClause,
  PropertyInventorySnapshot,
  PropertyScalarRef,
} from "../../property-filter-settings";
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type PartialPluginSettings,
  type PluginSettings,
} from "../../settings";
import type { PropertyPickerModalOptions } from "../modals/PropertyPickerModal";

const mockState = vi.hoisted(() => ({
  opened: [] as PropertyPickerModalOptions[],
  inventories: [] as PropertyInventorySnapshot[],
}));

vi.mock("../modals/PropertyPickerModal", () => ({
  PropertyPickerModal: class {
    private readonly options: PropertyPickerModalOptions;
    private readonly inventory: PropertyInventorySnapshot;

    constructor(
      _app: unknown,
      options: PropertyPickerModalOptions,
    ) {
      this.options = options;
      // Mirror the real modal, which collects the inventory exactly once in its
      // constructor so each chooser opening observes a fresh snapshot.
      this.inventory = options.collectPropertyInventory();
    }

    open(): void {
      mockState.opened.push(this.options);
      mockState.inventories.push(this.inventory);
    }
  },
}));

const { createPropertyActions, buildPropertyVisibilityPatch } = await import("./property-actions");

function clause(key: string, values: PropertyScalarRef[]): PropertyFilterClause {
  return { key, values };
}

function textRef(value: string): PropertyScalarRef {
  return { kind: "text", value };
}

function createSettings(overrides: {
  visiblePropertyKeys?: string[];
  expandedPropertyKeys?: string[];
  filterTags?: string[];
  filterProperties?: PropertyFilterClause[];
} = {}): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    // Clauses only survive normalization while their key is visible.
    visiblePropertyKeys: overrides.visiblePropertyKeys
      ?? (overrides.filterProperties ?? []).map((entry) => entry.key),
    expandedPropertyKeys: overrides.expandedPropertyKeys ?? [],
    filter: {
      tags: overrides.filterTags ?? ["keep-me"],
      properties: overrides.filterProperties ?? [],
    },
  };
}

function createHarness(
  initial: PluginSettings,
  inventory?: PropertyInventorySnapshot,
  isBoxScope = false,
) {
  let settings = initial;
  const saves: PartialPluginSettings[] = [];
  const collect = vi.fn((): PropertyInventorySnapshot => inventory ?? { status: "ready", options: [] });
  const actions = createPropertyActions({
    getApp: () => ({} as never),
    getSettings: () => settings,
    saveSettings: async (patch) => {
      saves.push(patch);
      settings = mergeSettings(settings, patch);
    },
    collectPropertyInventory: collect,
    getStrings: () => getUiStrings("en"),
    isBoxScope: () => isBoxScope,
  });
  return { actions, saves, collect, getSettings: () => settings };
}

describe("createPropertyActions", () => {
  beforeEach(() => {
    mockState.opened.length = 0;
    mockState.inventories.length = 0;
  });

  it("opens the chooser with the current selection and a fresh inventory per opening", () => {
    const snapshotA: PropertyInventorySnapshot = {
      status: "partial",
      options: [{ key: "alpha", label: "alpha", available: true }],
    };
    const snapshotB: PropertyInventorySnapshot = {
      status: "ready",
      options: [{ key: "beta", label: "beta", available: true }],
    };
    const { actions, collect } = createHarness(createSettings({ visiblePropertyKeys: ["alpha"] }));
    collect.mockReturnValueOnce(snapshotA).mockReturnValueOnce(snapshotB);

    actions.chooseVisibleProperties();
    actions.chooseVisibleProperties();

    expect(mockState.opened).toHaveLength(2);
    // Each opening invokes the injected inventory callback fresh.
    expect(collect).toHaveBeenCalledTimes(2);
    expect(mockState.inventories[0]).toEqual(snapshotA);
    expect(mockState.inventories[1]).toEqual(snapshotB);
    const options = mockState.opened[0];
    expect(options?.selectedKeys).toEqual(["alpha"]);
    expect(options?.strings.property.chooseVisible).toBe("Choose visible properties");
  });

  it("commits the chooser draft as one coherent patch", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      visiblePropertyKeys: ["alpha", "beta"],
      expandedPropertyKeys: ["alpha"],
      filterProperties: [clause("alpha", [textRef("x")]), clause("beta", [textRef("y")])],
    }));

    actions.chooseVisibleProperties();
    await mockState.opened[0]?.onSubmit(["beta", "gamma"]);

    expect(saves).toHaveLength(1);
    const patch = saves[0];
    // Visible keys set to the draft; hidden keys' expansions and clauses dropped;
    // newly enabled keys expanded. Tags are not part of the patch.
    expect(patch?.visiblePropertyKeys).toEqual(["beta", "gamma"]);
    expect(patch?.expandedPropertyKeys).toEqual(["gamma"]);
    expect(patch?.filter?.properties).toEqual([clause("beta", [textRef("y")])]);
    expect(patch?.filter && "tags" in patch.filter).toBe(false);

    const merged = getSettings();
    expect(merged.filter.tags).toEqual(["keep-me"]);
    expect(merged.filter.properties).toEqual([clause("beta", [textRef("y")])]);
    expect(merged.visiblePropertyKeys).toEqual(["beta", "gamma"]);
    expect(merged.expandedPropertyKeys).toEqual(["gamma"]);
  });

  it("clears only property filters and skips a no-op clear", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      filterProperties: [clause("alpha", [textRef("x")])],
      visiblePropertyKeys: ["alpha"],
    }));

    await actions.clearPropertyFilters();
    expect(saves).toEqual([{ filter: { properties: [] } }]);
    expect(getSettings().filter.tags).toEqual(["keep-me"]);

    await actions.clearPropertyFilters();
    expect(saves).toHaveLength(1);
  });

  it("hides a property with the same coherent cleanup as the chooser", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      visiblePropertyKeys: ["alpha", "beta"],
      expandedPropertyKeys: ["alpha", "beta"],
      filterProperties: [clause("alpha", [textRef("x")]), clause("beta", [textRef("y")])],
    }));

    await actions.hideProperty(" Alpha ");

    expect(saves).toHaveLength(1);
    expect(saves[0]?.visiblePropertyKeys).toEqual(["beta"]);
    expect(saves[0]?.expandedPropertyKeys).toEqual(["beta"]);
    expect(saves[0]?.filter?.properties).toEqual([clause("beta", [textRef("y")])]);
    expect(getSettings().visiblePropertyKeys).toEqual(["beta"]);
  });

  it("writes nothing when hiding a key that is not visible or not a key", async () => {
    const { actions, saves } = createHarness(createSettings({ visiblePropertyKeys: ["alpha"] }));

    await actions.hideProperty("ghost");
    await actions.hideProperty("   ");
    expect(saves).toHaveLength(0);
  });

  it("applies an ordinary value selection: sole value toggles off, otherwise replaces", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      filterProperties: [clause("alpha", [textRef("x")]), clause("beta", [textRef("y")])],
    }));

    await actions.applyValueFilter("alpha", textRef("x"), false);
    expect(getSettings().filter.properties).toEqual([clause("alpha", [textRef("x")])]);

    await actions.applyValueFilter("alpha", textRef("x"), false);
    expect(getSettings().filter.properties).toEqual([]);
    expect(saves).toHaveLength(2);
  });

  it("applies an additive value selection as a within-key toggle", async () => {
    const { actions, getSettings } = createHarness(createSettings({
      filterProperties: [clause("alpha", [textRef("x")])],
    }));

    await actions.applyValueFilter("alpha", textRef("z"), true);
    expect(getSettings().filter.properties).toEqual([
      clause("alpha", [textRef("x"), textRef("z")]),
    ]);

    // Toggling the last active value of a clause drops the clause.
    await actions.applyValueFilter("alpha", textRef("x"), true);
    await actions.applyValueFilter("alpha", textRef("z"), true);
    expect(getSettings().filter.properties).toEqual([]);
  });

  it("filters by only one value, replacing every clause without toggling off", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      visiblePropertyKeys: ["alpha", "beta"],
      filterProperties: [clause("alpha", [textRef("x")])],
    }));

    await actions.filterByOnlyValue("alpha", textRef("x"));
    // Already the sole active value: no-op, and crucially not cleared.
    expect(saves).toHaveLength(0);
    expect(getSettings().filter.properties).toEqual([clause("alpha", [textRef("x")])]);

    await actions.applyValueFilter("beta", textRef("y"), true);
    await actions.filterByOnlyValue("alpha", textRef("x"));
    expect(getSettings().filter.properties).toEqual([clause("alpha", [textRef("x")])]);
    expect(saves).toHaveLength(2);
  });

  it("writes nothing for value commands with an invalid key", async () => {
    const { actions, saves } = createHarness(createSettings({
      filterProperties: [clause("alpha", [textRef("x")])],
    }));

    await actions.applyValueFilter("  ", textRef("x"), false);
    await actions.filterByOnlyValue("  ", textRef("x"));
    expect(saves).toHaveLength(0);
  });

  it("writes nothing for a stale (since-hidden) key target in value commands", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      visiblePropertyKeys: ["alpha", "beta"],
      filterProperties: [clause("beta", [textRef("y")])],
    }));

    // A key menu for alpha was created while alpha was visible; the user then
    // hides alpha, leaving the menu callback stale.
    await actions.hideProperty("alpha");
    expect(saves).toHaveLength(1);

    // The stale callbacks targeting the now-hidden key must fail current-target
    // validation and neither save nor mutate.
    await actions.applyValueFilter("alpha", textRef("x"), false);
    await actions.filterByOnlyValue("alpha", textRef("x"));
    expect(saves).toHaveLength(1);
    expect(getSettings().filter.properties).toEqual([clause("beta", [textRef("y")])]);
  });

  it("writes nothing for apply/filter-by-only/clear inside a box (C6/S11/V-O)", async () => {
    const { actions, saves, getSettings } = createHarness(createSettings({
      visiblePropertyKeys: ["alpha"],
      filterProperties: [clause("alpha", [textRef("x")])],
    }), undefined, true);

    await actions.clearPropertyFilters();
    await actions.applyValueFilter("alpha", textRef("y"), true);
    await actions.applyValueFilter("alpha", textRef("x"), false);
    await actions.filterByOnlyValue("alpha", textRef("y"));

    expect(saves).toEqual([]);
    expect(getSettings().filter.properties).toEqual([clause("alpha", [textRef("x")])]);
  });

  it("keeps the chooser and hide working inside a box (C6/V-O)", async () => {
    const { actions, saves } = createHarness(createSettings({
      visiblePropertyKeys: ["alpha", "beta"],
    }), undefined, true);

    actions.chooseVisibleProperties();
    expect(mockState.opened).toHaveLength(1);
    await mockState.opened[0]?.onSubmit(["beta"]);
    expect(saves[0]?.visiblePropertyKeys).toEqual(["beta"]);

    await actions.hideProperty("beta");
    expect(saves).toHaveLength(2);
    expect(saves[1]?.visiblePropertyKeys).toEqual([]);
  });
});

describe("buildPropertyVisibilityPatch", () => {
  it("expands only newly enabled keys and retains surviving expansions", () => {
    const patch = buildPropertyVisibilityPatch(
      createSettings({
        visiblePropertyKeys: ["alpha", "beta"],
        expandedPropertyKeys: ["beta"],
      }),
      ["beta", "gamma"],
    );

    expect(patch.visiblePropertyKeys).toEqual(["beta", "gamma"]);
    // beta keeps its expansion; gamma is newly enabled and expanded; alpha is gone.
    expect(patch.expandedPropertyKeys).toEqual(["beta", "gamma"]);
  });
});
