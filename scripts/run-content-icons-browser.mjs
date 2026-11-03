// Production CJS + real Svelte/CSS, with explicit host substitutes (no real vault).
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2] ?? "/tmp/fce-content-icons-browser.json";
assert(path.isAbsolute(output), "Report path must be absolute");
const host = await build({ entryPoints: [path.join(root, "scripts/runtime-bundle-host.ts")], bundle: true, write: false, platform: "browser", format: "iife", globalName: "IconTestHost", logLevel: "silent" });
const source = await readFile(path.join(root, "main.js"), "utf8");
const css = await readFile(path.join(root, "styles.css"), "utf8");
const catalogProbe = await build({ stdin: { contents: "export {getEmojiCatalog,isEmojiCatalogInitialized} from './src/icon-picker/emoji-catalog';", resolveDir: root }, bundle: true, write: false, platform: "browser", format: "iife", globalName: "CatalogProbe" });
const browser = await chromium.launch({ headless: true });
const report = { chromium: browser.version(), productionBytes: Buffer.byteLength(source), cases: [], timings: [], limitations: ["Real Chromium and production bundle with explicit Obsidian API substitutes; physical mobile devices and a running Obsidian host require manual acceptance."] };
try {
  for (const device of ["desktop", "phone", "tablet"]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: device === "phone" ? { width: 360, height: 760 } : device === "tablet" ? { width: 820, height: 1000 } : { width: 1100, height: 850 }, hasTouch: device !== "desktop" });
    const page = await context.newPage(); page.setDefaultTimeout(8000); const errors = [];
    console.log(`Checking ${device}/${theme}`);
    page.on("pageerror", error => errors.push(String(error)));
    await page.setContent(`<style>${css}\n:root {--background-primary:${theme === "dark" ? "#202020" : "#ffffff"};--text-normal:${theme === "dark" ? "#dddddd" : "#222222"};--text-muted:#888;--interactive-accent:#7254df;--background-modifier-border:#888;--radius-m:8px;--icon-size:16px;--layer-popover:1100;--background-secondary:#8882;--font-ui-small:13px;--font-smallest:11px;--background-modifier-hover:${theme === "dark" ? "rgba(255,255,255,0.075)" : "rgba(0,0,0,0.067)"};--background-modifier-active-hover:rgba(114,84,223,0.15);--shadow-s:0 1px 2px rgba(0,0,0,0.15);--shadow-l:0 8px 28px rgba(0,0,0,0.22)}body{margin:0}.folder-card-view{height:680px;width:100%}.fce-card-title-group{min-height:24px}.fce-list{min-height:300px}</style>`);
    await page.addScriptTag({ content: host.outputFiles[0].text });
    await page.evaluate(device => {
      const h = window.IconTestHost;
      const bounds = HTMLElement.prototype.getBoundingClientRect; h.installDom(); HTMLElement.prototype.getBoundingClientRect = bounds;
      h.Platform.isDesktopApp = device === "desktop"; h.Platform.isTablet = device === "tablet";
      Object.defineProperty(window, "indexedDB", { value: undefined, configurable: true });
      window.module = { exports: {} };
      window.require = id => {
        if (id === "obsidian") return h;
        if (id.startsWith("@codemirror/")) return { Prec: { highest: value => value }, dropCursor: () => ({}), EditorView: class { static domEventHandlers(value) { return value; } }, WidgetType: class {} };
        throw new Error(`Unexpected native import ${id}`);
      };
    }, device);
    await page.addScriptTag({ content: source });
    await page.evaluate(async () => {
      const fixture = window.IconTestHost.createApp();
      const plugin = new window.module.exports.default(fixture.app, { id: "card-workspace", version: "fixture" }); fixture.bind(plugin);
      let reads = 0, enumerations = 0, projections = 0;
      const read = fixture.app.vault.cachedRead;
      fixture.app.vault.cachedRead = (...args) => { reads++; return read(...args); };
      const files = fixture.app.vault.getFiles;
      fixture.app.vault.getFiles = (...args) => { enumerations++; return files(...args); };
      plugin.onload(); await plugin.startupPromise; fixture.layoutReady(); await plugin.startupPromise;
      await plugin.selectFolderByPath("", "panel-picker");
      const view = fixture.leaves[0].view;
      const project = view.modules.projection.reprojectCards.bind(view.modules.projection);
      view.modules.projection.reprojectCards = (...args) => { projections++; return project(...args); };
      window.iconsFixture = { fixture, plugin, view, counts: () => ({ reads, enumerations, projections }), actions: [] };
      const originalOpen = plugin.openNoteFromCard.bind(plugin);
      plugin.openNoteFromCard = (...args) => { window.iconsFixture.actions.push("open"); return originalOpen(...args); };
    });
    await page.locator(".fce-card-file-icon").waitFor();
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => window.iconsFixture.counts());
    await page.locator(".fce-card-file-icon").click();
    await page.locator(".fce-icon-picker").waitFor();
    const firstEmojiTabMs = await page.evaluate(() => {
      const tab = Array.from(document.querySelectorAll('[role="tab"]')).find(node => node.textContent === "Emoji");
      const start = performance.now(); tab.click(); return performance.now() - start;
    });
    const search = page.locator(".fce-icon-picker-search"); await search.fill("thumbs up");
    await page.locator('.fce-icon-picker-candidate[aria-label*="thumbs up"]').first().click();
    await page.locator('.fce-card-file-icon.fce-emoji-icon').waitFor();
    assert.equal(await page.locator(".fce-icon-picker").count(), 0, "A successful choice closes the picker");
    await page.locator(".fce-card-file-icon").click();
    await page.locator(".fce-icon-picker").waitFor();
    assert.equal(await page.locator('[role="tab"][aria-selected="true"]').textContent(), "Emoji", "An emoji icon reopens on the Emoji tab");
    assert((await page.locator(".fce-icon-picker-section").count()) > 0, "Recent and category sections render");
    assert((await page.locator(".fce-icon-picker-candidate").count()) <= 130);
    const shapes = await page.evaluate(() => Array.from(document.querySelectorAll(".fce-icon-picker-candidate, .fce-icon-picker-close"))
      .map(node => { const box = node.getBoundingClientRect(); return [Math.round(box.width * 10) / 10, Math.round(box.height * 10) / 10]; }));
    assert(shapes.length > 1 && shapes.every(([width, height]) => width === height), `Picker candidates and close button are square: ${JSON.stringify(shapes.slice(0, 3))}`);
    await page.evaluate(() => Promise.all(document.querySelector(".fce-icon-picker").getAnimations().map(animation => animation.finished)));
    const bounds = await page.locator(".fce-icon-picker").boundingBox(); const viewport = page.viewportSize();
    if (theme === "dark") await page.screenshot({ path: `/tmp/fce-content-icons-${device}.png` });
    else await page.screenshot({ path: `/tmp/fce-content-icons-${device}-light.png` });
    assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
    await page.locator(".fce-icon-picker-search").fill("👨‍👩‍👧‍👦"); await page.locator(".fce-icon-picker-search").press("Enter");
    await page.waitForFunction(() => document.querySelector(".fce-card-file-icon").textContent === "👨‍👩‍👧‍👦");
    assert.equal(await page.locator(".fce-icon-picker").count(), 0);
    assert.deepEqual(await page.evaluate(() => window.iconsFixture.actions), []);
    assert.deepEqual(await page.evaluate(() => window.iconsFixture.counts()), before, "Icons must not read/enumerate files or reproject cards");
    await page.locator(".fce-card-file-icon").click(); await page.locator(".fce-icon-picker").waitFor();
    await page.keyboard.press("Escape"); assert.equal(await page.locator(".fce-icon-picker").count(), 0);
    // A real drag gesture on the icon must not begin the card's drag session.
    await page.evaluate(() => {
      window.iconsFixture.dragStarts = 0;
      document.querySelector(".fce-card").addEventListener("dragstart", () => window.iconsFixture.dragStarts++);
    });
    const iconBounds = await page.locator(".fce-card-file-icon").boundingBox();
    await page.mouse.move(iconBounds.x + 8, iconBounds.y + 8); await page.mouse.down(); await page.mouse.move(iconBounds.x + 120, iconBounds.y + 100, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.iconsFixture.dragStarts), 0);
    await page.keyboard.press("Escape");
    const titleBounds = await page.locator(".fce-card-title-text").boundingBox();
    await page.mouse.move(titleBounds.x + 10, titleBounds.y + 10); await page.mouse.down(); await page.mouse.move(titleBounds.x + 140, titleBounds.y + 100, { steps: 12 }); await page.mouse.up();
    assert.equal(await page.evaluate(() => window.iconsFixture.dragStarts), 1, "Title must retain card dragging");
    // Navigation icon works inside the mobile navigation Modal, even for disabled links.
    if (device !== "desktop") await page.evaluate(async () => { const { view } = window.iconsFixture; view.modules.navLayout.onShellResize(320); await view.modules.navLayout.onToggleNavPane(); });
    if (device === "desktop") {
      await page.locator('[data-nav-row-id="links:backlinks"] .fce-tree-item-identity').hover();
      await page.locator('[data-nav-row-id="links:backlinks"]').screenshot({ path: `/tmp/fce-content-icons-hover-${theme}.png` });
    }
    await page.locator('[data-nav-row-id="links:backlinks"] .fce-tree-item-identity').click();
    await page.locator(".fce-icon-picker").waitFor();
    if (device === "desktop" && theme === "light") await page.screenshot({ path: "/tmp/fce-content-icons-lucide.png" });
    await page.locator(".fce-icon-picker-search").fill("🔗"); await page.locator(".fce-icon-picker-search").press("Enter");
    await page.waitForFunction(() => document.querySelector('[data-nav-row-id="links:backlinks"] .fce-tree-item-identity').textContent === "🔗");
    // Hover plates are squares derived from the shared glyph size on both surfaces.
    const plates = await page.evaluate(() => [".fce-nav-tree .fce-tree-item-identity", ".fce-card-file-icon"].map(selector => {
      const style = getComputedStyle(document.querySelector(selector), "::before"); return [style.width, style.height];
    }));
    assert.equal(plates[0][0], plates[0][1], "Navigation plate is square");
    assert.deepEqual(plates[1], plates[0], "Card and navigation plates share one size");
    // The host resolves the vault root only as "/", never by its empty folder identity.
    await page.evaluate(() => {
      const vault = window.iconsFixture.fixture.app.vault; const get = vault.getAbstractFileByPath;
      vault.getAbstractFileByPath = path => path === "" ? null : path === "/" ? vault.getRoot() : get(path);
    });
    await page.locator('[data-nav-row-id="folder:"] .fce-tree-item-identity').click();
    await page.locator(".fce-icon-picker").waitFor();
    await page.locator(".fce-icon-picker-none").click();
    await page.waitForFunction(() => document.querySelector('[data-nav-row-id="folder:"]') && !document.querySelector('[data-nav-row-id="folder:"] .fce-tree-item-identity'));
    assert.equal(await page.locator(".fce-icon-picker").count(), 0, "Choosing no icon on the root closes the picker");
    // Multi-view memory/persistence publication shares one file identity.
    await page.evaluate(async () => {
      const { fixture, view } = window.iconsFixture;
      const leaf = fixture.app.workspace.getLeaf(true); await leaf.setViewState({ type: "folder-card-view" }); await leaf.view.setFolder(fixture.app.vault.getRoot());
      await window.iconsFixture.plugin.saveSettings({ iconOverrides: { ...window.iconsFixture.plugin.getSettings().iconOverrides, '["file","note.md"]': { kind: "emoji", value: "📘" } } });
      window.iconsFixture.second = leaf.view;
    });
    await page.waitForFunction(() => Array.from(document.querySelectorAll(".fce-card-file-icon")).filter(el => el.textContent === "📘").length === 2);
    // Independent document: actual iframe realm simulates a pop-out ownerDocument.
    await page.evaluate(() => {
      const frame = document.createElement("iframe"); frame.id = "popout"; document.body.append(frame);
      window.IconTestHost.installObsidianDomHelpers(frame.contentDocument);
      const anchor = frame.contentDocument.createElement("button"); anchor.textContent = "Popout"; frame.contentDocument.body.append(anchor);
      window.iconsFixture.view.modules.iconActions.open({ kind: "file", ref: "note.md" }, anchor);
    });
    assert.equal(await page.frameLocator("#popout").locator(".fce-icon-picker").count(), 1);
    await page.frameLocator("#popout").locator(".fce-icon-picker-none").click();
    await page.waitForFunction(() => document.querySelectorAll(".fce-card-file-icon").length === 0 && document.querySelectorAll(".fce-card-title-text h4").length === 2);
    await page.addScriptTag({ content: catalogProbe.outputFiles[0].text });
    report.timings.push({ device, theme, firstEmojiTabMs, ...await page.evaluate(() => ({ initializedBefore: window.CatalogProbe.isEmojiCatalogInitialized(), initializationMs: window.CatalogProbe.getEmojiCatalog().initializationMs })) });
    assert.deepEqual(errors, []);
    report.cases.push(`${device}/${theme}: repeated application, whole emoji, isolated icon drag, no IO/projection, anchored bounds, disabled links, square plates, root picker, no-icon text, multi-view, ownerDocument`);
    await page.evaluate(async () => { const f = window.iconsFixture; await f.view.onClose(); await f.second.onClose(); f.plugin.onunload(); f.plugin.unload(); });
    await context.close();
  }
} finally { await browser.close(); }
await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
