// Real Chromium gestures cover internal card/navigation DnD and touch scroll arbitration.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { chromium } from "@playwright/test";
const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { output: { type: "string" } } });
assert(values.output && path.isAbsolute(values.output), "Pass --output <absolute report.json>");
const bundle = await build({
  stdin: { resolveDir: root, sourcefile: "navigation-drag-fixture.ts", loader: "ts", contents: `
import {mount,unmount,tick} from 'svelte';
import CardItem from './src/view/CardItem.svelte';
import NavigationPane from './src/view/NavigationPane.svelte';
import {DragSession} from './src/view/drag-session';
let components=[], session; const trace=[];
window.navigationDragFixture={trace, async render(){
  for(const component of components) await unmount(component); session?.dispose(); trace.length=0;
  session=new DragSession(); window.navigationDragFixture.session=session;
  let previous=null; session.subscribe(snapshot=>{
    if(snapshot?.mode!==previous){trace.push({type:'session',mode:snapshot?.mode??null});previous=snapshot?.mode;}
  });
  const base={section:'tags',level:2,parentId:'section:tags',positionInSet:1,setSize:1,expandable:false,
    expanded:false,disabled:true,muted:true,semanticState:'none',label:'Muted work',fullPath:'work',count:0,icon:'tag'};
  const row={...base,id:'tag:work',kind:'tag',tagPath:'work',synthetic:false,descendantCount:0,
    menuTarget:{section:'tags',scope:'item',itemId:'work'}};
  const section={...base,id:'section:tags',kind:'section',parentId:null,level:1,label:'Tags',expandable:true,
    expanded:true,disabled:false,menuTarget:{section:'tags',scope:'header'}};
  components=[mount(CardItem,{target:document.querySelector('#cards'),props:{
    card:{path:'notes/A.md',title:'Drag card title',fileKind:'markdown',file:{},ctime:1,mtime:2,
      excerpt:'',previewHtml:'<p>Drag body</p>',previewMode:'text',hydrated:true,taskSummary:null},
    dragSession:session,resolveCardDragPaths:()=>['notes/A.md','notes/B.png'],
    onOpenNote:()=>trace.push({type:'open'}),onCardContextMenu:()=>trace.push({type:'menu'})
  }}),mount(NavigationPane,{target:document.querySelector('#navigation'),props:{dragSession:session,
    nav:{folderTree:[],favorites:[],boxSummaries:[],paneWidth:300,layoutMode:'dual',visible:true,
      sectionCollapsed:{tags:false},showItemCounts:true,tooltipSide:'right',propertyFilterCount:0,
      projection:{normalizedQuery:'',querying:false,sections:[],rows:[section,row],noResults:false},
      query:'',focusId:null,focusRequest:null,revealRequest:null},
    onDropCards:(target,paths)=>trace.push({type:'drop',target,paths})
  }})]; await tick(); document.querySelector('#source-scroll').scrollTop=0;
}};
window.addEventListener('touchmove',event=>trace.push({type:'touchmove',
  cancelable:event.cancelable,prevented:event.defaultPrevented,active:!!session.current}),{passive:true});
` },
  write: false, bundle: true, format: "iife", platform: "browser", target: "es2020", conditions: ["browser"],
  alias: { obsidian: path.join(root, "scripts/image-benchmark/obsidian.ts") },
  plugins: [sveltePlugin({ compilerOptions: { dev: false, css: "injected" } })],
});
const css = await readFile(path.join(root, "styles.css"), "utf8");
const browser = await chromium.launch({ headless: true });
const report = { chromium: browser.version(), cases: [], failures: [], limitations: [
  "Production CardItem, NavigationPane, DragSession and CSS; host callback records typed intent without vault writes.",
  "Chromium CDP touch emulation; real devices and mobile navigation Modal are outside this diagnostic."] };
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, hasTouch: true });
  page.setDefaultTimeout(3000);
  await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
    *{box-sizing:border-box}body{margin:0}#source-scroll{position:absolute;left:30px;top:100px;width:320px;height:300px;overflow:auto}
    #cards .fce-card{height:230px!important;transition:none!important}#filler{height:1000px}
    #navigation{position:absolute;left:530px;top:100px;width:300px;height:400px}
    .fce-nav-pane{height:400px}.fce-nav-pane-sections{overflow:auto;flex:1}.fce-nav-tree [data-nav-row-id]{min-height:40px}
    </style><div class="folder-card-view"><div id="source-scroll"><div id="cards"></div><div id="filler"></div></div><div id="navigation"></div></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const client = await page.context().newCDPSession(page);
  let touching = false;
  const touch = async (type, point) => { await client.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] }); touching = type === "touchStart" || type === "touchMove"; };
  const trace = () => page.evaluate(() => window.navigationDragFixture.trace);
  const point = async selector => { const box = await page.locator(selector).boundingBox(); assert(box); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
  const run = async (name, task) => {
    await page.evaluate(() => window.navigationDragFixture.render());
    try { await task(); report.cases.push({ name, trace: await trace() }); }
    catch (error) { report.failures.push({ name, error: String(error), trace: await trace() }); }
    finally { if (touching) await touch("touchCancel"); await page.mouse.up(); }
  };
  const assertDrop = async () => {
    const events = await trace();
    assert.deepEqual(events.filter(event => event.type === "drop"), [{type:"drop",target:{kind:"tag",tag:"work"},paths:["notes/A.md","notes/B.png"]}]);
    assert(!events.some(event => ["open", "menu"].includes(event.type)));
    assert.equal(await page.evaluate(() => window.navigationDragFixture.session.current), null);
    assert.equal(await page.locator(".fce-card-drag-ghost").count(), 0);
  };
  await run("mouse card to muted tag commits once", async () => {
    const source = await point("#cards h4"), target = await point('[data-nav-row-id="tag:work"]');
    assert.equal(await page.locator('[data-nav-row-id="tag:work"]').getAttribute("aria-disabled"), "true");
    await page.mouse.move(source.x, source.y); await page.mouse.down();
    await page.mouse.move(source.x + 20, source.y + 20, { steps: 5 });
    await page.mouse.move(target.x, target.y, { steps: 12 }); await page.mouse.up(); await assertDrop();
  });
  await run("CDP long press then touch move to muted tag commits once", async () => {
    const source = await point("#cards h4"), target = await point('[data-nav-row-id="tag:work"]');
    await touch("touchStart", source); await page.waitForTimeout(550);
    assert.equal(await page.evaluate(() => window.navigationDragFixture.session.current?.mode), "touch");
    await touch("touchMove", { x: (source.x + target.x) / 2, y: target.y });
    await touch("touchMove", target); await page.waitForTimeout(50);
    const movement = (await trace()).filter(event => event.type === "touchmove");
    assert(movement.length >= 2 && movement.every(event => event.active && event.cancelable && event.prevented), "Every active real touchmove must be cancelable and prevented");
    assert.equal(await page.locator("#source-scroll").evaluate(node => node.scrollTop), 0);
    await touch("touchEnd"); await assertDrop();
  });
  await run("CDP early swipe scrolls without activating drag", async () => {
    const source = await point("#cards .fce-excerpt");
    await touch("touchStart", source); await touch("touchMove", { x: source.x, y: source.y - 40 });
    await touch("touchMove", { x: source.x, y: source.y - 110 }); await touch("touchEnd"); await page.waitForTimeout(550);
    assert(!(await trace()).some(event => event.type === "drop" || event.type === "session" && event.mode));
    assert(await page.locator("#source-scroll").evaluate(node => node.scrollTop > 0), "Early swipe should scroll the card region");
  });
  report.passed = report.failures.length === 0;
} finally {
  await browser.close(); await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2));
}
console.log(`${report.cases.length} passed, ${report.failures.length} failed; ${values.output}`);
assert(report.passed, JSON.stringify(report.failures, null, 2));
