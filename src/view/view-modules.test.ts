import { describe, expect, it } from "vitest";
import { getUiStrings } from "../i18n";
import { DEFAULT_SETTINGS } from "../settings";
import { createFolderScope } from "./scope";
import { createViewEpochs } from "./view-epochs";
import { createViewStateStore } from "./view-state-store";
import {
  createModuleConstructionGate,
  createViewModules,
  type ViewModuleHost,
} from "./view-modules";
import type { ViewContext } from "./view-context";

function createHost(assembled: () => boolean): ViewModuleHost {
  const rejectIfPremature = (name: string) => {
    if (!assembled()) {
      throw new Error(`host callback invoked during construction: ${name}`);
    }
  };
  return {
    effectiveSortAndPins: () => {
      rejectIfPremature("effectiveSortAndPins");
      return { sortField: "mtime", sortDirection: "desc", pinnedPaths: [] };
    },
    getDisplayFolderPath: () => {
      rejectIfPremature("getDisplayFolderPath");
      return "/";
    },
    getTooltipSide: () => {
      rejectIfPremature("getTooltipSide");
      return "right";
    },
    openCardWithDestination: () => {
      rejectIfPremature("openCardWithDestination");
    },
    selectFolderFromNav: async () => {
      rejectIfPremature("selectFolderFromNav");
    },
    moveScopeToFolder: async () => {
      rejectIfPremature("moveScopeToFolder");
      return { action: "noop" } as never;
    },
    bumpSearchFocusToken: () => {
      rejectIfPremature("bumpSearchFocusToken");
    },
    publishAll: () => {
      rejectIfPremature("publishAll");
    },
    publishSearch: () => {
      rejectIfPremature("publishSearch");
    },
    publishSelection: () => {
      rejectIfPremature("publishSelection");
    },
    publishHydration: () => {
      rejectIfPremature("publishHydration");
    },
    publishLoadStart: () => {
      rejectIfPremature("publishLoadStart");
    },
    publishLoadCommit: () => {
      rejectIfPremature("publishLoadCommit");
    },
    publishGroups: () => {
      rejectIfPremature("publishGroups");
    },
    publishImpactBatch: () => {
      rejectIfPremature("publishImpactBatch");
    },
    openNoteFromCard: async () => {
      rejectIfPremature("openNoteFromCard");
    },
    createNoteInFolder: async () => {
      rejectIfPremature("createNoteInFolder");
    },
    getSearchService: () => {
      rejectIfPremature("getSearchService");
      return null;
    },
    getSearchSnapshot: () => {
      rejectIfPremature("getSearchSnapshot");
      return null;
    },
    subscribeSearchSnapshots: () => {
      rejectIfPremature("subscribeSearchSnapshots");
      return () => undefined;
    },
  };
}

function createContext(): ViewContext {
  return {
    getApp: () => ({
      vault: { getAbstractFileByPath: () => null, getMarkdownFiles: () => [], getRoot: () => ({ path: "", children: [] }) },
      metadataCache: { getFileCache: () => null },
      workspace: { leftSplit: {}, trigger: () => undefined },
    }) as never,
    store: createViewStateStore(createFolderScope("", true)),
    epochs: createViewEpochs(),
    getSettings: () => DEFAULT_SETTINGS,
    saveSettings: async () => undefined,
    getUiStrings: () => getUiStrings("en"),
    publishGroups: () => undefined,
    requestUpdate: async () => undefined,
    notify: () => undefined,
    getViewWindow: () => ({ setTimeout: () => 0, clearTimeout: () => undefined }),
  };
}

describe("createViewModules composition", () => {
  it("constructs ArrangementActions after its concrete dependencies without invoking later-module callbacks", () => {
    let assembled = false;
    const modules = createViewModules(createContext(), createHost(() => assembled));
    assembled = true;

    expect(modules.arrangementActions).toBeDefined();
    expect(modules.boxActions).toBeDefined();
    expect(modules.projection).toBeDefined();
    expect(modules.bulk).toBeDefined();
    expect(modules.groupCollapse).toBeDefined();
    expect(modules.scopeController).toBeDefined();
  });

  it("exposes the C8 reorder seam on ArrangementActions rather than a host sort helper", () => {
    let assembled = false;
    const modules = createViewModules(createContext(), createHost(() => assembled));
    assembled = true;

    expect(typeof modules.arrangementActions.sortAndReprojectCards).toBe("function");
    expect(typeof modules.arrangementActions.onSortChange).toBe("function");
    expect(typeof modules.arrangementActions.onGroupChange).toBe("function");
    expect(typeof modules.arrangementActions.onGroupCollapseCommand).toBe("function");
    expect(typeof modules.arrangementActions.onPinToggle).toBe("function");
  });

  it("fails if a constructor synchronously invokes a callback requiring a later module", () => {
    const gate = createModuleConstructionGate();
    const later = gate.guard("later.fn", () => 1);

    expect(() => later()).toThrow(/Uninitialized module callback invoked during construction: later\.fn/);
    gate.markAssembled();
    expect(later()).toBe(1);
  });
});
