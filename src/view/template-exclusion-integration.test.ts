import { beforeEach, describe, expect, it, vi } from "vitest";
import { createViewWithFile, mockState, registerFolderCardView, resetFolderCardViewHarness } from "../__mocks__/folder-card-view-harness";
import { DEFAULT_SETTINGS } from "../settings";
import { installTemplateExclusion, isTemplatePath } from "../template-exclusion";
import { FolderCardView } from "./FolderCardView";
import { createLinksScope } from "./scope";
registerFolderCardView(FolderCardView);

describe("template exclusion view integration", () => {
  beforeEach(() => resetFolderCardViewHarness());
  it("invalidates warm candidates and facets on registration, then restores the file after unregistering", async () => {
    const { view, app, file, plugin } = createViewWithFile("template.md");
    const note = new mockState.MockTFile("note.md");
    Object.assign(file, { stat: { ctime: 1, mtime: 1, size: 0 } });
    Object.assign(note, { stat: { ctime: 1, mtime: 1, size: 0 } });
    const root = new mockState.MockTFolder(""); root.children = [file, note];
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.visiblePropertyKeys = ["status"];
    app.vault.getRoot = vi.fn(() => root);
    app.vault.getAbstractFileByPath = vi.fn((path: string) => path === file.path ? file : path === note.path ? note : null);
    app.vault.getMarkdownFiles = () => [file, note];
    app.metadataCache.getFileCache = (target: { path: string }) => ({ frontmatter: { status: target.path === file.path ? "template-only" : "ordinary" } });
    plugin.getSettings = () => settings;
    const release = installTemplateExclusion(app, (path) => isTemplatePath(path, settings.noteTemplates));
    try {
      await view.refresh({ reason: "manual", forceRefresh: true });
      expect(view.panelModel.getState().cards.records).toHaveLength(2);
      settings.noteTemplates = [{ id: "t", filePath: file.path, targetFolderPath: "", dateFormat: "YYYY", timeFormat: "HH" }];
      view.invalidateTemplateCandidates();
      await view.refresh({ reason: "settings-change", forceRefresh: true });
      expect(view.panelModel.getState().cards.records.map((card) => card.path)).toEqual(["note.md"]);
      expect(view.modules.property.derivePropertyFacets()[0].values.map((value) => value.ref)).toEqual([{ kind: "text", value: "ordinary" }]);
      // A same-source warm load must also keep the registered file out.
      await view.refresh({ reason: "manual", forceRefresh: false });
      expect(view.panelModel.getState().cards.records).toHaveLength(1);
      settings.noteTemplates = [];
      view.invalidateTemplateCandidates();
      await view.refresh({ reason: "settings-change", forceRefresh: true });
      expect(view.panelModel.getState().cards.records).toHaveLength(2);
    } finally { release(); view.cleanupLifecycle(); }
  });
  it("keeps an unpinned links source committed during template editor opening", () => {
    const { view } = createViewWithFile();
    const source = createLinksScope("source.md", "backlinks");
    (view as unknown as { cardScope: typeof source }).cardScope = source;
    const select = vi.spyOn(view.modules.scopeController, "handleScopeSelection");
    view.setSelectedFile("generated.md", true);
    expect(view.getCardScope()).toEqual(source);
    expect(select).not.toHaveBeenCalled();
    view.cleanupLifecycle();
  });
});
