import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetFolderCardViewHarness,
  createViewWithFile,
  buildNoteOpsMock,
  registerFolderCardView,
  buildNoteTagOpsMock,
} from "../../__mocks__/folder-card-view-harness";

vi.mock("../note-ops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../note-ops")>();
  return buildNoteOpsMock(actual);
});
vi.mock("../note-tag-ops", () => buildNoteTagOpsMock());

import { TagActions } from "./tag-actions";
import { FolderCardView } from "../FolderCardView";
import { createBoxScope } from "../scope";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings, type PluginSettings } from "../../settings";

registerFolderCardView(FolderCardView);

describe("TagActions", () => {
  it("collapses duplicate and descendant removable tags", () => {
    const actions = new TagActions({ context: {} } as never);

    expect(actions.collapseBulkRemovableTags([
      "#project/alpha",
      "project",
      "project/alpha/deep",
      "status/open",
      "status/open",
    ])).toEqual(["project", "status/open"]);
  });

  it("selecting a tag clears active property clauses in the same settings update", async () => {
    const selected = { key: "status", values: [{ kind: "text" as const, value: "open" }] };
    let settings: PluginSettings = {
      ...DEFAULT_SETTINGS,
      visiblePropertyKeys: ["status"],
      filter: { tags: ["work"], properties: [selected] },
    };
    const saves: PartialPluginSettings[] = [];
    const actions = new TagActions({
      context: {
        getSettings: () => settings,
        saveSettings: async (patch: PartialPluginSettings) => {
          saves.push(patch);
          settings = mergeSettings(settings, patch);
        },
      },
      browseTagFilterEnabled: () => true,
      returnToCardsViewIfSinglePane: () => {},
    } as never);

    await actions.onFilterChange({ tags: ["work"] });
    expect(saves).toEqual([{ filter: { tags: ["work"], properties: [] } }]);
    expect(settings.filter).toEqual({ tags: ["work"], properties: [] });

    settings = mergeSettings(settings, { filter: { properties: [selected] } });
    await actions.filterByOnlyTag("other");
    expect(saves.at(-1)).toEqual({ filter: { tags: ["other"], properties: [] } });
    expect(settings.filter).toEqual({ tags: ["other"], properties: [] });
  });
});

describe("TagActions filter-change capability gating", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("clears dormant tag filters from a non-filterable scope but never sets tags there", async () => {
    const { view, plugin } = createViewWithFile("notes/box-clear.md");
    (view as any).cardScope = createBoxScope("box-1");
    const settings = {
      includeSubfolders: true,
      sort: { field: "mtime", direction: "desc" },
      filter: { tags: ["dormant"], properties: [] },
      visiblePropertyKeys: [],
      expandedPropertyKeys: [],
      pinnedPaths: [],
      previewLines: 5,
    };
    plugin.getSettings = vi.fn(() => settings);
    const tagActions = (view as any).modules.tagActions;

    // Setting tags from a box scope stays blocked: dormant filters are not settable here.
    await tagActions.onFilterChange({ tags: ["new-tag"] });
    expect(plugin.saveSettings).not.toHaveBeenCalled();

    // The section-header clear intent remains the explicit escape hatch.
    await tagActions.onFilterChange({ tags: [] });
    expect(plugin.saveSettings).toHaveBeenCalledWith({ filter: { tags: [] } });
  });
});
