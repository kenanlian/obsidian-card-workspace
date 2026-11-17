// Production Svelte and CSS, synthetic host: no vault, server, or external requests.
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import { chromium } from '@playwright/test';
import path from 'node:path';
const root = process.cwd();
const fixture = await readFile('scripts/image-benchmark/browser.ts', 'utf8');
const modelCode = fixture.slice(fixture.indexOf('  model = createPanelModel({'), fixture.indexOf('  const target = document.querySelector')).replace('model =', 'const model =');
const bundle = await build({ stdin: { resolveDir: root, sourcefile: 'stream-fixture.ts', loader: 'ts', contents: `
import { mount, unmount, tick } from 'svelte';
import Panel from './src/view/StreamWorkspacePanel.svelte';
import Legacy from './src/view/FolderCardPanel.svelte';
import { createPanelModel } from './src/view/panel-model';
import { createStreamPanelModel } from './src/view/stream-panel-model';
import { getStreamUiStrings } from './src/view/stream-ui-strings';
import { getUiStrings } from './src/i18n';
import { DEFAULT_GROUP_SPEC } from './src/card-grouping-settings';
let component;
const settings={cardImageMode:'off',cardImageFit:'contain'};
function makePanel(id) {
 const records=Array.from({length:100},(_,i)=>({path:id+'-'+i+'.md',title:id+' card '+i,fileKind:'markdown',file:{},ctime:1,mtime:1,excerpt:'Preview',previewHtml:'<p>Preview</p>',previewMode:'text',hydrated:true,taskSummary:null}));
 const cardsGroup=()=>({records,searchMatchCountsByPath:{},sequenceRevision:1,groupRevision:0,extentCount:records.length,groupSegments:[],loading:false,generation:1,hydrationRevision:0,selectedPath:null});
 ${modelCode}
 model.mutate(s=>{s.nav={...s.nav,layoutMode:'dual',visible:true}});
 return model;
}
window.renderStreams=async(width=1400,height=760,legacy=false)=>{
 if(component)await unmount(component);
 const target=document.querySelector('#mount');target.style.width=width+'px';target.style.height=height+'px';
 window.events=[];window.stageSizes=[];window.rootWidths=[];
 const toggleNav=()=>update({navigationVisible:!model.getState().navigationVisible});
 const layout=[['one','stream',420,true],['two','stream',420,true],['three','spine',28,false],['four','stream',700,false]];
 const entries=layout.map(([id,display,width,separator],i)=>({id,title:'Folder '+id,customTitle:null,ordinal:null,display,width,separator,current:i===0,pending:false,panelModel:makePanel(id),props:{onToggleNavPane:()=>toggleNav()}}));
 const model=createStreamPanelModel({entries,currentStreamId:'one',maximizedStreamId:null,navigationVisible:true,singlePane:false,navPanelModel:entries[0].panelModel,navProps:{onShellResize:w=>{window.rootWidths.push(w);const old=model.getState();if(old.singlePane!==(w<640))model.setState({...old,singlePane:w<640});}},labels:getStreamUiStrings('en'),recentlyClosedCount:1,unsupported:false});
 window.streamModel=model;
 const update=changes=>model.setState({...model.getState(),...changes});
 window.updateStreams=update;
 const select=id=>{const old=model.getState();if(old.currentStreamId===id)return;update({currentStreamId:id,entries:old.entries.map(e=>({...e,current:e.id===id})),navPanelModel:old.entries.find(e=>e.id===id).panelModel});};
 window.selectStream=select;
 component=mount(legacy?Legacy:Panel,{target,props:legacy?{panelModel:entries[0].panelModel,runtimeDevice:'phone'}:{model,
 onSelect:id=>{window.events.push({command:'select',id});select(id);},
 onCommand:(id,command)=>window.events.push({id,command}),onCreate:()=>window.events.push({command:'create'}),onReopen:()=>window.events.push({command:'reopen'}),
 onToggleNav:toggleNav,onResize:(width,height)=>window.stageSizes.push({width,height}),
 onStreamWidth:(id,width)=>window.events.push({command:'width',id,width}),onMove:(id,index)=>window.events.push({command:'move',id,index})
 }});await tick();await new Promise(requestAnimationFrame);
};` }, bundle: true, write: false, format: 'iife', platform: 'browser', conditions: ['browser'], plugins: [sveltePlugin({ compilerOptions: { dev: false } })], alias: { obsidian: path.join(root, 'scripts/image-benchmark/obsidian.ts') }, logLevel: 'silent' });
// Reuse installed Chromium even when the lockfile's Playwright revision is newer.
let executablePath = chromium.executablePath();
if (!existsSync(executablePath)) {
 const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'darwin' ? path.join(homedir(), 'Library/Caches/ms-playwright') : path.join(homedir(), '.cache/ms-playwright'));
 const revisions = (await readdir(cache)).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
 const candidates = revisions.flatMap(name => ['chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing', 'chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-win/chrome.exe'].map(relative => path.join(cache, name, relative)));
 executablePath = candidates.find(candidate => existsSync(candidate));
 assert(executablePath, 'A cached Playwright Chromium is required; this check never downloads browsers.');
}
const browser = await chromium.launch({ headless: true, executablePath });
try {
 const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
 await page.route('**/*', route => route.abort());
 const errors = []; page.on('pageerror', error => errors.push(String(error)));
 await page.setContent('<style>body{margin:0}*{box-sizing:border-box}#mount{height:760px;--background-primary:#fff;--background-secondary:#eee;--text-normal:#222;--text-muted:#777;--background-modifier-border:#aaa;--interactive-accent:#705de8}</style><div class="folder-card-view" id="mount"></div>');
 await page.addStyleTag({ content: await readFile('styles.css', 'utf8') });
 await page.addScriptTag({ content: bundle.outputFiles[0].text });
 await page.evaluate(() => window.renderStreams());
 // Two columns only: no workspace bar, stream list, or per-stream header.
 assert.equal(await page.locator('.fce-stream-workspace-bar, .fce-stream-list, .fce-stream-panel-header').count(), 0);
 assert.equal(await page.locator('.fce-stream-panel').count(), 3);
 assert.equal(await page.locator('.fce-stream-spine').count(), 1);
 assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 assert.equal(await page.locator('.fce-stream-splitter').count(), 2);
 assert.equal(await page.locator('.fce-stream-stage > :last-child').getAttribute('data-stream-id'), 'four');
 for (const [id, width] of [['one', 420], ['two', 420], ['four', 700]]) {
  const panel = page.locator(`[data-stream-id="${id}"]`);
  assert(Math.abs((await panel.boundingBox()).width - width) <= 1, `${id} keeps its pixel width`);
  assert(await panel.locator('.fce-card').count() > 0);
  assert.equal(await panel.locator('.fce-stream-switcher').count(), 1);
  assert.equal(await panel.locator('.fce-stream-close').count(), 1);
  await panel.locator('.fce-stream-switcher').hover();
  const titleRect = await panel.locator('.fce-stream-switcher').boundingBox();
  const closeRect = await panel.locator('.fce-stream-close').boundingBox();
  assert(Math.abs(titleRect.height - closeRect.height) <= 1, `${id} title hover target matches the toolbar icons`);
  assert(Math.abs(titleRect.y - closeRect.y) <= 1, `${id} title and icons align vertically`);
 }
 assert.equal(await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').count(), 1);
 assert.equal(await page.locator('[data-stream-id="two"] .fce-toolbar-buttons > button[aria-pressed]').count(), 0);
 assert(Math.abs((await page.locator('.fce-stream-spine').boundingBox()).width - 28) <= 1);
 const stageLocator = page.locator('.fce-stream-stage');
 assert(await stageLocator.evaluate(node => node.scrollWidth > node.clientWidth), 'streams overflow into horizontal scrolling instead of shrinking');
 const stage = await stageLocator.boundingBox();
 const reported = await page.evaluate(() => window.stageSizes.at(-1)); assert.equal(reported.width, Math.round(stage.width)); assert.equal(reported.height, Math.round(stage.height));
 assert.equal(await page.evaluate(() => window.rootWidths.at(-1)), 1400);
 // Pointer selection switches the target, keeps viewports mounted, and does not scroll the strip.
 await page.locator('[data-stream-id="one"] .fce-list').evaluate(node => { window.firstViewport = node; node.scrollTop = 300; });
 await page.locator('[data-stream-id="two"] .fce-list').click({ position: { x: 20, y: 200 } });
 assert.equal(await page.locator('[data-stream-id="two"]').getAttribute('aria-current'), 'true');
 assert(await page.evaluate(() => window.firstViewport === document.querySelector('[data-stream-id="one"] .fce-list') && window.firstViewport.scrollTop > 0));
 await page.locator('[data-stream-id="two"] .fce-stream-switcher').click();
 await page.locator('[data-stream-id="two"] .fce-stream-close').click();
 await page.locator('.fce-stream-spine').click({ button: 'right' });
 assert.deepEqual(await page.evaluate(() => window.events.slice(-3)), [{ id: 'two', command: 'menu' }, { id: 'two', command: 'close' }, { id: 'three', command: 'menu' }]);
 await page.locator('.fce-stream-spine').click();
 assert.deepEqual(await page.evaluate(() => window.events.at(-1)), { command: 'select', id: 'three' });
 await page.locator('.fce-stream-splitter').first().focus(); await page.keyboard.press('ArrowRight');
 assert.deepEqual(await page.evaluate(() => window.events.at(-1)), { command: 'width', id: 'one', width: 436 });
 const split = await page.locator('.fce-stream-splitter').first().boundingBox();
 await page.mouse.move(split.x + 3, split.y + 30); await page.mouse.down(); await page.mouse.move(split.x + 23, split.y + 30); await page.mouse.up();
 assert.deepEqual(await page.evaluate(() => window.events.at(-1)), { command: 'width', id: 'one', width: 440 });
 // Dragging a stream's title reorders it; the click ending the drag is swallowed.
 await stageLocator.evaluate(node => { node.scrollLeft = 0; });
 const spine = await page.locator('.fce-stream-spine').boundingBox(), first = await page.locator('[data-stream-id="one"]').boundingBox();
 const eventCount = await page.evaluate(() => window.events.length);
 await page.mouse.move(spine.x + 14, spine.y + 80); await page.mouse.down();
 await page.mouse.move(spine.x - 200, spine.y + 80, { steps: 4 }); await page.mouse.move(first.x + 20, spine.y + 80, { steps: 4 });
 assert.equal(await page.locator('[data-stream-id="one"].is-drop-before').count(), 1);
 await page.mouse.up();
 assert.deepEqual(await page.evaluate(n => window.events.slice(n), eventCount), [{ command: 'move', id: 'three', index: 0 }]);
 // A target chosen elsewhere (switcher menu, command) is scrolled into view.
 await page.evaluate(() => window.selectStream('four')); await page.evaluate(() => new Promise(requestAnimationFrame));
 const four = await page.locator('[data-stream-id="four"]').boundingBox(), visible = await stageLocator.boundingBox();
 assert(four.x >= visible.x - 1 && four.x + four.width <= visible.x + visible.width + 1, 'programmatic target is revealed');
 // The outer edge has no stream resize hit target, including after horizontal scrolling.
 await stageLocator.evaluate(node => { node.scrollLeft = node.scrollWidth; });
 assert.equal(await stageLocator.evaluate(node => {
  const rect = node.getBoundingClientRect();
  return !!document.elementFromPoint(rect.right - 2, rect.top + 100)?.closest('.fce-stream-splitter');
 }), false);
 await page.evaluate(() => {
  window.expandedEntries = window.streamModel.getState().entries;
  window.updateStreams({ entries: window.expandedEntries.map(entry => entry.id === 'four' ? { ...entry, display: 'spine', width: 28, panelModel: null } : entry) });
 });
 assert.equal(await page.locator('.fce-stream-stage > :last-child').getAttribute('data-stream-item'), 'four');
 assert.equal(await page.locator('.fce-stream-stage > :last-child').evaluate(node => getComputedStyle(node).borderRightWidth), '0px');
 await page.evaluate(() => window.updateStreams({ entries: window.expandedEntries }));
 await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').click();
 assert.equal(await page.locator('.fce-nav-pane').count(), 0);
 assert.equal(await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').count(), 1);
 await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').click();
 assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 await page.evaluate(() => window.renderStreams(320, 760));
 await page.waitForSelector('.fce-stream-workspace.is-single');
 assert.equal(await stageLocator.isVisible(), false);
 await page.evaluate(() => window.updateStreams({ navigationVisible: false }));
 assert.equal(await stageLocator.isVisible(), true);
 assert.equal(await page.locator('.fce-stream-panel .fce-toolbar-buttons > button[aria-pressed]').count(), 3);
 assert.equal(await page.locator('.fce-stream-workspace').evaluate(node => node.scrollWidth <= node.clientWidth), true);
 await page.evaluate(() => window.updateStreams({ entries: [] }));
 await page.getByRole('button', { name: 'New stream…', exact: true }).click();
 await page.getByRole('button', { name: 'Reopen closed stream', exact: true }).click();
 await page.getByRole('button', { name: 'Toggle source navigation', exact: true }).click();
 assert.deepEqual(await page.evaluate(() => window.events.slice(-2).map(event => event.command)), ['create', 'reopen']);
 assert.equal(await stageLocator.isVisible(), false);
 await page.evaluate(() => window.renderStreams(320, 760, true));
 assert.equal(await page.locator('.fce-stream-workspace').count(), 0); assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 assert.deepEqual(errors, []);
 const result = { passed: true, checks: ['two-column strip without extra bars', 'pixel-width streams and spines', 'horizontal overflow', 'toolbar switcher and close', 'retained viewport on target switch', 'width splitters', 'outer edge without stream resize handle or spine border', 'drag reorder', 'programmatic reveal', 'navigation toggle on first stream', 'compact sidebar', 'empty state', 'legacy mobile default'], browserErrors: errors };
 if (process.argv.includes('--output')) await writeFile(process.argv[process.argv.indexOf('--output') + 1], JSON.stringify(result, null, 2) + '\n');
 console.log(JSON.stringify(result));
} finally { await browser.close(); }
