// Production projection, component counts and computed empty-parent-tag colors.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { chromium } from "@playwright/test";
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ stdin: { resolveDir: root, loader: "ts", contents: `
import {mount,unmount,tick} from 'svelte';
import NavigationPane from './src/view/NavigationPane.svelte';
import {projectNavigation} from './src/view/navigation-projection';
import {buildTagTree} from './src/view/tag-tree';
let component;
window.renderNavigation=async(mode)=>{
  if(component) await unmount(component);
  const paused=mode==='box'||mode==='links', reverse=mode==='folder-b';
  const projection=projectNavigation({query:'',scope:paused?(mode==='box'?{kind:'box',boxId:'box'}:{kind:'links',notePath:'a.md',direction:'backlinks'}):{kind:'folder',path:mode,includeSubfolders:true},
    activeTags:[],selectedPath:null,favorites:[],folders:[],boxes:[],tags:buildTagTree(['work','personal']),
    tagCounts:{work:reverse?0:1,personal:reverse?1:0},includeSubfolders:true,tagsDisabled:paused,propertiesDisabled:paused,
    sectionCollapsed:{tags:false,properties:false},sectionOrder:['tags','properties'],hiddenNavSections:['favorites','folders','boxes','links','templates'],
    sectionLabels:{tags:{label:'Tags',emptyLabel:null},properties:{label:'Properties',emptyLabel:null}},rootFolderLabel:'Root',
    linksLeafLabels:{backlinks:'Backlinks',outgoing:'Outgoing'},linksDisabled:true,
    expansion:{folders:{manual:[],reveal:[],query:[],suppressed:[]},tags:{manual:[],reveal:[],query:[],suppressed:[]},properties:{manual:['status','absent'],reveal:[],query:[],suppressed:[]},queryCollapsedSections:[]},
    properties:[{key:'status',label:'Status',valuedCount:1,missingCount:0,values:[{ref:{kind:'text',value:'open'},label:'Open',count:reverse?0:1},{ref:{kind:'text',value:'done'},label:'Done',count:reverse?1:0}]},
      {key:'absent',label:'Absent',valuedCount:0,missingCount:1,values:[{ref:{kind:'text',value:'unused'},label:'Unused',count:0}]}]});
  component=mount(NavigationPane,{target:document.querySelector('#mount'),props:{nav:{folderTree:[],favorites:[],boxSummaries:[],paneWidth:300,layoutMode:'dual',visible:true,sectionCollapsed:{},showItemCounts:true,tooltipSide:'right',propertyFilterCount:0,projection,query:'',focusId:null,focusRequest:null,revealRequest:null}}});
  await tick();
};` }, bundle: true, write: false, format: "iife", platform: "browser", conditions: ["browser"],
  alias: { obsidian: path.join(root, "scripts/image-benchmark/obsidian.ts") },
  plugins: [sveltePlugin({ compilerOptions: { dev: false, css: "injected" } })] });
const css = await readFile(path.join(root, "styles.css"), "utf8");
const browser = await chromium.launch({ headless: true });
let passed = 0;
try {
  const page = await browser.newPage();
  await page.setContent(`<style>${css}</style><div class="folder-card-view" id="mount"></div>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const [theme, normal, muted, faint] of [["light", "#222", "#888", "rgb(170, 170, 170)"], ["dark", "#ddd", "#999", "rgb(102, 102, 102)"], ["equal-muted", "#888", "#888", "rgb(170, 170, 170)"]]) {
    await page.evaluate(({normal,muted,faint}) => { document.body.style.setProperty('--text-normal',normal); document.body.style.setProperty('--text-muted',muted); document.body.style.setProperty('--text-faint',faint); }, {normal,muted,faint});
    for (const mode of ["folder-a", "folder-b", "box", "links"]) {
      await page.mouse.move(1200, 650);
      await page.evaluate(mode => window.renderNavigation(mode), mode);
      const rows = await page.locator('.is-tag,.is-property,.is-property-value').evaluateAll(nodes => nodes.map(node => ({
        label: node.querySelector('.fce-tree-label').textContent,
        labelColor: getComputedStyle(node.querySelector('.fce-tree-label')).color,
        iconColor: getComputedStyle(node.querySelector('.fce-tree-item-identity')).color,
        count: node.querySelector('.fce-nav-row-count')?.textContent,
        muted: node.classList.contains('is-muted'),
        rowOpacity: Number(getComputedStyle(node).opacity),
      })));
      assert.equal(rows.length, 7);
      for (const row of rows) {
        const expected = mode === 'box' || mode === 'links' || ['Absent','Unused'].includes(row.label)
          || (mode === 'folder-a' ? ['personal','Done'].includes(row.label) : ['work','Open'].includes(row.label));
        assert.equal(row.muted, expected, `${theme}/${mode}/${row.label}: scope state`);
        if (expected) {
          assert.equal(row.labelColor, faint, `${theme}/${mode}/${row.label}: empty-parent color`);
          assert.equal(row.iconColor, faint, `${theme}/${mode}/${row.label}: icon color`);
        }
        const zeroCount = ['Absent','Unused'].includes(row.label)
          || (mode === 'folder-b' ? ['work','Open'].includes(row.label) : ['personal','Done'].includes(row.label));
        assert.equal(row.count, zeroCount ? '0' : '1', `${theme}/${mode}/${row.label}: visible count`);
        assert.equal(row.rowOpacity, 1, 'Drop target background must stay opaque');
      }
      // Hover exposes action buttons at full strength, independently of content muting.
      await page.locator('.is-property').filter({hasText:'Absent'}).hover();
      assert.equal(await page.locator('.is-property').filter({hasText:'Absent'}).locator('.fce-nav-row-actions').evaluate(node => getComputedStyle(node).opacity), '1');
      passed++;
    }
  }
} finally { await browser.close(); }
console.log(`${passed} navigation muting scenarios passed`);
