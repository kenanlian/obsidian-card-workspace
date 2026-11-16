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
 const entries=['one','two','three','four'].map((id,i)=>({id,title:'Stream '+id,sourceLabel:'Folder '+id,expanded:i<3,autoCollapsed:i===3,current:i===0,pending:false,panelModel:makePanel(id),props:{},weight:1}));
 const model=createStreamPanelModel({entries,currentStreamId:'one',direction:'horizontal',navigationVisible:true,singlePane:false,navPanelModel:entries[0].panelModel,navProps:{onShellResize:w=>{window.rootWidths.push(w);const old=model.getState();if(old.singlePane!==(w<640))model.setState({...old,singlePane:w<640});}},labels:getStreamUiStrings('en'),recentlyClosedCount:1,unsupported:false});
 window.streamModel=model;
 const update=changes=>model.setState({...model.getState(),...changes});
 window.updateStreams=update;
 component=mount(legacy?Legacy:Panel,{target,props:legacy?{panelModel:entries[0].panelModel,runtimeDevice:'phone'}:{model,
 onSelect:id=>{const old=model.getState();if(old.currentStreamId===id)return;update({currentStreamId:id,entries:old.entries.map(e=>({...e,current:e.id===id})),navPanelModel:old.entries.find(e=>e.id===id).panelModel});},
 onCommand:(id,command)=>window.events.push({id,command}),onCreate:()=>window.events.push({command:'create'}),onReopen:()=>window.events.push({command:'reopen'}),
 onToggleNav:()=>update({navigationVisible:!model.getState().navigationVisible}),onDirection:direction=>update({direction}),
 onResize:(width,height)=>window.stageSizes.push({width,height}),onResizePair:(first,second,delta)=>window.events.push({command:'resize',first,second,delta}),onReorder:(id,delta)=>window.events.push({command:'reorder',id,delta})
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
 assert.equal(await page.locator('.fce-stream-panel').count(), 3);
 assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 for (const panel of await page.locator('.fce-stream-panel').all()) { const box = await panel.boundingBox(); assert(box.width >= 240); assert(await panel.locator('.fce-card').count() > 0); }
 const stage = await page.locator('.fce-stream-stage').boundingBox();
 const reported = await page.evaluate(() => window.stageSizes.at(-1)); assert.equal(reported.width, Math.round(stage.width)); assert.equal(reported.height, Math.round(stage.height));
 assert.equal(await page.evaluate(() => window.rootWidths.at(-1)), 1400);
 await page.locator('[data-stream-list-id="two"] .fce-stream-select').click();
 assert.equal(await page.locator('[data-stream-list-id="two"] .fce-stream-select').getAttribute('aria-current'), 'true');
 // Switching target must keep the card viewport mounted and retain its scroll position.
 await page.locator('[data-stream-id="one"] .fce-list').evaluate(node => { window.firstViewport = node; node.scrollTop = 300; });
 await page.locator('[data-stream-list-id="three"] .fce-stream-select').click();
 assert(await page.evaluate(() => window.firstViewport === document.querySelector('[data-stream-id="one"] .fce-list') && window.firstViewport.scrollTop > 0));
 await page.locator('[data-stream-id="one"] button[aria-label="Collapse stream"]').click();
 await page.locator('[data-stream-id="one"] button[aria-label="Close stream"]').click();
 assert.deepEqual(await page.evaluate(() => window.events.slice(-2).map(event => event.command)), ['collapse', 'close']);
 await page.locator('.fce-stream-splitter').first().focus(); await page.keyboard.press('ArrowRight');
 assert.deepEqual(await page.evaluate(() => window.events.at(-1)), { command: 'resize', first: 'one', second: 'two', delta: 16 });
 const split = await page.locator('.fce-stream-splitter').first().boundingBox();
 await page.mouse.move(split.x + 3, split.y + 30); await page.mouse.down(); await page.mouse.move(split.x + 23, split.y + 30); await page.mouse.up();
 assert.equal(await page.evaluate(() => window.events.at(-1).delta), 20);
 await page.getByRole('button', { name: 'Toggle source navigation', exact: true }).click();
 assert.equal(await page.locator('.fce-nav-pane').count(), 0); assert.equal(await page.locator('.fce-stream-select').count(), 4);
 await page.locator('[data-stream-list-id="four"] button[aria-label="Manage stream"]').click();
 assert.equal(await page.evaluate(() => window.events.at(-1).id), 'four');
 await page.getByRole('button', { name: 'Arrange top to bottom', exact: true }).click();
 await page.locator('.fce-stream-splitter').first().focus(); await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(() => window.events.at(-1).delta), 16);
 await page.evaluate(() => window.renderStreams(320, 760));
 await page.waitForSelector('.fce-stream-workspace.is-single');
 // The host owns automatic collapse; apply its compact snapshot explicitly.
 await page.evaluate(() => window.updateStreams({ entries: window.streamModel.getState().entries.map((entry, index) => ({ ...entry, expanded: index === 0, autoCollapsed: index > 0 })) }));
 assert.equal(await page.locator('.fce-stream-stage').isVisible(), false);
 await page.getByRole('button', { name: 'Toggle source navigation', exact: true }).click();
 assert.equal(await page.locator('.fce-stream-select').count(), 0);
 assert.equal(await page.locator('.fce-stream-panel').count(), 1);
 assert.equal(await page.locator('.fce-stream-workspace').evaluate(node => node.scrollWidth <= node.clientWidth), true);
 await page.locator('.fce-stream-list-toggle').click(); assert.equal(await page.locator('.fce-stream-select').count(), 4);
 assert.equal(await page.locator('.fce-stream-workspace-body').evaluate(node => getComputedStyle(node).flexDirection), 'column');
 await page.evaluate(() => window.renderStreams(320, 760, true));
 assert.equal(await page.locator('.fce-stream-workspace').count(), 0); assert.equal(await page.locator('.fce-nav-pane').count(), 1);
 assert.deepEqual(errors, []);
 const result = { passed: true, checks: ['three rendered streams', 'shared navigation', 'current target and retained viewport', 'collapse and close intents', 'measured stage', 'pointer and keyboard resizing', 'hidden navigation access', 'compact sidebar', 'legacy mobile default'], browserErrors: errors };
 if (process.argv.includes('--output')) await writeFile(process.argv[process.argv.indexOf('--output') + 1], JSON.stringify(result, null, 2) + '\n');
 console.log(JSON.stringify(result));
} finally { await browser.close(); }
