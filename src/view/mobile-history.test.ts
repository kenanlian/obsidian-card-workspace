import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { createViewWithFile, createFolder, attachChildren, resetFolderCardViewHarness, registerFolderCardView, flushAsyncWork } from "../__mocks__/folder-card-view-harness";
import { FolderCardView } from "./FolderCardView";
import { createFolderScope, createLinksScope, createBoxScope } from "./scope";
import { createCardBox } from "./card-boxes";
import { normalizeSettings } from "../settings";
registerFolderCardView(FolderCardView);
beforeEach(() => resetFolderCardViewHarness());
afterEach(() => vi.restoreAllMocks());
describe("mobile host history", () => {
  it("restores through the scope controller without re-recording, and ignores old-session startup state", async () => {
    const { view, app, file, plugin } = createViewWithFile("a.md", { isDesktopApp: false });
    Object.assign(file, { stat: { ctime: 1, mtime: 1, size: 1 } });
    plugin.navigationSessionId = "this-session";
    const root = createFolder(""), folder = createFolder("notes"); attachChildren(root, [folder, file]);
    app.vault.getRoot = () => root;
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === "" ? root : path === "notes" ? folder : path === file.path ? file : null);
    app.metadataCache.resolvedLinks = {};
    const settings = normalizeSettings({}); plugin.getSettings.mockImplementation(() => settings);
    const saved: Array<{ before: unknown; state: unknown; history: boolean }> = [];
    view.leaf.setViewState = vi.fn(async state => {
      const before = view.getState(), result = { history: false };
      await view.setState(state.state, result); saved.push({ before, state: state.state, history: result.history });
    });
    let result = { history: false };
    await view.setState({ session: "old-session", scope: createBoxScope("gone") }, result);
    expect(view.hasLoadedScope()).toBe(false); expect(result.history).toBe(false);
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createFolderScope("", true), false, "restore"));
    const anchor = { ref: { kind: "card" as const, path: file.path }, offset: 12 }, restore = vi.fn();
    view.registerReadingPosition({ capture: () => anchor, restore });
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createFolderScope("notes", true), false, "panel-picker"));
    await flushAsyncWork();
    expect(saved).toHaveLength(1); expect(saved[0].history).toBe(true);
    expect(saved[0].before).toMatchObject({ scope: createFolderScope("", true) });
    result = { history: true };
    await view.setState({ session: "this-session", scope: createFolderScope("", true) }, result);
    expect(result.history).toBe(false); expect(view.getCardScope()).toEqual(createFolderScope("", true)); expect(saved).toHaveLength(1);
    expect(restore).toHaveBeenCalledWith(anchor, "folder::true");
    const box = createCardBox("Box", [], { manualPaths: [file.path] }); settings.boxes = [box];
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createBoxScope(box.id), false));
    await flushAsyncWork(); expect(saved).toHaveLength(2);
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createLinksScope(file.path, "backlinks"), false));
    await flushAsyncWork(); expect(saved).toHaveLength(3);
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createLinksScope(file.path, "outgoing"), false, "links-follow"));
    expect(saved).toHaveLength(3);
    expect(view.getState()).toMatchObject({ scope: createLinksScope(file.path, "outgoing") });
    result = { history: true }; await view.setState(saved[0].state, result);
    expect(result.history).toBe(false); expect(view.getCardScope()).toEqual(createFolderScope("notes", true)); expect(saved).toHaveLength(3);
    view.cleanupLifecycle();
  });
});

describe("phone header title", () => {
  function setupFolders(isDesktopApp: boolean) {
    const harness = createViewWithFile("notes/a.md", { isDesktopApp });
    const { app, file, plugin } = harness;
    Object.assign(file, { stat: { ctime: 1, mtime: 1, size: 1 } });
    const root = createFolder(""), folder = createFolder("notes"); attachChildren(folder, [file]); attachChildren(root, [folder]);
    app.vault.getRoot = () => root;
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === "" ? root : path === "notes" ? folder : path === file.path ? file : null);
    app.metadataCache.resolvedLinks = {};
    const settings = normalizeSettings({}); plugin.getSettings.mockImplementation(() => settings);
    return harness;
  }

  it("shows the current scope on phones and refreshes the host header only when it changes", async () => {
    const { view } = setupFolders(false);
    const updateHeader = vi.fn();
    const titleEl = { setText: vi.fn() };
    Object.assign(view.leaf, { updateHeader, setViewState: vi.fn(async () => undefined) });
    Object.assign(view, { titleEl, hostEl: {} });
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createFolderScope("", true), false, "restore"));
    await flushAsyncWork();
    const strings = view.plugin.getUiStrings();
    expect(view.getDisplayText()).toBe(strings.toolbar.folderMenu.rootFolder);
    const rootRefreshes = updateHeader.mock.calls.length;
    expect(rootRefreshes).toBeGreaterThan(0);
    view.refreshNavigationMetadata();
    expect(updateHeader).toHaveBeenCalledTimes(rootRefreshes);
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createFolderScope("notes", true), false, "panel-picker"));
    await flushAsyncWork();
    expect(view.getDisplayText()).toBe("notes");
    expect(updateHeader.mock.calls.length).toBeGreaterThan(rootRefreshes);
    expect(titleEl.setText).toHaveBeenLastCalledWith("notes");
    view.cleanupLifecycle();
  });

  it("keeps the plugin name on desktop", async () => {
    const { view } = setupFolders(true);
    await view.handleScopeSelection(view.modules.scopeController.createProgrammaticSelectionRequest(createFolderScope("notes", true), false, "restore"));
    await flushAsyncWork();
    expect(view.getDisplayText()).toBe(view.plugin.getUiStrings().view.displayName);
    view.cleanupLifecycle();
  });
});
