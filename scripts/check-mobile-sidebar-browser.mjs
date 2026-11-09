// Production panel and CSS in Chromium; synthetic host, no real vault or mobile-device claim.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import sveltePlugin from 'esbuild-svelte';
import { chromium } from '@playwright/test';
import path from 'node:path';
const root = process.cwd();
const fixture = await readFile('scripts/image-benchmark/browser.ts', 'utf8');
const modelCode = fixture.slice(fixture.indexOf('  model = createPanelModel({'), fixture.indexOf('  const target = document.querySelector')).replace('model =', 'const model =');
const bundle = await build({ stdin: { resolveDir: root, sourcefile: 'sidebar-fixture.ts', loader: 'ts', contents: `
import {mount,unmount,tick} from 'svelte';
import Panel from './src/view/FolderCardPanel.svelte';
import {createPanelModel} from './src/view/panel-model';
import {getUiStrings} from './src/i18n';
import {DEFAULT_GROUP_SPEC} from './src/card-grouping-settings';
let component;
window.renderSidebar = async (device,width) => {
 if(component) await unmount(component);
 const records=Array.from({length:60},(_,i)=>({path:i+'.md',title:'A long readable card title '+i,fileKind:'markdown',file:{},ctime:1,mtime:1,excerpt:'Preview',previewHtml:'<p>Preview</p>',previewMode:'text',hydrated:true,taskSummary:null}));
 const settings={cardImageMode:'off',cardImageFit:'contain'};
 const cardsGroup=()=>({records,searchMatchCountsByPath:{},sequenceRevision:1,groupRevision:0,extentCount:records.length,groupSegments:[],loading:false,generation:1,hydrationRevision:0,selectedPath:null});
 ${modelCode}
 window.sidebarDrops=[];
 model.mutate(s=>{s.nav={...s.nav,projection:{...s.nav.projection,rows:[{id:'folder:',kind:'folder',section:'folders',folderPath:'',parentId:null,level:1,positionInSet:1,setSize:1,expandable:false,expanded:false,disabled:false,semanticState:'none',label:'Vault',fullPath:'',count:60,icon:null,directCount:60,recursiveCount:60,recursiveFolderCount:0,menuTarget:{section:'folders',scope:'item',itemId:''}}]}};s.scope={...s.scope,displayPath:'Very long folder name with 中文 and many more words'};s.nav={...s.nav,layoutMode:'single',visible:false};});
 const target=document.querySelector('#mount');target.style.width=width+'px';
 component=mount(Panel,{target,props:{panelModel:model,runtimeDevice:device,
 onDropCards:(target,paths)=>window.sidebarDrops.push({target,paths}),
 onToggleNavPane:()=>model.mutate(s=>{s.nav={...s.nav,visible:!s.nav.visible}}),
 onSearchQueryChange:({query})=>model.mutate(s=>{s.search={...s.search,query}}),
 onToolbarAction:({action})=>{if(action==='bulk')model.mutate(s=>{s.bulk={...s.bulk,bulkMode:!s.bulk.bulkMode}})}
 }});window.sidebarModel=model;await tick();await new Promise(requestAnimationFrame);
};` }, bundle:true, write:false, format:'iife', platform:'browser', conditions:['browser'], plugins:[sveltePlugin({compilerOptions:{dev:false}})], alias:{obsidian:path.join(root,'scripts/image-benchmark/obsidian.ts')}, logLevel:'silent' });
const browser=await chromium.launch({headless:true});
const results=[];
try {
 const page=await browser.newPage({viewport:{width:900,height:800}});
 const client=await page.context().newCDPSession(page);
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setContent('<style>body{margin:0;background:#eee}#mount{height:700px;box-sizing:border-box}button{box-sizing:border-box}*{box-sizing:border-box}</style><div id="mount" class="folder-card-view"></div>');
 await page.addStyleTag({content:await readFile('styles.css','utf8')});
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 for(const device of ['phone','tablet']) for(const width of [320,360,390,600]) {
  await page.evaluate(([device,width])=>window.renderSidebar(device,width),[device,width]);
  assert.deepEqual(errors,[]);
  const initial=await page.evaluate(()=>{
   const root=document.querySelector('#mount'),shell=root.querySelector('.fce-shell'),toolbar=root.querySelector('.fce-header'),scope=root.querySelector('.fce-toolbar-scope');
   return {overflow:shell.scrollWidth>root.clientWidth,toolbarOverflow:toolbar.scrollWidth>root.clientWidth,scopeWidth:scope.getBoundingClientRect().width};
  });
  assert(!initial.overflow&&!initial.toolbarOverflow,JSON.stringify({device,width,initial}));assert(initial.scopeWidth>0);
  await page.evaluate(()=>{document.body.className='is-phone is-hidden-nav';});
  assert.equal(await page.locator('.fce-header').evaluate(node=>getComputedStyle(node).opacity),'1');
  await page.locator('.fce-toolbar-button').first().click();
  await page.waitForSelector('.fce-shell.is-nav-visible');
  assert.equal(await page.locator('.modal').count(),0);
  await page.locator('.fce-nav-header-button').first().click();
  await page.waitForSelector('.fce-shell.is-nav-hidden');
  assert(await page.locator('.fce-card').count()>0);
  const source=await page.locator('.fce-card h4').first().boundingBox();
  const touch=async(type,point)=>client.send('Input.dispatchTouchEvent',{type,touchPoints:point?[{...point,id:1}]:[]});
  await touch('touchStart',{x:source.x+source.width/2,y:source.y+source.height/2});
  await page.waitForSelector('.fce-shell.is-nav-visible');
  const destination=await page.locator('[data-nav-row-id="folder:"]').boundingBox();
  await touch('touchMove',{x:destination.x+destination.width/2,y:destination.y+destination.height/2});
  await touch('touchEnd');
  await page.waitForSelector('.fce-shell.is-nav-hidden');
  assert.equal(await page.evaluate(()=>window.sidebarDrops.length),1);
  await touch('touchStart',{x:source.x+source.width/2,y:source.y+source.height/2});
  await page.waitForSelector('.fce-shell.is-nav-visible');await touch('touchCancel');
  await page.waitForSelector('.fce-shell.is-nav-hidden');
  assert.equal(await page.evaluate(()=>window.sidebarDrops.length),1);
  await page.waitForTimeout(700); // Let the completed gesture's synthetic-click suppression retire.
  await page.locator('.fce-toolbar-actions .fce-toolbar-button').last().click();
  await page.locator('.fce-search-input').fill('中文 search');
  await page.evaluate(()=>window.sidebarModel.mutate(s=>{s.bulk={...s.bulk,bulkMode:true}}));
  assert.equal(await page.locator('.fce-header').evaluate(e=>e.scrollWidth<=e.closest('.fce-shell').clientWidth),true);
  await page.setViewportSize({width:900,height:400});
  await page.waitForTimeout(40);
  const bounds=await page.locator('.fce-shell').boundingBox();assert(bounds.y+bounds.height<=401);
  await page.setViewportSize({width:900,height:800});
  assert.deepEqual(errors,[]);
  results.push({device,width,passed:true});
 }
 const output=process.argv[process.argv.indexOf('--output')+1];
 if(process.argv.includes('--output'))await writeFile(output,JSON.stringify({passed:true,cases:results},null,2)+'\n');
 console.log(JSON.stringify({passed:true,cases:results.length}));
}finally{await browser.close();}
