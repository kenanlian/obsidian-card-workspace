import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockState,
  resetFolderCardViewHarness,
  createViewWithFile,
  clickLatestModalButton,
  setLatestModalTextInput,
  setLatestModalCheckbox,
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
import {
  addTagToFile,
  batchRemoveTagsFromFiles,
  removeTagFromFile,
} from "../note-tag-ops";

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

describe("TagActions single and bulk card workflows", () => {
  beforeEach(() => {
    resetFolderCardViewHarness();
  });

  it("single tag actions keep add freeform and require explicit remove selection", async () => {
    const { view, file, app, plugin } = createViewWithFile("notes/tag-action.md");

    await (view as any).modules.cardMenu.routeAction("add-tag", file.path);
    expect(mockState.modalInstances.at(-1)?.title).toBe("Add tag");
    setLatestModalTextInput(0, "  #Project/Alpha ");
    clickLatestModalButton("Add tag");
    await vi.waitFor(() => {
      expect(addTagToFile).toHaveBeenCalledWith(app, file, "project/alpha");
    });
    expect(mockState.noticeMessages).toContain('Added #project/alpha to "tag-action".');

    app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#Project/Alpha" }],
    }));
    vi.mocked(removeTagFromFile).mockResolvedValueOnce({
      ok: true,
      changed: false,
      file,
    } as any);

    await (view as any).modules.cardMenu.routeAction("remove-tag", file.path);
    const singleTagModal = mockState.modalInstances.at(-1);
    expect(singleTagModal?.title).toBe("Remove tags");
    expect(singleTagModal?.textInputs).toEqual([]);
    expect(singleTagModal?.checkboxes.map((checkbox) => checkbox.label)).toEqual(["Project/Alpha (1)"]);
    expect(removeTagFromFile).not.toHaveBeenCalled();
    setLatestModalCheckbox("Project/Alpha (1)", true);
    clickLatestModalButton("Remove selected tags");
    await vi.waitFor(() => {
      expect(removeTagFromFile).toHaveBeenCalledWith(app, file, "project/alpha");
    });
    expect(mockState.noticeMessages).toContain('#project/alpha was not present on "tag-action".');
    expect(plugin.saveSettings).not.toHaveBeenCalled();

    app.metadataCache.getFileCache = vi.fn(() => ({
      tags: [{ tag: "#Other" }, { tag: "#Project/Alpha" }],
    }));
    vi.mocked(batchRemoveTagsFromFiles).mockResolvedValueOnce({
      changed: [{ ok: true, changed: true, file }],
      noop: [],
      failed: [],
    } as any);

    await (view as any).modules.cardMenu.routeAction("remove-tag", file.path);
    const multiTagModal = mockState.modalInstances.at(-1);
    expect(multiTagModal?.title).toBe("Remove tags");
    expect(multiTagModal?.checkboxes.map((checkbox) => checkbox.label)).toEqual([
      "Other (1)",
      "Project/Alpha (1)",
    ]);
    setLatestModalCheckbox("Other (1)", true);
    setLatestModalCheckbox("Project/Alpha (1)", true);
    clickLatestModalButton("Remove selected tags");
    await vi.waitFor(() => {
      expect(batchRemoveTagsFromFiles).toHaveBeenCalledWith(app, [file], ["other", "project/alpha"]);
    });
    await vi.waitFor(() => {
      expect(mockState.noticeMessages).toContain("Removed 2 tags from 1 note.");
    });
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
