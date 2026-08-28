import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, type DefaultViewMode, type PluginSettings } from "../settings";
import type { CardBoxDefinition } from "./types";
import { createBoxScope, createFolderScope } from "./scope";
import {
  UPDATE_INTENT_RANK,
  maxIntent,
  resolveBoxesUpdateIntent,
  resolveSettingsUpdateIntent,
  type ViewUpdateIntent,
} from "./update-intent";

function createBox(overrides: Partial<CardBoxDefinition> = {}): CardBoxDefinition {
  return {
    id: "box-1",
    name: "Reading",
    rules: [],
    manualPaths: [],
    excludedPaths: [],
    pinnedPaths: [],
    sort: { field: "mtime", direction: "desc" },
    ...overrides,
  };
}

function createSettings(): PluginSettings {
  return {
    ...DEFAULT_SETTINGS,
    sort: { ...DEFAULT_SETTINGS.sort },
    filter: { tags: [...DEFAULT_SETTINGS.filter.tags] },
    pinnedPaths: [...DEFAULT_SETTINGS.pinnedPaths],
    boxes: [createBox()],
    favorites: DEFAULT_SETTINGS.favorites.map((favorite) => ({ ...favorite })),
    sectionCollapsed: { ...DEFAULT_SETTINGS.sectionCollapsed },
    navSectionOrder: [...DEFAULT_SETTINGS.navSectionOrder],
    activeBoxId: "box-1",
  };
}

const EXPECTED_INTENTS: Record<keyof PluginSettings, ViewUpdateIntent> = {
  sort: "reproject",
  filter: "reproject",
  pinnedPaths: "reproject",
  includeSubfolders: "reload",
  defaultView: "patch",
  defaultCardOpenBehavior: "patch",
  dragInsertAction: "patch",
  cardCornerRadius: "patch",
  newNoteTemplate: "patch",
  previewLines: "rehydrate",
  lastFolderPath: "patch",
  expandedFolderPaths: "patch",
  expandedTagPaths: "patch",
  boxes: "reload",
  favorites: "patch",
  activeBoxId: "patch",
  navPaneWidth: "patch",
  navPaneCollapsed: "patch",
  sectionCollapsed: "patch",
  showNavItemCounts: "patch",
  navSectionOrder: "patch",
};

function changeSetting(settings: PluginSettings, key: keyof PluginSettings): void {
  switch (key) {
    case "sort": settings.sort = { field: "ctime", direction: "asc" }; break;
    case "filter": settings.filter = { tags: ["changed"] }; break;
    case "pinnedPaths": settings.pinnedPaths = ["notes/pinned.md"]; break;
    case "includeSubfolders": settings.includeSubfolders = !settings.includeSubfolders; break;
    // The current union has one member. An out-of-domain value still exercises
    // the resolver comparison and keeps this key in the exhaustive contract.
    case "defaultView": settings.defaultView = "changed" as DefaultViewMode; break;
    case "defaultCardOpenBehavior": settings.defaultCardOpenBehavior = "new-tab"; break;
    case "dragInsertAction": settings.dragInsertAction = "wiki"; break;
    case "cardCornerRadius": settings.cardCornerRadius = "compact"; break;
    case "newNoteTemplate": settings.newNoteTemplate = "blank"; break;
    case "previewLines": settings.previewLines += 1; break;
    case "lastFolderPath": settings.lastFolderPath = "changed"; break;
    case "expandedFolderPaths": settings.expandedFolderPaths = ["changed"]; break;
    case "expandedTagPaths": settings.expandedTagPaths = ["changed"]; break;
    case "boxes": settings.boxes = [createBox({ manualPaths: ["notes/member.md"] })]; break;
    case "favorites": settings.favorites = [{ kind: "folder", ref: "changed" }]; break;
    case "activeBoxId": settings.activeBoxId = null; break;
    case "navPaneWidth": settings.navPaneWidth += 1; break;
    case "navPaneCollapsed": settings.navPaneCollapsed = !settings.navPaneCollapsed; break;
    case "sectionCollapsed":
      settings.sectionCollapsed = {
        ...settings.sectionCollapsed,
        folders: !settings.sectionCollapsed.folders,
      };
      break;
    case "showNavItemCounts": settings.showNavItemCounts = !settings.showNavItemCounts; break;
    case "navSectionOrder": settings.navSectionOrder = ["boxes", "favorites", "folders", "tags"]; break;
    default: {
      const exhaustive: never = key;
      throw new Error(`Unhandled settings key: ${String(exhaustive)}`);
    }
  }
}

describe("update intent rank", () => {
  it("orders all four intents and returns the strongest", () => {
    expect(UPDATE_INTENT_RANK).toEqual({ patch: 0, reproject: 1, rehydrate: 2, reload: 3 });
    expect(maxIntent("patch", "reproject")).toBe("reproject");
    expect(maxIntent("rehydrate", "reproject")).toBe("rehydrate");
    expect(maxIntent("reload", "patch")).toBe("reload");
  });
});

describe("resolveSettingsUpdateIntent", () => {
  it("returns null for semantically equal settings, including rebuilt arrays", () => {
    const previous = createSettings();
    previous.pinnedPaths = ["notes/a.md"];
    previous.filter.tags = ["tag"];
    previous.favorites = [{ kind: "folder", ref: "notes" }];
    const next = createSettings();
    next.pinnedPaths = ["notes/a.md"];
    next.filter.tags = ["tag"];
    next.favorites = [{ kind: "folder", ref: "notes" }];
    expect(resolveSettingsUpdateIntent(previous, next)).toBeNull();
  });

  it("classifies every actual settings key at its exact intent", () => {
    expect(Object.keys(EXPECTED_INTENTS).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());

    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof PluginSettings>) {
      const previous = createSettings();
      const next = createSettings();
      changeSetting(next, key);
      expect(resolveSettingsUpdateIntent(previous, next), key).toBe(EXPECTED_INTENTS[key]);
    }
  });

  it("uses the strongest intent for multiple changed keys", () => {
    const previous = createSettings();
    const next = createSettings();
    next.sort = { field: "name", direction: "asc" };
    next.includeSubfolders = !next.includeSubfolders;
    expect(resolveSettingsUpdateIntent(previous, next)).toBe("reload");
  });

  it("resolves box changes against the supplied runtime scope", () => {
    const previous = createSettings();
    previous.boxes = [createBox({ id: "box-x" }), createBox({ id: "box-y" })];
    previous.activeBoxId = "box-y";
    const next = createSettings();
    next.boxes = [
      createBox({ id: "box-x", manualPaths: ["notes/member.md"] }),
      createBox({ id: "box-y" }),
    ];
    next.activeBoxId = "box-y";

    expect(resolveSettingsUpdateIntent(previous, next, createBoxScope("box-x"))).toBe("reload");
    expect(resolveSettingsUpdateIntent(previous, next, createBoxScope("box-y"))).toBe("patch");
    expect(resolveSettingsUpdateIntent(previous, next, createFolderScope("", true))).toBe("patch");
  });

  it("resolves active-box sort and pins per runtime box", () => {
    const previous = createSettings();
    previous.boxes = [createBox({ id: "box-x" }), createBox({ id: "box-y" })];
    const next = createSettings();
    next.boxes = [
      createBox({ id: "box-x", sort: { field: "name", direction: "asc" } }),
      createBox({ id: "box-y" }),
    ];

    expect(resolveSettingsUpdateIntent(previous, next, createBoxScope("box-x"))).toBe("reproject");
    expect(resolveSettingsUpdateIntent(previous, next, createBoxScope("box-y"))).toBe("patch");
  });
});

describe("resolveBoxesUpdateIntent", () => {
  it("returns null for identical JSON content", () => {
    expect(resolveBoxesUpdateIntent([createBox()], [createBox()], "box-1")).toBeNull();
  });

  it("returns patch when no box is active", () => {
    expect(resolveBoxesUpdateIntent([createBox()], [createBox({ name: "Renamed" })], null)).toBe("patch");
  });

  it("returns patch when the active box is missing from either side", () => {
    expect(resolveBoxesUpdateIntent([createBox()], [], "box-1")).toBe("patch");
    expect(resolveBoxesUpdateIntent([], [createBox()], "box-1")).toBe("patch");
  });

  it("returns reload when active-box membership changes", () => {
    const next = createBox({ excludedPaths: ["notes/a.md"] });
    expect(resolveBoxesUpdateIntent([createBox()], [next], "box-1")).toBe("reload");
  });

  it("returns reproject when active-box sort or pinned paths change", () => {
    const sorted = createBox({ sort: { field: "name", direction: "asc" } });
    const pinned = createBox({ pinnedPaths: ["notes/a.md"] });
    expect(resolveBoxesUpdateIntent([createBox()], [sorted], "box-1")).toBe("reproject");
    expect(resolveBoxesUpdateIntent([createBox()], [pinned], "box-1")).toBe("reproject");
  });

  it("returns patch for other box-list changes", () => {
    const renamed = createBox({ name: "Renamed" });
    expect(resolveBoxesUpdateIntent([createBox()], [renamed], "box-1")).toBe("patch");
  });
});
