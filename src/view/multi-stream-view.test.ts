import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createViewWithFile, createFolder, attachChildren, registerFolderCardView, resetFolderCardViewHarness, flushAsyncWork, mockState, createMarkdownFile, createSearchHealth } from "../__mocks__/folder-card-view-harness";
import { FolderCardView } from "./FolderCardView";
import { normalizeSettings } from "../settings";
import { createBoxScope, createFolderScope, createLinksScope } from "./scope";
import type { StreamSnapshot } from "./stream-state";
import { CardStreamRuntime } from "./CardStreamRuntime";
import { createCardBox } from "./card-boxes";
import { StreamSourcePicker } from "./modals/StreamSourcePicker";
import { getStreamUiStrings } from "./stream-ui-strings";
import { getUiStrings } from "../i18n";

vi.mock("./StreamWorkspacePanel.svelte", () => ({ default: () => ({ teardown() {} }) }));
registerFolderCardView(FolderCardView);
const views: FolderCardView[] = [];
beforeEach(() => resetFolderCardViewHarness());
afterEach(async () => { for (const view of views.splice(0)) await view.onClose(); vi.restoreAllMocks(); });

async function setup() {
  const harness = createViewWithFile("notes/a.md");
  const view = harness.view as unknown as FolderCardView;
  views.push(view);
  const { app, file, plugin } = harness;
  Object.assign(file, { stat: { ctime: 1, mtime: 1, size: 1 } });
  const root = createFolder(""), folder = createFolder("notes"); attachChildren(root, [folder]); attachChildren(folder, [file]);
  app.vault.getRoot = () => root;
  app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === "" ? root : path === "notes" ? folder : path === file.path ? file : null);
  app.vault.getAllLoadedFiles = () => [root, folder, file]; app.vault.getMarkdownFiles = () => [file];
  app.workspace.requestSaveLayout = vi.fn(); app.workspace.revealLeaf = vi.fn(async () => {}); app.workspace.setActiveLeaf = vi.fn();
  app.metadataCache.resolvedLinks = {}; app.metadataCache.unresolvedLinks = {};
  const settings = normalizeSettings({}); plugin.getSettings.mockImplementation(() => settings);
  await view.onOpen(); view.streams.setSize(1200, 800);
  await view.selectFolderFromNav("notes");
  return { ...harness, view, settings, root, folder };
}
function stream(view: FolderCardView, id: string): StreamSnapshot {
  return view.streams.getState().streams.find(value => value.id === id)!;
}
function targetLeaf(source: Awaited<ReturnType<typeof setup>>) {
  const leaf = { app: source.app, getRoot: () => ({}), view: null as unknown,
    setViewState: vi.fn(async (state: { state: unknown }) => target.setState(state.state, { history: false })),
    detach: vi.fn(() => target.cleanupLifecycle()), loadIfDeferred: vi.fn(async () => {}) };
  const target = new FolderCardView(leaf as never, source.plugin); leaf.view = target; views.push(target);
  source.plugin.createCardStreamLeaf = vi.fn(async () => leaf);
  return { target, leaf };
}

describe("desktop leaf stream integration", () => {
  it("loads a deferred legacy leaf from settings when the host restores it after startup", async () => {
    const source = await setup(); const { target } = targetLeaf(source);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    source.plugin.waitForSettingsReady = vi.fn(() => ready);
    await target.onOpen();
    const waiting = target.setState({}, { history: false });
    source.settings.lastFolderPath = "notes";
    source.settings.includeSubfolders = false;
    source.settings.filter.tags = ["research"];
    source.settings.navPaneWidth = 350;
    release(); await waiting;
    expect(target.getCardScope()).toEqual(createFolderScope("notes", false));
    expect(target.streams.getState().streams[0]?.browse.filter.tags).toEqual(["research"]);
    expect(target.getState().navigation).toMatchObject({ width: 350 });
  });

  it("waits for shared settings before validating a restored card box", async () => {
    const source = await setup(); const { target } = targetLeaf(source);
    const box = createCardBox("Saved notes", [], { manualPaths: [source.file.path] });
    const saved = source.view.getState();
    const snapshots = saved.streams as StreamSnapshot[];
    snapshots[0]!.scope = createBoxScope(box.id);
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    source.plugin.waitForSettingsReady = vi.fn(() => ready);
    await target.onOpen();
    const restored = target.setState(saved, { history: false });
    await vi.waitFor(() => expect(source.plugin.waitForSettingsReady).toHaveBeenCalled());
    expect(target.hasLoadedScope()).toBe(true); // Serialized state is known, content is still pending.
    expect(target.streamPanelModel.getState().entries[0]?.pending).toBe(true);
    source.settings.boxes = [box]; release(); await restored;
    expect(target.getCardScope()).toEqual(createBoxScope(box.id));
    expect(target.panelModel.getState().scope.activeBoxName).toBe("Saved notes");
    expect(target.panelModel.getState().cards.records.map(value => value.path)).toEqual([source.file.path]);
  });

  it("keeps same-source browse state independent and navigates only the selected stream", async () => {
    const { view, plugin, settings } = await setup();
    const first = view.streams.getState().currentStreamId!;
    const second = (await view.createStream({ scope: createFolderScope("notes", true) }))!;
    await view.modules.arrangementActions.onSortChange({ field: "name", direction: "asc" });
    await view.modules.tagActions.applyTagFilter(["research"], false);
    view.modules.search.onQueryChange({ query: "needle" });
    expect(stream(view, first).browse.filter.tags).toEqual([]);
    expect(stream(view, first).browse.sort.field).toBe("mtime");
    expect(stream(view, second).browse.filter.tags).toEqual(["research"]);
    expect(stream(view, second).browse.sort.field).toBe("name");
    expect(settings.sort.field).toBe("mtime"); expect(settings.filter.tags).toEqual([]);
    await view.selectFolderFromNav("");
    expect(stream(view, first).scope).toEqual(createFolderScope("notes", true));
    expect(view.getCardScope()).toEqual(createFolderScope("", true));
    expect(plugin.selectFolderByPath).not.toHaveBeenCalled();
  });

  it("releases collapsed runtimes and restores query, selection and anchors on expansion", async () => {
    const { view, file } = await setup(); const first = view.streams.getState().currentStreamId!;
    const anchor = { ref: { kind: "card" as const, path: file.path }, offset: 19 };
    view.registerReadingPosition({ capture: () => anchor, restore: vi.fn() });
    view.modules.search.onQueryChange({ query: "remember" });
    view.handleStreamCommand(first, "collapse");
    expect(view.hasCurrentStream()).toBe(false);
    expect(view.getRuntimeDiagnostics().streams?.active).toBe(0);
    expect(stream(view, first).query).toBe("remember"); expect(stream(view, first).anchor).toEqual(anchor);
    view.streams.select(first); await view.waitForForeground();
    expect(view.modules.search.getQuery()).toBe("remember");
    expect(view.getRuntimeDiagnostics().streams?.active).toBe(1);
  });

  it("duplicates browsing without selections and fixes a copied links reference", async () => {
    const { view, file } = await setup();
    const links = (await view.createStream({ scope: createLinksScope(file.path, "backlinks") }))!;
    view.modules.linksActions.togglePinned();
    expect(view.panelModel.getState().scope.linksPinned).toBe(false);
    view.handleStreamCommand(links, "duplicate"); await view.waitForForeground();
    const copy = view.streams.getState().currentStreamId!;
    expect(copy).not.toBe(links); expect(stream(view, copy).linksPinned).toBe(true);
    expect(view.modules.bulk.getSelectedPaths().size).toBe(0);
  });

  it("restores every saved stream, explicit empty leaves and unknown future state safely", async () => {
    const source = await setup(); const first = source.view.streams.getState().currentStreamId!;
    await source.view.createStream({ scope: createFolderScope("", true) });
    source.view.streams.setExpanded(first, false);
    const saved = source.view.getState();
    const { target } = targetLeaf(source);
    await target.setState(saved, { history: false });
    expect(target.getState()).toEqual(saved);
    expect(target.hasLoadedScope()).toBe(true);
    for (const entry of target.streams.getState().streams) target.handleStreamCommand(entry.id, "close");
    const empty = target.getState(); await target.setState(empty, { history: false });
    expect(target.streams.getState().streams).toEqual([]); expect(target.hasLoadedScope()).toBe(true);
    const future = { version: 900, custom: { mustSurvive: true } };
    await target.setState(future, { history: false });
    expect(target.getState()).toEqual(future);
  });

  it("moves only after a usable target exists and does not resurrect the source on restore", async () => {
    const source = await setup(); const id = source.view.streams.getState().currentStreamId!;
    source.view.modules.bulk.toggleBulkMode(); source.view.modules.bulk.bulkSelectAll();
    const { target } = targetLeaf(source);
    expect(await source.view.transferStream(id)).toBe(true);
    expect(source.view.streams.getState().streams).toHaveLength(0);
    expect(target.streams.getState().streams.map(value => value.id)).toEqual([id]);
    expect(target.modules.bulk.getSelectedPaths().has(source.file.path)).toBe(true);
    await source.view.setState(source.view.getState(), { history: false });
    expect(source.view.streams.getState().streams).toHaveLength(0);
  });

  it("copies to a new pane without carrying selections or a pending source drag", async () => {
    const source = await setup(); const id = source.view.streams.getState().currentStreamId!;
    source.view.modules.bulk.toggleBulkMode(); source.view.modules.bulk.bulkSelectAll();
    source.view.modules.cardDropActions.begin([source.file.path]);
    const { target } = targetLeaf(source);
    expect(await source.view.transferStream(id, true)).toBe(true);
    expect(source.view.streams.getState().streams.some(value => value.id === id)).toBe(true);
    expect(target.streams.getState().currentStreamId).not.toBe(id);
    expect(target.modules.bulk.getSelectedPaths().size).toBe(0);
    expect(source.view.modules.bulk.getSelectedPaths().has(source.file.path)).toBe(true);
    expect(await source.view.modules.cardDropActions.drop({ kind: "folder", path: "" }, [source.file.path])).toBeNull();
    expect(source.app.fileManager.renameFile).not.toHaveBeenCalled();
  });

  it("retains source context when target creation or reveal fails", async () => {
    const source = await setup(); const id = source.view.streams.getState().currentStreamId!;
    const before = source.view.getState();
    source.plugin.createCardStreamLeaf = vi.fn(async () => { throw new Error("no split"); });
    expect(await source.view.transferStream(id)).toBe(false);
    expect(source.view.getState()).toEqual(before);
    const { leaf } = targetLeaf(source);
    source.app.workspace.revealLeaf.mockRejectedValueOnce(new Error("closed target"));
    expect(await source.view.transferStream(id)).toBe(false);
    expect(source.view.streams.getState().streams.some(value => value.id === id)).toBe(true);
    expect(leaf.detach).toHaveBeenCalled();
    expect(mockState.noticeMessages.length).toBeGreaterThan(0);
  });

  it("keeps missing restored sources and shared nav state isolated between leaves", async () => {
    const source = await setup();
    await source.view.createStream({ scope: createFolderScope("gone", true) });
    expect(source.view.getCardScope()).toEqual(createFolderScope("gone", true));
    expect(source.view.panelModel.getState().scope.emptyStateMessage).toContain("unavailable");
    const { target } = targetLeaf(source);
    await source.view.modules.navLayout.onNavPaneResize(350);
    expect((source.view.getState().navigation as { width: number }).width).toBe(350);
    expect((target.getState().navigation as { width: number }).width).not.toBe(350);
    expect(source.settings.navPaneWidth).not.toBe(350);
    await flushAsyncWork();
  });

  it("keeps a noncurrent publication from replacing shared navigation intent state", async () => {
    const { view } = await setup(); const first = view.streams.getState().currentStreamId!;
    const second = (await view.createStream({ scope: createFolderScope("", true) }))!;
    const shared = view.modules.navLayout;
    const project = vi.spyOn(shared, "project"); project.mockClear();
    const entry = view.streamPanelModel.getState().entries.find(value => value.id === first)!;
    const runtime = (view as unknown as { runtimes: Map<string, { runtime: CardStreamRuntime }> }).runtimes.get(entry.id)!.runtime;
    runtime.refreshNavigationMetadata();
    expect(view.streams.getState().currentStreamId).toBe(second);
    expect(project).not.toHaveBeenCalled();
    const rows = shared.getProjection().rows;
    expect(rows.find(row => row.kind === "folder" && row.folderPath === "")?.semanticState).toBe("current-range");
    expect(project.mock.calls.every(([input]) => input.scope.kind !== "folder" || input.scope.path === "")).toBe(true);
  });

  it("recreates a loading runtime when collapsed and reopened before the old load settles", async () => {
    const { view } = await setup();
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const restore = CardStreamRuntime.prototype.restoreSnapshot;
    const restoring = vi.spyOn(CardStreamRuntime.prototype, "restoreSnapshot").mockImplementationOnce(async function (this: CardStreamRuntime, snapshot) {
      await held; return restore.call(this, snapshot);
    });
    const creating = view.createStream({ scope: createFolderScope("", true) });
    const id = view.streams.getState().currentStreamId!;
    await vi.waitFor(() => expect(restoring).toHaveBeenCalled());
    view.handleStreamCommand(id, "collapse"); view.streams.select(id);
    await view.waitForForeground();
    expect(view.streamPanelModel.getState().entries.find(value => value.id === id)?.panelModel).not.toBeNull();
    expect(view.hasLoadedScope()).toBe(true);
    release(); await creating;
    expect(view.getCardScope()).toEqual(createFolderScope("", true));
  });

  it("saves shared property visibility even when a patch also narrows local filters", async () => {
    const { view, plugin, settings } = await setup();
    const entry = view.streamPanelModel.getState().entries.find(value => value.current)!;
    plugin.saveSettings.mockClear();
    const runtime = (view as unknown as { runtimes: Map<string, { runtime: CardStreamRuntime }> }).runtimes.get(entry.id)!.runtime;
    await runtime.context.saveSettings({ visiblePropertyKeys: ["status"], filter: { tags: ["local"] } });
    expect(plugin.saveSettings).toHaveBeenCalledWith({ visiblePropertyKeys: ["status"] });
    expect(stream(view, entry.id).browse.filter.tags).toEqual(["local"]);
    expect(settings.filter.tags).toEqual([]);
  });

  it("does not reset a visible following links stream's custom arrangement", async () => {
    const { view, app, file } = await setup();
    await view.createStream({ scope: createLinksScope(file.path, "backlinks") });
    view.modules.linksActions.togglePinned();
    await view.modules.arrangementActions.onSortChange({ field: "name", direction: "asc" });
    await view.modules.arrangementActions.setViewMode("tasks");
    const other = createMarkdownFile("notes/other.md"); Object.assign(other, { stat: { ctime: 1, mtime: 1, size: 1 } });
    const resolve = app.vault.getAbstractFileByPath.getMockImplementation();
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === other.path ? other : resolve(path));
    view.setSelectedFile(other.path);
    await view.modules.scopeController.waitForIdle();
    expect(view.getCardScope()).toEqual(createLinksScope(other.path, "backlinks"));
    expect(view.panelModel.getState().projection).toMatchObject({ viewMode: "tasks", sortField: "name", sortDirection: "asc" });
  });

  it("excludes staged targets from saved state and cancels duplicate move submissions", async () => {
    const source = await setup(); const id = source.view.streams.getState().currentStreamId!;
    const { target } = targetLeaf(source);
    let release!: () => void;
    source.app.workspace.revealLeaf.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const moving = source.view.transferStream(id);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((target.getState().streams as unknown[])).toEqual([]);
    expect(source.view.streams.getState().streams.some(value => value.id === id)).toBe(true);
    expect(await source.view.transferStream(id)).toBe(false);
    release(); expect(await moving).toBe(true);
    expect((target.getState().streams as StreamSnapshot[]).map(value => value.id)).toEqual([id]);
  });

  it("aborts a move if the target restores different state while being revealed", async () => {
    const source = await setup(); const id = source.view.streams.getState().currentStreamId!;
    const { target, leaf } = targetLeaf(source);
    let release!: () => void;
    source.app.workspace.revealLeaf.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const moving = source.view.transferStream(id);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await target.setState({ ...target.getState(), layout: null, streams: [], currentStreamId: null }, { history: false });
    release(); expect(await moving).toBe(false);
    expect(source.view.streams.getState().streams.some(value => value.id === id)).toBe(true);
    expect(leaf.detach).not.toHaveBeenCalled();
    expect((target.getState().streams as unknown[])).toEqual([]);
  });

  it("refreshes folder identities and attachment counts even with no materialized streams", async () => {
    const { view, app, plugin, root, folder, file, settings } = await setup();
    settings.boxes = [createCardBox("Notes", [], { rules: [{ id: "notes-rule", name: "", folder: "notes", includeSubfolders: true, tags: [], properties: [] }] })];
    for (const value of view.streams.getState().streams) view.handleStreamCommand(value.id, "close");
    view.refreshNavState();
    expect(view.modules.boxActions.countBoxCards(settings.boxes[0]!)).toBe(1);
    const other = createFolder("other"), child = createFolder("other/child"); attachChildren(other, [child]); root.children.push(other);
    const subscriber = plugin.subscribeVaultEvents.mock.calls[0][0] as (event: unknown) => void;
    subscriber({ eventType: "create", path: other.path, oldPath: null, isFolder: true, fileKind: null });
    const row = view.modules.navLayout.getProjection().rows.find(value => value.kind === "folder" && value.folderPath === "other")!;
    expect(row).toBeDefined(); await view.modules.navLayout.setExpanded(row, true);
    other.path = "renamed"; child.path = "renamed/child";
    subscriber({ eventType: "rename", path: "renamed", oldPath: "other", isFolder: true, fileKind: null });
    expect((view.getState().navigation as { expandedFolderPaths: string[] }).expandedFolderPaths).toContain("renamed");
    const image = createMarkdownFile("notes/image.png"); Object.assign(image, { stat: { ctime: 1, mtime: 1, size: 1 } }); folder.children.push(image);
    const resolve = app.vault.getAbstractFileByPath.getMockImplementation();
    app.vault.getAbstractFileByPath.mockImplementation((path: string) => path === image.path ? image : resolve(path));
    subscriber({ eventType: "create", path: image.path, oldPath: null, isFolder: false, fileKind: "image" });
    await vi.waitFor(() => expect(view.modules.boxActions.countBoxCards(settings.boxes[0]!)).toBe(2), { timeout: 800 });
    expect(view.getRuntimeDiagnostics().streams?.active).toBe(0);
  });

  it("chooses a source category before enumerating notes and creates a clean vault tag source", async () => {
    const { view, app, plugin } = await setup();
    app.vault.getAllLoadedFiles = vi.fn(app.vault.getAllLoadedFiles);
    app.vault.getMarkdownFiles = vi.fn(app.vault.getMarkdownFiles);
    plugin.navigationMetadataCatalog = { seedScope: vi.fn(), getSnapshot: () => ({ ready: true, tags: ["research"], properties: [] }) };
    const choose = vi.fn(); const picker = new StreamSourcePicker(app, plugin, choose);
    const categories = picker.getItems(); expect(categories).toHaveLength(6);
    expect(app.vault.getAllLoadedFiles).not.toHaveBeenCalled(); expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();
    picker.onChooseItem(categories.find(value => value.category === "tags")!);
    const tagPicker = mockState.suggestModalInstances.at(-1) as unknown as StreamSourcePicker;
    const tag = tagPicker.getItems()[0]!; tagPicker.onChooseItem(tag);
    expect(choose).toHaveBeenCalledWith({ scope: createFolderScope("", true), filter: { tags: ["research"], properties: [] } });
    const id = (await view.createStream(choose.mock.calls[0]![0]))!;
    expect(stream(view, id)).toMatchObject({ query: "", scope: createFolderScope("", true), browse: { filter: { tags: ["research"], properties: [] } } });
  });

  it("retains selection and reading position while restored search waits for index readiness", async () => {
    const { view, plugin, file } = await setup(); const id = view.streams.getState().currentStreamId!;
    const ready = { initialized: true, disposed: false, mode: "indexed", status: "ready", lastError: null, health: createSearchHealth() };
    plugin.getSearchSnapshot.mockReturnValue(ready);
    let indexReady = true;
    plugin.getSearchService.mockReturnValue({ query: vi.fn(async () => indexReady
      ? { execution: "indexed-ready", orderedPaths: [file.path], matchCountsByPath: {}, matchFieldsByPath: { [file.path]: ["title"] } }
      : { execution: "indexed-building", orderedPaths: [], matchCountsByPath: {} }) });
    view.modules.search.initializeSnapshotState(); view.modules.search.onQueryChange({ query: "a" });
    view.modules.search.clearDebounce(); await view.modules.search.refreshProjection();
    view.modules.bulk.toggleBulkMode(); view.modules.bulk.bulkSelectAll();
    const anchor = { ref: { kind: "card" as const, path: file.path }, offset: 14 };
    view.registerReadingPosition({ capture: () => anchor, restore: vi.fn() });
    view.handleStreamCommand(id, "collapse");
    indexReady = false;
    plugin.getSearchSnapshot.mockReturnValue({ ...ready, status: "building", health: createSearchHealth({ readiness: "building" }) });
    view.streams.select(id); await view.waitForForeground();
    const restored = vi.fn(); view.registerReadingPosition({ capture: () => null, restore: restored });
    expect(view.panelModel.getState().cards.records).toEqual([]);
    expect(restored).not.toHaveBeenCalled();
    indexReady = true; view.modules.search.onSearchSnapshot(ready as never);
    await vi.waitFor(() => expect(view.panelModel.getState().cards.records).toHaveLength(1));
    expect(view.modules.bulk.getSelectedPaths().has(file.path)).toBe(true);
    expect(restored).toHaveBeenCalledWith(anchor, "folder:notes:true");
  });

  it("opens a navigation source in a new stream from the new-stream gesture", async () => {
    const { view } = await setup(); const first = view.streams.getState().currentStreamId!;
    expect(view.streamPanelModel.getState().navProps.newStreamGesture).toBe(true);
    const root = view.modules.navLayout.getProjection().rows.find(value => value.kind === "folder" && value.folderPath === "")!;
    view.handleNavigationIntent({ type: "activate", rowId: root.id, mode: "new-stream" });
    await view.waitForForeground();
    expect(view.streams.getState().streams.map(value => value.id)[0]).toBe(first);
    expect(view.streams.getState().streams).toHaveLength(2);
    expect(stream(view, first).scope).toEqual(createFolderScope("notes", true));
    expect(view.getCardScope()).toEqual(createFolderScope("", true));
  });

  it.each(["en", "zh"] as const)("switches streams and labels the root in %s from one menu", async language => {
    const { view, plugin } = await setup(); const first = view.streams.getState().currentStreamId!;
    plugin.getUiLanguage.mockReturnValue(language);
    plugin.getUiStrings.mockReturnValue(getUiStrings(language));
    const second = (await view.createStream({ scope: createFolderScope("", true) }))!;
    view.streams.setExpanded(first, false);
    const labels = getStreamUiStrings(language);
    mockState.menuInstances.length = 0;
    view.handleStreamCommand(second, "menu", { getBoundingClientRect: () => ({ left: 4, bottom: 8 }), ownerDocument: {} } as unknown as HTMLElement);
    const menu = mockState.menuInstances.at(-1)!;
    const items = menu.items.filter(item => item.kind === "item");
    const find = (title: string) => items.find(item => item.title === title)!;
    const rootLabel = getUiStrings(language).toolbar.folderMenu.rootFolder;
    expect(view.streamPanelModel.getState().entries.find(entry => entry.id === second)?.title).toBe(rootLabel);
    expect(items.slice(0, 2).map(item => [item.title, item.checked])).toEqual([[`notes · ${labels.collapsed}`, false], [rootLabel, true]]);
    expect(items.slice(2).map(item => item.title)).toEqual([labels.create, labels.duplicate, labels.createAt, labels.splitAt, labels.reopen, labels.maximize, labels.collapse,
      labels.moveAt, labels.rename, labels.moveToPane, labels.copyToPane, labels.close]);
    expect(find(labels.reopen).disabled).toBe(true);
    expect(menu.showAtPosition).toHaveBeenCalledWith({ x: 4, y: 8 }, {});
    find(labels.maximize).clickHandler!();
    expect(view.streams.getState()).toMatchObject({ maximizedStreamId: second, visibleIds: [second] });
    items[0].clickHandler!(); await view.waitForForeground();
    expect(view.streams.getState()).toMatchObject({ currentStreamId: first, maximizedStreamId: first });
    expect(view.getRuntimeDiagnostics().streams?.active).toBe(1);
    view.handleStreamCommand(first, "maximize");
    expect(view.streams.getState().visibleIds).toEqual([first, second]);
  });

  it("places a stream below an entire row from the title menu", async () => {
    const { view, plugin } = await setup();
    const first = view.streams.getState().currentStreamId!;
    const second = (await view.createStream({ scope: createFolderScope("", true) }))!;
    const third = (await view.createStream({ scope: createFolderScope("notes", true) }))!;
    for (const [id, title] of [[first, "A"], [second, "B"], [third, "C"]]) view.streams.update(id, { title });
    const anchor = { getBoundingClientRect: () => ({left: 0, bottom: 20}), ownerDocument: {} } as unknown as HTMLElement;
    const labels = getStreamUiStrings(plugin.getUiLanguage());
    const choose = (label: string) => mockState.menuInstances.at(-1)!.items.find(item => item.title === label)!.clickHandler!();
    view.handleStreamCommand(third, "menu", anchor);
    choose(labels.moveAt);
    choose("A + B");
    choose(labels.sides.bottom);
    expect(view.getState().layout).toMatchObject({
      axis: "y", ratio: 0.5, first: {axis: "x", first: {id: first}, second: {id: second}}, second: {id: third},
    });
  });

  it("only widens a hosting sidebar dock when the grid exceeds available space", async () => {
    const { view, app } = await setup();
    const dock = { size: 600, collapsed: false, setSize: vi.fn(function (this: { size: number }, size: number) { this.size = size; }) };
    app.workspace.leftSplit = dock; (view.leaf as unknown as { getRoot: () => unknown }).getRoot = () => dock;
    vi.stubGlobal("innerWidth", 1800);
    const second = (await view.createStream({ scope: createFolderScope("", true) }))!;
    expect(dock.setSize).not.toHaveBeenCalled();
    view.streams.setSize(300, 800);
    view.handleStreamCommand(second, "duplicate");
    expect(dock.setSize).toHaveBeenLastCalledWith(600 + 3 * 240 + 12 - 300);
    dock.setSize.mockClear(); dock.collapsed = true;
    view.handleStreamCommand(second, "duplicate");
    (view.leaf as unknown as { getRoot: () => unknown }).getRoot = () => ({}); dock.collapsed = false;
    view.handleStreamCommand(second, "duplicate");
    expect(dock.setSize).not.toHaveBeenCalled();
  });
});
