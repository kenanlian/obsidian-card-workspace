import { describe, expect, it, vi } from "vitest";
import { getUiStrings } from "../i18n";
import { DEFAULT_SETTINGS, mergeSettings, type PartialPluginSettings, type PluginSettings } from "../settings";
import { createCardBox } from "./card-boxes";
import { createBoxScope, createFolderScope, createLinksScope, type CardScope } from "./scope";
import { createViewEpochs } from "./view-epochs";
import { createViewStateStore } from "./view-state-store";
import type { ViewContext } from "./view-context";
import {
  createStreamBrowseState, getBrowseFilter, getBrowseIncludeSubfolders,
  getStreamViewConfig, isSameBrowseSource, setBrowseFilter,
} from "./stream-browse-state";
import { TagActions } from "./actions/tag-actions";
import { createPropertyActions } from "./actions/property-actions";

function makeContext(scope: CardScope, read: () => PluginSettings, saveSettings: ViewContext["saveSettings"]): ViewContext {
  let state = createStreamBrowseState(scope, read());
  return {
    store: createViewStateStore(scope),
    epochs: createViewEpochs(),
    browse: {
      get: () => state,
      update: (patch) => { state = { ...state, ...patch }; },
      reset: (nextScope) => { state = { ...createStreamBrowseState(nextScope, read()), filter: state.filter }; },
    },
    getSettings: read, saveSettings,
    getApp: () => ({} as never),
    getUiStrings: () => getUiStrings("en"),
    requestUpdate: vi.fn(async () => undefined),
    publishGroups: vi.fn(), notify: vi.fn(),
    getViewWindow: () => globalThis,
  };
}

function sharedSettings(initial: PluginSettings = mergeSettings(DEFAULT_SETTINGS, {})) {
  let settings = initial;
  const save = vi.fn(async (patch: PartialPluginSettings) => { settings = mergeSettings(settings, patch); });
  return { read: () => settings, save };
}

describe("stream browse state", () => {
  it("seeds source defaults and owns fresh empty filter and configuration objects", () => {
    const box = { ...createCardBox("Box", []), sort: { field: "name" as const, direction: "asc" as const } };
    const shared = mergeSettings(DEFAULT_SETTINGS, {
      boxes: [box], defaultView: "tasks", filter: { tags: ["shared"] },
      linksSort: { ...DEFAULT_SETTINGS.linksSort, outgoing: { field: "reference-count", direction: "asc" } },
    });
    const first = createStreamBrowseState(createBoxScope(box.id), shared);
    const second = createStreamBrowseState(createBoxScope(box.id), shared);
    expect(first.sort).toEqual(box.sort);
    expect(first.viewMode).toBe("tasks");
    expect(first.filter).toEqual({ tags: [], properties: [] });
    first.sort.direction = "desc";
    first.filter.tags.push("one");
    expect(second.sort.direction).toBe("asc");
    expect(second.filter.tags).toEqual([]);
    expect(box.sort.direction).toBe("asc");
    expect(createStreamBrowseState(createLinksScope("a.md", "outgoing"), shared).sort.field).toBe("reference-count");
  });

  it("two streams share pins while preserving independent sort, mode, filters and recursion", async () => {
    const shared = sharedSettings();
    const first = makeContext(createFolderScope("notes", false), shared.read, shared.save);
    const second = makeContext(createFolderScope("notes", true), shared.read, shared.save);
    first.browse!.update({ sort: { field: "name", direction: "asc" }, viewMode: "tasks" });
    await setBrowseFilter(first, { tags: ["first"] });
    await setBrowseFilter(first, { properties: [{ key: "status", values: [{ kind: "text", value: "open" }] }] });
    expect(getBrowseFilter(first).tags).toEqual(["first"]);
    expect(getBrowseFilter(second)).toEqual({ tags: [], properties: [] });
    expect(getStreamViewConfig(second).sort).toEqual(DEFAULT_SETTINGS.sort);
    expect(getStreamViewConfig(second).viewMode).toBe(DEFAULT_SETTINGS.defaultView);
    expect(shared.save).not.toHaveBeenCalled();
    await shared.save({ pinnedPaths: ["pin.md"] });
    expect(getStreamViewConfig(first).pinnedPaths).toEqual(["pin.md"]);
    expect(getStreamViewConfig(second).pinnedPaths).toEqual(["pin.md"]);
    expect(getBrowseIncludeSubfolders(first)).toBe(false);
    expect(getBrowseIncludeSubfolders(second)).toBe(true);
    expect(first.requestUpdate).toHaveBeenCalledWith("reproject", "settings-change");
  });

  it("tag and property actions mutate only their captured stream", async () => {
    const shared = sharedSettings(mergeSettings(DEFAULT_SETTINGS, { visiblePropertyKeys: ["status"] }));
    const first = makeContext(createFolderScope("notes", true), shared.read, shared.save);
    const second = makeContext(createFolderScope("other", true), shared.read, shared.save);
    const tags = new TagActions({ context: first } as never);
    const properties = createPropertyActions({
      context: first, getApp: first.getApp, getSettings: shared.read, saveSettings: shared.save,
      collectPropertyInventory: () => ({ status: "ready", options: [] }),
      getStrings: first.getUiStrings, browsePropertyFilterEnabled: () => true,
    });
    await tags.filterByOnlyTag("work");
    await properties.applyValueFilter("status", { kind: "text", value: "open" }, true);
    expect(getBrowseFilter(first).tags).toEqual(["work"]);
    expect(getBrowseFilter(first).properties).toHaveLength(1);
    await properties.filterByOnlyValue("status", { kind: "text", value: "closed" });
    expect(getBrowseFilter(first).tags).toEqual([]);
    await tags.filterByOnlyTag("personal");
    expect(getBrowseFilter(first)).toEqual({ tags: ["personal"], properties: [] });
    expect(getBrowseFilter(second)).toEqual({ tags: [], properties: [] });
    expect(shared.save).not.toHaveBeenCalled();
  });

  it("legacy contexts still read and persist shared filters and traversal settings", async () => {
    const shared = sharedSettings();
    const context = makeContext(createFolderScope("notes", !DEFAULT_SETTINGS.includeSubfolders), shared.read, shared.save);
    delete context.browse;
    await setBrowseFilter(context, { tags: ["legacy"] }, { skipViewUpdate: true });
    expect(shared.save).toHaveBeenCalledWith({ filter: { tags: ["legacy"] } }, { skipViewUpdate: true });
    expect(getBrowseFilter(context).tags).toEqual(["legacy"]);
    expect(getBrowseIncludeSubfolders(context)).toBe(DEFAULT_SETTINGS.includeSubfolders);
    expect(context.requestUpdate).not.toHaveBeenCalled();
  });

  it("source defaults reset on identity changes while recursion changes keep choices", () => {
    expect(isSameBrowseSource(createFolderScope("notes", false), createFolderScope("notes", true))).toBe(true);
    expect(isSameBrowseSource(createFolderScope("notes", true), createFolderScope("other", true))).toBe(false);
    expect(isSameBrowseSource(createLinksScope("a.md", "outgoing"), createLinksScope("a.md", "backlinks"))).toBe(false);
    expect(isSameBrowseSource(createBoxScope("a"), createBoxScope("b"))).toBe(false);
  });
});
