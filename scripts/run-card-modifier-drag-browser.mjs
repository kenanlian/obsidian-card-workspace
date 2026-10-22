// Real pointer input is required: jsdom cannot exercise Chromium's Shift selection.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { chromium } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: {
  output: { type: "string" }, css: { type: "string" },
} });
assert(values.output && path.isAbsolute(values.output), "Pass --output <absolute report.json>");
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "card-modifier-fixture.ts", loader: "ts", contents: `
import {mount, unmount, tick} from 'svelte';
import CardItem from './src/view/CardItem.svelte';
import {createSearchPreviewMatcher, extractSearchPreviewSnippets} from './src/search/search-preview';
let component;
const trace = [];
window.cardDragFixture = {
  trace,
  async render({bulk = false, search = false, native = true, diagram = false} = {}) {
    if (component) await unmount(component);
    trace.length = 0;
    const card = {path:'notes/A.md', title:'Drag card title', fileKind:diagram ? 'canvas' : 'markdown',
      file:{}, ctime:1, mtime:2, excerpt:'', previewHtml:'<p>Card body <code>nested text</code></p>',
      previewMode:'text', hydrated:true, taskSummary:{total:3, incomplete:2}};
    if (search) card.searchPreview = {query:'card', revision:1, mtime:2, previewLines:5, snippetLimit:2,
      status:'hits', snippets:await extractSearchPreviewSnippets('Card body text.', {
        limit:1, idPrefix:'fixture', matcher:createSearchPreviewMatcher('card')})};
    component = mount(CardItem, {target:document.querySelector('#mount'), props:{card,
      appearance:{cardCornerRadius:'compact', previewLines:5, searchPreviewSnippetCount:2,
        cardImageMode:'inline', cardImageFit:'contain'}, bulkMode:bulk, searchQuery:search ? 'card' : '',
      image:{status:'ready', url:'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>')},
      onOpenNote:payload => trace.push({type:'open', ...payload}),
      onPinToggle:payload => trace.push({type:'pin', ...payload}),
      onCardContextMenu:() => trace.push({type:'menu'}),
      onBulkSelectCard:payload => trace.push({type:'bulk', ...payload}),
      onCardHoverLink:({targetEl}) => trace.push({type:'hover', target:targetEl.className}),
      onCardDragStart:({event}) => {trace.push({type:'start', shift:event.shiftKey, ctrl:event.ctrlKey, alt:event.altKey});
        return native ? () => trace.push({type:'finish'}) : null;}
    }});
    await tick();
  }
};
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => {
  event.preventDefault();
  trace.push({type:'drop', shift:event.shiftKey, ctrl:event.ctrlKey, alt:event.altKey,
    payload:event.dataTransfer.getData('application/x-card-workspace-note')});
});
` },
  write: false, bundle: true, format: "iife", platform: "browser", target: "es2020",
  conditions: ["browser"], alias: { obsidian: path.join(root, "scripts/image-benchmark/obsidian.ts") },
  plugins: [sveltePlugin({ compilerOptions: { dev: false, css: "injected" } })],
});
const css = await readFile(values.css ?? path.join(root, "styles.css"), "utf8");
const browser = await chromium.launch({ headless: true });
const report = { chromium: browser.version(), cases: [], failures: [],
  limitations: ["Production card component and CSS in Chromium; host drag callback is a fixture, not Obsidian or Excalidraw."] };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.setDefaultTimeout(3000);
  await page.setContent(`<style>${css}
    *{box-sizing:border-box}#mount{width:320px}.fce-card{height:auto!important;transition:none!important}
    #target{position:absolute;left:500px;top:200px;width:350px;height:350px;background:#ddd}
    </style><div class="folder-card-view"><div id="mount"></div></div><div id="target">Drop target</div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const render = async (options = {}) => {
    await page.mouse.move(950, 750);
    await page.evaluate(options => window.cardDragFixture.render(options), options);
  };
  const run = async (name, task) => {
    try { await task(); report.cases.push(name); }
    catch (error) { report.failures.push({ name, error: String(error),
      trace: await page.evaluate(() => window.cardDragFixture.trace) }); }
  };
  const surfaces = ["h4", ".fce-excerpt code", ".fce-card-image img", ".fce-card-task-count", ".fce-card-header"];
  for (const surface of surfaces) for (const timing of ["before", "during"]) for (let mask = 0; mask < 8; mask++) {
    const keys = [mask & 1 && "Shift", mask & 2 && "Control", mask & 4 && "Alt"].filter(Boolean);
    await run(`${surface}: ${keys.join("+") || "none"} ${timing}`, async () => {
      await render();
      const box = await page.locator(surface).boundingBox();
      assert(box, "Source must be visible");
      const x = box.x + Math.min(20, box.width / 2), y = box.y + box.height / 2;
      try {
        await page.mouse.move(x, y);
        if (timing === "before") for (const key of keys) await page.keyboard.down(key);
        await page.mouse.down();
        await page.mouse.move(x + 20, y + 20, { steps: 5 });
        if (timing === "during") for (const key of keys) await page.keyboard.down(key);
        await page.mouse.move(650, 400, { steps: 12 });
        await page.mouse.up();
      } finally {
        await page.mouse.up();
        for (const key of keys) await page.keyboard.up(key);
      }
      const trace = await page.evaluate(() => window.cardDragFixture.trace);
      assert.equal(trace.filter(event => event.type === "start").length, 1);
      assert.equal(trace.filter(event => event.type === "finish").length, 1);
      const drop = trace.find(event => event.type === "drop");
      assert(drop, "Must reach the drop target");
      assert.deepEqual([drop.shift, drop.ctrl, drop.alt], [!!(mask & 1), !!(mask & 2), !!(mask & 4)]);
      assert.deepEqual(JSON.parse(drop.payload), { path: "notes/A.md", title: "Drag card title" });
      assert(!trace.some(event => ["open", "pin", "menu", "bulk"].includes(event.type)));
      assert.equal(await page.locator(".fce-card.is-dragging, .fce-card-drag-ghost").count(), 0);
    });
  }
  for (const [selector, type, options] of [
    ["h4", "open", {}], [".fce-excerpt code", "open", {}],
    [".fce-card-pin-btn", "pin", {}], [".fce-more-actions-btn", "menu", {}],
    [".fce-card-bulk-checkbox", "bulk", { bulk: true }],
    [".fce-search-snippet mark", "open", { search: true }],
  ]) await run(`click ${selector}`, async () => {
    await render(options);
    await page.locator(selector).click({ modifiers: ["Shift"] });
    const events = await page.evaluate(() => window.cardDragFixture.trace.filter(event => event.type !== "hover"));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, type);
    if (type === "bulk") assert.equal(events[0].shiftKey, true);
    if (options.search) assert(events[0].snippetId);
  });
  for (const selector of ["h4", ".fce-excerpt code"]) await run(`hover ${selector}`, async () => {
    await render(); await page.locator(selector).hover();
    assert(await page.evaluate(() => window.cardDragFixture.trace.some(event => event.type === "hover")));
  });
  report.passed = report.failures.length === 0;
} finally {
  await browser.close();
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2));
}
console.log(`${report.cases.length} passed, ${report.failures.length} failed; ${values.output}`);
assert(report.passed, JSON.stringify(report.failures.slice(0, 3), null, 2));
