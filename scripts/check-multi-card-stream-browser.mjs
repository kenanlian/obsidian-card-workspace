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
import {moveTile,rewrite} from './src/view/stream-tiles';
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
 const leaf=id=>({kind:'stream',id}), split=(id,axis,first,second)=>({kind:'split',id,axis,ratio:0.5,first,second});
 const layout=split('rows','y',split('top','x',leaf('one'),leaf('two')),split('bottom','x',leaf('three'),leaf('four')));
 const entries=['one','two','three','four'].map((id,i)=>({id,title:'Folder '+id,customTitle:null,ordinal:null,display:id==='three'?'spine':'stream',current:i===0,pending:false,panelModel:makePanel(id),props:{onToggleNavPane:()=>toggleNav()}}));
 const model=createStreamPanelModel({entries,layout,currentStreamId:'one',maximizedStreamId:null,navigationVisible:true,singlePane:false,navPanelModel:entries[0].panelModel,navProps:{onNavPaneResize:width=>{
  window.events.push({command:'nav-width',width});
  model.getState().navPanelModel.mutate(state=>{state.nav={...state.nav,paneWidth:width};});
 },onShellResize:w=>{window.rootWidths.push(w);const old=model.getState();if(old.singlePane!==(w<640))model.setState({...old,singlePane:w<640});}},labels:getStreamUiStrings('en'),recentlyClosedCount:1,unsupported:false});
 window.streamModel=model;
 const update=changes=>model.setState({...model.getState(),...changes});
 window.updateStreams=update;
 const select=id=>{const old=model.getState();if(old.currentStreamId===id)return;update({currentStreamId:id,entries:old.entries.map(e=>({...e,current:e.id===id})),navPanelModel:old.entries.find(e=>e.id===id).panelModel});};
 window.selectStream=select;
 component=mount(legacy?Legacy:Panel,{target,props:legacy?{panelModel:entries[0].panelModel,runtimeDevice:'phone'}:{model,
 onSelect:id=>{window.events.push({command:'select',id});select(id);},
 onCommand:(id,command)=>window.events.push({id,command}),onCreate:()=>window.events.push({command:'create'}),onReopen:()=>window.events.push({command:'reopen'}),
 onToggleNav:toggleNav,onResize:(width,height)=>window.stageSizes.push({width,height}),
 onSplitResize:(id,ratio)=>update({layout:rewrite(model.getState().layout,'split:'+id,node=>({...node,ratio}))}),
 onPlace:(id,place)=>{window.events.push({command:'move',id,place});update({layout:moveTile(model.getState().layout,id,place)});}
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
const browser = await chromium.launch({ headless: true, executablePath, ignoreDefaultArgs: ["--hide-scrollbars"] });
try {
 const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
 await page.route('**/*', route => route.abort());
 const errors = []; page.on('pageerror', error => errors.push(String(error)));
 await page.setContent('<style>body{margin:0}*{box-sizing:border-box}#mount{height:760px;--background-primary:#fff;--background-secondary:#eee;--text-normal:#222;--text-muted:#777;--background-modifier-border:#aaa;--interactive-accent:#705de8}</style><div class="folder-card-view" id="mount"></div>');
 await page.addStyleTag({ content: await readFile('styles.css', 'utf8') });
 await page.addScriptTag({ content: bundle.outputFiles[0].text });
 // Fractional sidebar sizes and classic scrollbars occur together on Windows.
 await page.addStyleTag({ content: '.fce-stream-stage::-webkit-scrollbar { width: 12px; height: 12px; }' });
 await page.evaluate(() => window.renderStreams(1400.5, 760.5));
 const samples = await page.evaluate(async () => {
  const stage = document.querySelector('.fce-stream-stage');
  const panel = stage.querySelector('.fce-stream-panel');
  const samples = [];
  for (let i = 0; i < 24; i++) {
   await new Promise(requestAnimationFrame);
   samples.push([stage.clientWidth, stage.clientHeight, panel.clientWidth, panel.clientHeight].join('x'));
  }
  return samples;
 });
 assert.equal(new Set(samples.slice(-12)).size, 1, 'fractional pane must settle: ' + samples.join(', '));
 const fit = await page.evaluate(() => {
  const stage = document.querySelector('.fce-stream-stage').getBoundingClientRect();
  const bottom = document.querySelector('[data-stream-id="four"]').getBoundingClientRect();
  return [bottom.right - stage.right, bottom.bottom - stage.bottom];
 });
 assert.deepEqual(fit, [0, 0], 'tiles must exactly fit a fractional stage without triggering scrollbars');
 await page.evaluate(() => window.renderStreams());
 // Two columns only: no workspace bar, stream list, or per-stream header.
 assert.equal(await page.locator('.fce-stream-workspace-bar, .fce-stream-list, .fce-stream-panel-header').count(), 0);
 assert.equal(await page.locator('.fce-stream-panel').count(), 3);
 assert.equal(await page.locator('.fce-stream-spine').count(), 1);
 assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 assert.equal(await page.locator('.fce-stream-splitter').count(), 2);
 const box = id => page.locator(`[data-stream-id="${id}"]`).boundingBox();
 const one = await box('one'), two = await box('two'), bottom = await box('four');
 assert.equal(one.y,two.y); assert(two.x>one.x); assert(bottom.y>one.y); assert(bottom.width>one.width);
 for (const id of ['one','two','four']) {
  const panel = page.locator(`[data-stream-id="${id}"]`);
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
 assert(await stageLocator.evaluate(node => node.scrollWidth === node.clientWidth), 'tiles fit the large screen');
 const stage = await stageLocator.boundingBox();
 const reported = await page.evaluate(() => window.stageSizes.at(-1)); assert.equal(reported.width, Math.round(stage.width)); assert.equal(reported.height, Math.round(stage.height));
 assert.equal(await page.evaluate(() => window.rootWidths.at(-1)), 1400);
 // Real layout must follow every pointer move, before the host commits on release.
 const navLocator = page.locator('.fce-nav-pane'), navHandle = page.locator('.fce-nav-resize-handle');
 const navStart = await navHandle.boundingBox(), stageStart = await stageLocator.boundingBox();
 const navX = navStart.x + navStart.width / 2, navY = navStart.y + 60;
 await page.mouse.move(navX, navY); await page.mouse.down();
 for (const delta of [30, 60, 80]) {
  await page.mouse.move(navX + delta, navY, { steps: 3 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.equal((await navLocator.boundingBox()).width, 240 + delta, 'navigation width follows the pointer');
  assert.equal((await stageLocator.boundingBox()).x, stageStart.x + delta, 'stream boundary follows the pointer');
  assert.equal(await page.evaluate(() => window.streamModel.getState().navPanelModel.getState().nav.paneWidth), 240, 'drag does not persist intermediate widths');
 }
 await page.mouse.up();
 await page.evaluate(() => new Promise(requestAnimationFrame));
 assert.deepEqual(await page.evaluate(() => window.events), [{ command: 'nav-width', width: 320 }]);
 assert.equal((await stageLocator.boundingBox()).x, stageStart.x + 80, 'release does not jump');
 // Cancellation restores both columns without committing a second width.
 const cancelStart = await navHandle.boundingBox();
 await page.mouse.move(cancelStart.x + cancelStart.width / 2, navY); await page.mouse.down();
 await page.mouse.move(cancelStart.x + cancelStart.width / 2 + 40, navY, { steps: 3 });
 await page.evaluate(() => new Promise(requestAnimationFrame));
 assert.equal((await navLocator.boundingBox()).width, 360);
 await navHandle.dispatchEvent('pointercancel', { pointerId: 1 });
 await page.mouse.up();
 await page.evaluate(() => new Promise(requestAnimationFrame));
 assert.equal((await navLocator.boundingBox()).width, 320);
 assert.equal((await stageLocator.boundingBox()).x, stageStart.x + 80);
 assert.equal(await page.evaluate(() => window.events.length), 1);
 // Host width changes remain authoritative after the transient drag ends.
 await page.evaluate(() => {
  window.streamModel.getState().navPanelModel.mutate(state => { state.nav = { ...state.nav, paneWidth: 240 }; });
  window.events = [];
 });
 await page.evaluate(() => new Promise(requestAnimationFrame));
 assert.equal((await navLocator.boundingBox()).width, 240);
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
 const column = page.locator('.fce-stream-splitter[aria-orientation="vertical"]');
 await column.focus(); await page.keyboard.press('ArrowRight');
 assert.equal((await box('one')).width,one.width+16);
 assert.equal((await box('four')).width,bottom.width);
 const row = await page.locator('.fce-stream-splitter[aria-orientation="horizontal"]').boundingBox();
 await page.mouse.move(row.x+100,row.y+3); await page.mouse.down(); await page.mouse.move(row.x+100,row.y+23); await page.mouse.up();
 assert.equal((await box('one')).height,one.height+20);
 // Drag the bottom stream to the edge of the whole stage, preserving the mounted lists.
 const grip = await page.locator('[data-stream-id="four"] > .fce-stream-grip').boundingBox();
 const tile = await box('four');
 assert.equal(await page.locator('.fce-stream-grip').count(), 3);
 assert.equal(grip.width, tile.width);
 assert.equal(grip.y, tile.y);
 assert.equal(grip.height, 10);
 const dest = await stageLocator.boundingBox();
 await page.mouse.move(grip.x+8,grip.y+grip.height/2); await page.mouse.down();
 await page.mouse.move(dest.x+dest.width/2,dest.y+dest.height-3,{steps:5});
 await page.keyboard.press('Escape'); await page.mouse.up();
 assert.equal(await page.locator('.fce-stream-drop-preview').count(),0);
 assert.equal((await box('four')).width,bottom.width);
 await page.mouse.move(grip.x+8,grip.y+grip.height/2); await page.mouse.down();
 await page.mouse.move(dest.x+dest.width/2,dest.y+dest.height-3,{steps:5});
 const preview = await page.locator('.fce-stream-drop-preview').boundingBox();
 assert.equal(preview.width,dest.width);
 await page.mouse.up();
 assert.equal((await box('four')).width,dest.width);
 assert.deepEqual(await page.evaluate(()=>window.events.at(-1)),{command:'move',id:'four',place:{target:'split:rows',side:'bottom'}});
 assert(await page.evaluate(()=>document.querySelector('[data-stream-id="one"] .fce-list')===window.firstViewport));
 await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').click();
 assert.equal(await page.locator('.fce-nav-pane').count(), 0);
 assert.equal(await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').count(), 1);
 await page.locator('[data-stream-id="one"] .fce-toolbar-buttons > button[aria-pressed]').click();
 assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 await page.evaluate(() => window.renderStreams(320, 760));
 await page.waitForSelector('.fce-stream-workspace.is-single');
 assert.equal(await stageLocator.isVisible(), false);
 assert.equal((await navLocator.boundingBox()).width, 320, 'single-pane navigation fills the available width');
 assert.equal(await navHandle.isVisible(), false);
 await page.evaluate(() => window.updateStreams({ navigationVisible: false }));
 assert.equal(await stageLocator.isVisible(), true);
 assert.equal(await page.locator('.fce-stream-panel .fce-toolbar-buttons > button[aria-pressed]').count(), 3);
 await page.locator('#mount').evaluate(node=>{node.style.height='220px';});
 await page.waitForFunction(()=>{const node=document.querySelector('.fce-stream-stage');return node.scrollWidth>node.clientWidth && node.scrollHeight>node.clientHeight;});
 await page.evaluate(()=>window.selectStream('four'));
 await page.waitForFunction(()=>document.querySelector('.fce-stream-stage').scrollTop>0);
 assert.equal(await page.locator('.fce-stream-workspace').evaluate(node => node.scrollWidth <= node.clientWidth), true);
 await page.evaluate(() => window.updateStreams({ layout:null,entries: [] }));
 await page.getByRole('button', { name: 'New stream…', exact: true }).click();
 await page.getByRole('button', { name: 'Reopen closed stream', exact: true }).click();
 await page.getByRole('button', { name: 'Toggle source navigation', exact: true }).click();
 assert.deepEqual(await page.evaluate(() => window.events.slice(-2).map(event => event.command)), ['create', 'reopen']);
 assert.equal(await stageLocator.isVisible(), false);
 await page.evaluate(() => window.renderStreams(320, 760, true));
 assert.equal(await page.locator('.fce-stream-workspace').count(), 0); assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 assert.deepEqual(errors, []);
 const result = { passed: true, checks: ['two-column strip without extra bars', 'stable fractional stage dimensions', 'nested row and column geometry', 'collapsed spine', 'toolbar switcher and close', 'retained viewport on target switch', 'both splitter axes', 'live navigation resize with release-only commit and cancellation', 'group edge preview and placement', 'navigation toggle on first stream', 'compact sidebar', 'empty state', 'legacy mobile default'], browserErrors: errors };
 if (process.argv.includes('--output')) await writeFile(process.argv[process.argv.indexOf('--output') + 1], JSON.stringify(result, null, 2) + '\n');
 console.log(JSON.stringify(result));
} finally { await browser.close(); }
