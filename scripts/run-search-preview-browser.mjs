/** Real Chromium legacy rendering gates plus candidate controller lifecycle. */
import assert from "node:assert/strict";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { freezePreviewBaseline, root, summarize, timingGate } from "./search-preview-baseline.mjs";
import { formattedSource, denseSource } from "./search-preview-fixtures.mjs";
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0) throw new Error("Pass --output <absolute report path>");
const output = path.resolve(process.argv[outputIndex + 1]);
const temporary = await mkdtemp(path.join(tmpdir(), "card-workspace-search-browser-"));
const option = (name, fallback) => {const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1];};
const frozen = freezePreviewBaseline(option("--baseline"));
const selfCheck = process.argv.includes("--self-check");
const sampleCount = Number(option("--samples", 20)), warmups = Number(option("--warmups", 5));
assert(Number.isInteger(sampleCount) && sampleCount > 0 && Number.isInteger(warmups) && warmups >= 0);
let server, browser;
try {
  // Reuse the panel fixture's complete host groups so production virtualization,
  // resize observers and scroll anchoring run in the same browser as card layout.
  const fixture = await readFile(path.join(root, "scripts/image-benchmark/browser.ts"), "utf8");
  const modelStart = fixture.indexOf("  model = createPanelModel({");
  const modelEnd = fixture.indexOf("  const target = document.querySelector", modelStart);
  const modelCode = fixture.slice(modelStart, modelEnd).replace("model =", "const model =");
  const entry = `
import {mount, unmount, tick} from 'svelte';
import CardItem from './src/view/CardItem.svelte';
import FolderCardPanel from './src/view/FolderCardPanel.svelte';
import {createPanelModel} from './src/view/panel-model';
import {DEFAULT_GROUP_SPEC} from './src/card-grouping-settings';
import {getUiStrings} from './src/i18n';
import {createSearchPreviewMatcher, extractSearchPreviewSnippets} from './src/search/search-preview';
const plainSource = Array.from({length: 12}, (_, i) => 'prefix ' + '宽'.repeat(70) + ' needle ' + ('readable context ' + i + ' ').repeat(40)).join('\\n\\n');
const formattedSource = ${JSON.stringify(formattedSource)};
let component, events = [], records = [], model;
const longTasks = []; new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({start:entry.startTime,duration:entry.duration})))).observe({type:'longtask'});
const image = {status: 'ready', url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88"><rect width="88" height="88" rx="5" fill="#d8e7f5"/><path d="M8 69L30 37L48 55L66 22L80 69Z" fill="#7398b8"/></svg>')};
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
async function render({lines, snippetLimit = 2, mode, width = 280, panel = false, bulk = false, kind = "plain", sourceOverride = null}) {
  if (component) await unmount(component);
  events = [];
  const target = document.querySelector('#mount'); target.innerHTML = ''; target.style.width = width + 'px'; target.style.height = panel ? '640px' : 'auto';
  const denseSource = ${JSON.stringify(denseSource)};
  const source = sourceOverride ?? (kind === "formatted" ? formattedSource : kind === "dense" ? denseSource : plainSource);
  const snippets = await extractSearchPreviewSnippets(source, {limit: snippetLimit, idPrefix: 'browser', matcher: createSearchPreviewMatcher('needle')});
  const card = {path: 'test.md', title: 'Needle title', fileKind: 'markdown', file: {}, ctime: 1, mtime: 2, excerpt: '', previewHtml: '<p>Ordinary opening</p>', previewMode: 'text', hydrated: true, taskSummary: null,
    searchPreview: {query: 'needle', revision: 1, mtime: 2, previewLines: lines, snippetLimit, status: 'hits', snippets}};
  records = Array.from({length: panel ? 80 : 1}, (_, index) => ({...card, path: 'note-' + index + '.md', title: 'Needle ' + index}));
  // Start both lanes at the same frame boundary after extraction and teardown.
  await frame();
  const publicationStart = performance.now();
  if (!panel) component = mount(CardItem, {target, props: {card, searchQuery: 'needle', appearance: {previewLines: lines, searchPreviewSnippetCount: snippetLimit, cardCornerRadius: 'compact', cardImageMode: mode, cardImageFit: 'cover'},
    bulkMode: bulk, image: mode === 'right' ? image : undefined, onOpenNote: event => events.push(event), onBulkSelectCard: event => events.push(event)}});
  else {
    const epochs = {load: {value: 1}}, settings = {cardImageMode: mode};
    const cardsGroup = () => ({records, searchMatchCountsByPath: {}, selectedPath: null, loading: false, generation: 1, sequenceRevision: 1, hydrationRevision: 1, groupSegments: [], groupRevision: 0, extentCount: records.length});
    ${modelCode.replace('const model =', 'model =')}
    model.mutate(draft => {draft.search = {...draft.search, query: 'needle', committedQuery: 'needle'}; draft.appearance = {...draft.appearance, previewLines: lines, searchPreviewSnippetCount: snippetLimit}; draft.images = {byPath: mode === 'right' ? Object.fromEntries(records.map(card => [card.path, image])) : {}, requestVersion: 1};});
    component = mount(FolderCardPanel, {target, props: {panelModel: model, onOpenNote: event => events.push(event)}});
  }
  await tick(); const renderMs = performance.now() - publicationStart; await frame(); const firstFrameMs = performance.now() - publicationStart; await frame();
  return {firstFrameMs, publicationStart, renderMs};
}
async function perf(options) {
  await frame();
  const initial = await render({...options, panel:true});
  const scroller = document.querySelector('.fce-list');
  await frame();
  const patchStart = performance.now();
  model.mutate(draft => {draft.cards = {...draft.cards, records: draft.cards.records.map(card => ({...card, searchPreview: {...card.searchPreview}}))};});
  await tick(); await frame();
  const patchFrameMs = performance.now() - patchStart;
  const frames = []; let previous = performance.now();
  for(let i=0;i<12;i++){scroller.scrollTop = i % 2 ? 1800 : 600; scroller.dispatchEvent(new Event('scroll')); await frame(); const now=performance.now();frames.push(now-previous);previous=now;}
  const end = performance.now(); await frame();
  return {firstFrameMs:initial.firstFrameMs, renderMs:initial.renderMs, patchFrameMs, frames, longTasks:longTasks.filter(task => task.start >= initial.publicationStart && task.start <= end)};
}
window.searchPreviewBrowser = {perf, render, events: () => events, resize: async width => {document.querySelector('#mount').style.width = width + 'px'; await frame(); await frame();}, patch: async () => {model.mutate(draft => {draft.cards = {...draft.cards, records: draft.cards.records.map(card => ({...card}))};}); await tick(); await frame();}};
`;
  const assets = new Map();
  for (const [name, sourceRoot] of [["before", frozen.baselineRoot], ["after", selfCheck ? frozen.baselineRoot : root]]) {
    const bundle = path.join(temporary, name + ".js");
    await build({ stdin: {contents: entry, resolveDir: sourceRoot, sourcefile: "search-preview-browser.ts", loader: "ts"}, outfile: bundle,
      bundle: true, format: "iife", platform: "browser", target: "es2020", conditions: ["browser"],
      alias: {obsidian: path.join(root, "scripts/image-benchmark/obsidian.ts")}, plugins: [sveltePlugin({compilerOptions: {dev: false, css: "injected"}})] });
    const css = await readFile(path.join(sourceRoot, "styles.css"), "utf8");
    assets.set("/" + name + "/browser.js", {type: "text/javascript", body: await readFile(bundle)});
    assets.set("/" + name, {type: "text/html", body: `<!doctype html><meta charset="utf-8"><style>:root { --background-primary:#fff; --background-secondary:#eee; --background-modifier-border:#d5d5d5; --text-normal:#222; --text-muted:#666; --text-faint:#999; --interactive-accent:#668cee; --text-highlight-bg:#fff0a5; --font-interface:Arial; --font-text:Arial; --font-monospace:monospace; } body {margin:20px; font:14px Arial;} button,input,select {font:inherit;} #mount {display:flex;} ${css} .folder-card-view { --fce-card-min-width:220px; --fce-wall-gap:12px; }</style><div id="mount" class="folder-card-view"></div><script src="/${name}/browser.js"></script>`});
  }
  if (!selfCheck) {
    const bundle = path.join(temporary, "production-lifecycle.js");
    await build({entryPoints: [path.join(root, "scripts/search-preview/production-lifecycle.ts")], outfile: bundle,
      bundle: true, format: "iife", platform: "browser", target: "es2020", conditions: ["browser"],
      alias: {obsidian: path.join(root, "scripts/image-benchmark/obsidian.ts")}, plugins: [sveltePlugin({compilerOptions: {dev: false, css: "injected"}})]});
    assets.set("/production/browser.js", {type: "text/javascript", body: await readFile(bundle)});
    assets.set("/production", {type: "text/html", body: assets.get("/after").body.replace('/after/browser.js', '/production/browser.js')});
  }
  server = createServer((request, response) => {
    const asset = assets.get(request.url);
    if (!asset) {response.writeHead(404); response.end(); return;}
    response.setHeader("Content-Type", asset.type); response.end(asset.body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({headless: true, args: ["--no-sandbox"]});
  const runProduction = async () => {
    if (selfCheck) return null;
    const productionPage = await browser.newPage({viewport: {width: 1000, height: 850}});
    const errors = []; productionPage.on("pageerror", error => errors.push(String(error)));
    try {
      await productionPage.goto(`http://127.0.0.1:${server.address().port}/production`);
      await productionPage.waitForFunction(() => !!window.searchPreviewProduction);
      const result = await productionPage.evaluate(() => window.searchPreviewProduction.run());
      assert.deepEqual(errors, []); return result;
    } finally {await productionPage.close();}
  };
  if (process.argv.includes("--lifecycle-only")) {
    assert(!selfCheck, "Lifecycle smoke uses candidate production APIs");
    const productionLifecycle = await runProduction();
    await mkdir(path.dirname(output), {recursive: true});
    await writeFile(output, JSON.stringify({schemaVersion: 3, baselineCommit: frozen.revision, smoke: true, chromium: browser.version(), productionLifecycle, passed: true}, null, 2));
    console.log(JSON.stringify({output, smoke: true, passed: true}));
  } else {
  const page = await browser.newPage({viewport: {width: 1000, height: 850}});
  const errors = []; page.on("pageerror", error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/after`);
  await page.waitForFunction(() => !!window.searchPreviewBrowser);
  const measure = () => page.evaluate(() => [...document.querySelectorAll(".fce-search-snippet")].map(button => {
    const rect = button.getBoundingClientRect(), mark = button.querySelector("mark"), range = document.createRange(); range.selectNodeContents(mark);
    const hit = range.getClientRects()[0], text = button.querySelector(".fce-search-snippet-text");
    range.setStart(text, 0); range.setEndBefore(mark);
    const prefixWidth = range.getBoundingClientRect().width;
    const style = getComputedStyle(button), lineHeight = parseFloat(style.lineHeight);
    return {height: rect.height, width: text.clientWidth, lineHeight, prefixWidth, firstHitVisible: hit.top >= rect.top - 1 && hit.bottom <= rect.bottom + 1 && hit.left >= rect.left - 1 && hit.right <= rect.right + 1,
      clamp: getComputedStyle(text).webkitLineClamp, location: button.getAttribute("aria-label")};
  }));
  const layouts = [];
  for (const kind of ["plain", "formatted", "dense"]) for (const mode of ["off", "right"]) for (const lines of [3,8]) for (const snippetLimit of [1,2,3,4,5]) {
    await page.evaluate(options => window.searchPreviewBrowser.render(options), {mode, lines, snippetLimit, kind});
    const values = await measure(); assert.equal(values.length, snippetLimit);
    if (mode === "right") {
      const imageRect = await page.locator(".fce-card-image").boundingBox();
      assert(Math.abs(imageRect.width - 88) < 0.1); assert(Math.abs(imageRect.height - 88) < 0.1);
      assert(values[0].width < 200, "Image did not reserve body width");
    }
    for (const value of values) { assert(Math.abs(value.height - value.lineHeight * 2) < 1); assert.equal(value.clamp, "2"); assert(value.firstHitVisible, JSON.stringify({kind,mode,lines,snippetLimit,...value})); assert(value.prefixWidth <= value.width * 0.3 + 1); }
    const positions = await page.locator(".fce-search-snippet").evaluateAll(buttons => buttons.map(button => { const rect = button.getBoundingClientRect(); return {top: rect.top, bottom: rect.bottom}; }));
    const dividerGap = selfCheck ? 0 : 9;
    assert.equal(await page.locator(".fce-preview-context-divider").count(), selfCheck ? 0 : snippetLimit - 1);
    positions.slice(1).forEach((rect, i) => assert(Math.abs(rect.top - positions[i].bottom - dividerGap) < 1, "Context divider spacing"));
    const excerpt = await page.locator(".fce-excerpt").boundingBox(); assert(excerpt.height >= values.reduce((sum, item) => sum + item.height, 0) + dividerGap * (snippetLimit - 1) - 1, "Half-snippet clipping");
    await page.locator(".fce-search-snippet").first().click();
    await page.locator(".fce-search-snippet").first().press("Enter");
    await page.locator(".fce-search-snippet").first().press("Space");
    assert.equal(await page.evaluate(() => window.searchPreviewBrowser.events().length), 3, "Native keyboard duplicate activation");
    await page.evaluate(() => window.searchPreviewBrowser.resize(220));
    const narrow = await measure(); assert(narrow.every(value => value.firstHitVisible && value.prefixWidth <= value.width * 0.3 + 1));
    layouts.push({kind, mode, lines, snippetLimit, values, narrow});
  }
  const styledPrefixes = [];
  for (const sourceOverride of [
    "# " + "宽".repeat(70) + " needle heading",
    "9".repeat(1000) + ") needle item",
    "`" + "prefix ".repeat(20) + "needle tail`",
    "2) `" + "prefix ".repeat(20) + "needle tail`",
    "```ts\n  " + "prefix ".repeat(20) + "needle tail\n    next line\n```",
  ]) for (const mode of ["off", "right"]) {
    await page.evaluate(options => window.searchPreviewBrowser.render(options), {lines:5, snippetLimit:1, mode, sourceOverride});
    const wide = await measure();
    await page.evaluate(() => window.searchPreviewBrowser.resize(220));
    const narrow = await measure();
    assert([...wide,...narrow].every(v => v.firstHitVisible && v.prefixWidth <= v.width * 0.3 + 1), "Styled prefix concealed the hit");
    styledPrefixes.push({sourceOverride,mode,wide,narrow});
  }
  await page.evaluate(() => window.searchPreviewBrowser.render({lines: 3, snippetLimit: 5, mode: "right"}));
  await mkdir(path.dirname(output), {recursive: true});
  await page.screenshot({path: output.replace(/\.json$/, ".png"), fullPage: true});
  await page.evaluate(() => window.searchPreviewBrowser.render({lines: 5, mode: "right", bulk: true}));
  await page.locator(".fce-search-snippet").first().click();
  await page.locator(".fce-search-snippet").first().press("Enter");
  await page.locator(".fce-search-snippet").first().press("Space");
  const selections = await page.evaluate(() => window.searchPreviewBrowser.events());
  assert.equal(selections.length, 3); assert(selections.every(event => event.snippetId === undefined && typeof event.shiftKey === "boolean"));
  await page.evaluate(() => window.searchPreviewBrowser.render({lines: 7, mode: "right", panel: true}));
  const scroller = page.locator(".fce-list");
  await scroller.evaluate(element => {element.scrollTop = 1200;}); await page.waitForTimeout(100);
  const before = await scroller.evaluate(element => element.scrollTop);
  await page.evaluate(() => window.searchPreviewBrowser.patch());
  const after = await scroller.evaluate(element => element.scrollTop); assert(Math.abs(after - before) < 1, "Preview patch moved scroll anchor");
  await page.evaluate(() => window.searchPreviewBrowser.resize(310)); await page.waitForTimeout(100);
  const resized = await scroller.evaluate(element => element.scrollTop); assert(resized > 0, "Resize lost scroll position");
  assert((await measure()).every(value => value.firstHitVisible));
  await mkdir(path.dirname(output), {recursive: true});
  await page.screenshot({path: output.replace(/\.json$/, "-scroll.png"), fullPage: true});
  assert.deepEqual(errors, []);
  const beforePage = await browser.newPage({viewport:{width:1000,height:850}});
  beforePage.on("pageerror", error => errors.push(String(error)));
  await beforePage.goto(`http://127.0.0.1:${server.address().port}/before`);
  await beforePage.waitForFunction(() => !!window.searchPreviewBrowser);
  const pages = [beforePage, page], sessions = await Promise.all(pages.map(p => p.context().newCDPSession(p)));
  const performanceCases = [], gates = [];
  if (process.argv.includes("--profile")) for (const session of sessions) await session.send("Performance.enable");
  for (const kind of ["plain", "formatted", "dense"]) for (const mode of ["off", "right"]) for (const snippetLimit of [2,5]) {
    if (option("--case") && option("--case") !== `${kind}/${mode}/${snippetLimit}`) continue;
    const measurements = [[], []];
    for (let iteration = -warmups; iteration < sampleCount; iteration++) {
      for (const i of (iteration % 2 ? [1,0] : [0,1])) {
        await pages[i].bringToFront(); await sessions[i].send("HeapProfiler.collectGarbage");
        const metricsBefore = process.argv.includes("--profile") ? await sessions[i].send("Performance.getMetrics") : null;
        const value = await pages[i].evaluate(options => window.searchPreviewBrowser.perf(options), {kind, mode, snippetLimit, lines:5});
        if (metricsBefore) {
          const metricsAfter = await sessions[i].send("Performance.getMetrics");
          value.profile = Object.fromEntries(metricsAfter.metrics.filter(m => ["LayoutCount","RecalcStyleCount","LayoutDuration","RecalcStyleDuration","ScriptDuration","TaskDuration"].includes(m.name)).map(m => [m.name,m.value-metricsBefore.metrics.find(v=>v.name===m.name).value]));
        }
        if (iteration >= 0) measurements[i].push(value);
      }
    }
    const summary = measurements.map(values => ({firstFrameMs:summarize(values.map(v=>v.firstFrameMs)), renderMs:summarize(values.map(v=>v.renderMs)), patchFrameMs:summarize(values.map(v=>v.patchFrameMs)), frames:summarize(values.flatMap(v=>v.frames)), longTasks:values.flatMap(v=>v.longTasks), raw:values}));
    for (const metric of ["firstFrameMs", "patchFrameMs", "frames"]) gates.push(timingGate(`${kind}/${mode}/${snippetLimit}/${metric}`, summary[0][metric], summary[1][metric], 0, 2));
    gates.push({name:`${kind}/${mode}/${snippetLimit}/longTasks`, passed:summary[1].longTasks.length <= summary[0].longTasks.length});
    performanceCases.push({kind, mode, snippetLimit, before:summary[0], after:summary[1]});
    console.log(`Measured browser ${kind}/${mode}/${snippetLimit}`);
  }
  for (const kind of ["formatted", "dense"]) {
    await page.evaluate(options => window.searchPreviewBrowser.render(options), {kind, mode:"right", snippetLimit:5, lines:5});
    await page.screenshot({path:output.replace(/\.json$/, `-${kind}.png`), fullPage:true});
  }
  assert(performanceCases.length > 0, "No matching timing case");
  assert.deepEqual(errors, []);
  const productionLifecycle = await runProduction();
  const report = {schemaVersion:3, baselineCommit:frozen.revision, selfCheck, sampleCount, warmups, chromium:browser.version(), layouts, styledPrefixes, bulkSelections:selections.length, scroll:{before,after,resized}, errors, performanceCases, productionLifecycle, gates, passed:gates.every(g=>g.passed), scope:"Real Chromium production Svelte; separate candidate SearchController/ProjectionController/HydrationController lifecycle with synthetic indexed membership and source IO, no Obsidian or disk IO"};
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({output, layouts:layouts.length, passed:report.passed, failed:gates.filter(g=>!g.passed)}));
  if ((selfCheck || process.argv.includes("--check")) && !report.passed) process.exitCode=1;
  }
} finally {
  await browser?.close(); server?.close(); frozen.dispose();
  await rm(temporary, {recursive: true, force: true});
}
