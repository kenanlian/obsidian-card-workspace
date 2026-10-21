import { beforeEach, describe, expect, it, vi } from "vitest";
import { createViewWithFile, mockState, registerFolderCardView, resetFolderCardViewHarness } from "../__mocks__/folder-card-view-harness";
import { DEFAULT_SETTINGS } from "../settings";
import { FolderCardView } from "./FolderCardView";
import { createFolderScope, createLinksScope } from "./scope";
registerFolderCardView(FolderCardView);

describe("template visibility view integration", () => {
  beforeEach(() => resetFolderCardViewHarness());
  it("keeps registered templates visible with their properties across cold and warm folder loads", async () => {
    const { view, app, file, plugin } = createViewWithFile("Templates/template.md");
    const note = new mockState.MockTFile("Templates/note.md");
    Object.assign(file, { stat: { ctime: 1, mtime: 1, size: 0 } });
    Object.assign(note, { stat: { ctime: 1, mtime: 1, size: 0 } });
    const folder = new mockState.MockTFolder("Templates"); folder.children = [file, note];
    const root = new mockState.MockTFolder(""); root.children = [folder];
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.visiblePropertyKeys = ["status"];
    app.vault.getRoot = vi.fn(() => root);
    app.vault.getAbstractFileByPath = vi.fn((path: string) => path === file.path ? file : path === note.path ? note : path === folder.path ? folder : null);
    app.vault.getMarkdownFiles = () => [file, note];
    app.metadataCache.getFileCache = (target: { path: string }) => ({ frontmatter: { status: target.path === file.path ? "template-only" : "ordinary" } });
    plugin.getSettings = () => settings;
    try {
      await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createFolderScope("Templates", true), true));
      expect(view.panelModel.getState().cards.records).toHaveLength(2);
      settings.noteTemplates = [{ id: "t", filePath: file.path, targetFolderPath: "", dateFormat: "YYYY", timeFormat: "HH" }];
      await view.refresh({ reason: "settings-change", forceRefresh: true });
      expect(view.panelModel.getState().cards.records.map((card) => card.path)).toEqual(expect.arrayContaining([file.path, note.path]));
      expect(view.modules.property.derivePropertyFacets()[0].values.map((value) => value.ref)).toEqual(expect.arrayContaining([{ kind: "text", value: "ordinary" }, { kind: "text", value: "template-only" }]));
      // A same-source warm load must also retain the registered template.
      await view.refresh({ reason: "manual", forceRefresh: false });
      expect(view.panelModel.getState().cards.records).toHaveLength(2);
      settings.noteTemplates = [];
      await view.refresh({ reason: "settings-change", forceRefresh: true });
      expect(view.panelModel.getState().cards.records).toHaveLength(2);
    } finally { view.cleanupLifecycle(); }
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
