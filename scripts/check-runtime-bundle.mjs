import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../main.js", import.meta.url), "utf8");
const hostBundle = await build({ entryPoints: ["scripts/runtime-bundle-host.ts"], bundle: true, write: false, platform: "browser", format: "cjs", logLevel: "silent" });
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://synthetic.invalid", pretendToBeVisual: true, runScripts: "outside-only" });
const win = dom.window, context = dom.getInternalVMContext();
const forbidden = [];
try {
  Object.assign(win, { module: { exports: {} }, process: undefined, Buffer: undefined, electron: undefined,
    indexedDB: undefined, Worker: undefined, OffscreenCanvas: undefined, requestIdleCallback: undefined,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  vm.runInContext(hostBundle.outputFiles[0].text, context, { filename: "explicit-host-substitutes.js" });
  const host = win.module.exports; host.installDom();
  const cm = { Prec: { highest: value => value }, EditorView: class {}, WidgetType: class {} };
  win.require = id => {
    if (id === "obsidian") return host;
    if (["@codemirror/state", "@codemirror/view", "@codemirror/language"].includes(id)) return cm;
    forbidden.push(id); throw new Error(`Forbidden native module: ${id}`);
  };
  win.module = { exports: {} };
  vm.runInContext(source, context, { filename: "production-main.js" });
  assert.equal(win.process, undefined); assert.equal(win.Buffer, undefined);
  const Plugin = win.module.exports.default, fixture = host.createApp();
  const plugin = new Plugin(fixture.app, { id: "card-workspace", version: "fixture" }); fixture.bind(plugin);
  plugin.onload(); await plugin.startupPromise; fixture.layoutReady(); await plugin.startupPromise;
  assert(!plugin.commands.some(command => command.id === "quick-input"));
  const settings = plugin.tabs[0], definitions = settings.getSettingDefinitions();
  assert(!definitions.some(group => group.heading === plugin.getUiStrings().noteInput.quickInputHeading));
  const openSetting = definitions.flatMap(group => group.items).find(item => item.control?.key === "defaultCardOpenBehavior");
  assert(!Object.hasOwn(openSetting.control.options, "new-window"));
  settings.display();
  await plugin.selectFolderByPath("", "panel-picker");
  const view = fixture.leaves[0].view;
  assert.equal(view.panelModel.getState().cards.records.length, 1);
  assert.equal(view.panelModel.getState().cards.records[0].path, "note.md");
  assert(win.document.querySelector(".fce-card"), "Production Svelte card should be mounted");
  const menu = new host.Menu(); view.modules.cardMenu.addItems(menu, "note.md");
  assert(!menu.items.some(item => item.title === plugin.getUiStrings().view.contextMenu.openInNewWindow));
  const writes = plugin.writes, leaves = fixture.leaves.length;
  assert.equal((await plugin.openQuickInput()).outcome, "unavailable");
  assert.equal((await plugin.openNoteFromCard("note.md", "new-window")).outcome, "unavailable");
  assert.equal((await plugin.runtimePlatform.openWindow()).outcome, "unavailable");
  assert.equal(plugin.runtimePlatform.systemPath("note.md"), null);
  assert.equal(plugin.writes, writes); assert.equal(fixture.leaves.length, leaves);
  // IndexedDB is absent: non-empty search remains blocked while browse is live.
  const service = plugin.getSearchService();
  const result = await service.query({ query: "preview", candidatePaths: ["note.md"] });
  assert.notEqual(result.execution, "indexed-ready");
  const oneView = plugin.getRuntimeDiagnostics();
  for (let index = 1; index < 20; index++) fixture.leaves.push(fixture.leaves[0]);
  const multipleViews = plugin.getRuntimeDiagnostics();
  assert.equal(multipleViews.totals.viewCount, 20); assert.equal(multipleViews.views.length, 16); assert.equal(multipleViews.omittedViews, 4);
  assert.equal(multipleViews.totals.previewCacheEntries, oneView.totals.previewCacheEntries * 20);
  fixture.leaves.splice(1);
  await view.onClose(); plugin.onunload(); plugin.unload();
  assert.equal(plugin.runtimeActivity.getDiagnostics().background.waiters, 0);
  assert.deepEqual(forbidden, []);
  console.log("[runtime-bundle] native-free load, startup, Svelte browsing, menus, settings and unavailable actions passed");
} finally { dom.window.close(); }
