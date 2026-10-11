/** Alternating full-source diagnostics. Never touches a vault or IndexedDB. */
import "./ensure-main-window.mjs";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { freezePreviewBaseline, root, summarize, timingGate } from "./search-preview-baseline.mjs";
import { previewFixtures, extractionFixtures } from "./search-preview-fixtures.mjs";

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
if (!arg("--output")) throw new Error("Pass --output <absolute report path>");
const output = resolve(arg("--output"));
// Keep collection of the preceding lane's garbage outside the next timed sample.
if (!globalThis.gc) {
  const run = spawnSync(process.execPath, ["--expose-gc", fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit" });
  if (run.error) throw run.error;
  process.exit(run.status ?? 1);
}
const samples = Number(arg("--samples", 20)), warmups = Number(arg("--warmups", 5));
assert(Number.isInteger(samples) && samples > 0 && Number.isInteger(warmups) && warmups >= 0);
const frozen = freezePreviewBaseline(arg("--baseline"));
const selfCheck = process.argv.includes("--self-check");
const gates = [], cases = [], extraction = [];
try {
  async function lane(sourceRoot, name) {
    const file = join(frozen.temporary, `${name}.mjs`);
    const stub = join(frozen.temporary, `${name}-obsidian.ts`);
    writeFileSync(stub, `export * from ${JSON.stringify(join(sourceRoot, "src/__mocks__/obsidian.ts"))}; export class TFile {} export const resolveSubpath = () => null; export const getLanguage = () => "en";`);
    const imports = path => JSON.stringify(join(sourceRoot, path));
    await build({ stdin: { resolveDir: sourceRoot, loader: "ts", contents: `
import assert from 'node:assert/strict';
import MiniSearch from 'minisearch';
import {HydrationController} from ${imports("src/view/controllers/HydrationController.ts")};
import {createViewStateStore} from ${imports("src/view/view-state-store.ts")};
import {createViewEpochs} from ${imports("src/view/view-epochs.ts")};
import {createFolderScope} from ${imports("src/view/scope.ts")};
import {DEFAULT_SETTINGS} from ${imports("src/settings.ts")};
import {getUiStrings} from ${imports("src/i18n/index.ts")};
import {prepareSearchableDocument} from ${imports("src/search/document-preparation.ts")};
import {buildLightPreview} from ${imports("src/view/markdown-utils.ts")};
import {createMiniSearchOptions, MINISEARCH_SEARCH_OPTIONS} from ${imports("src/search/minisearch-options.ts")};
import {buildMatchCountsByPath} from ${imports("src/search/match-counts.ts")};
import {extractSearchPreviewSnippets, createSearchPreviewMatcher} from ${imports("src/search/search-preview.ts")};
export {prepareSearchableDocument, buildLightPreview};
export async function extract(source, query, limit) {
  let diagnostics;
  const snippets = await extractSearchPreviewSnippets(source, {limit, idPrefix: 'diagnostic', matcher: createSearchPreviewMatcher(query), onDiagnostics: value => {diagnostics = value;}});
  return {snippets, diagnostics};
}
export function setup(fixtures, limit) {
  const documents = fixtures.map(prepareSearchableDocument), byPath = new Map(documents.map(d => [d.path, d]));
  const sourceByPath = new Map(fixtures.map(f => [f.path, f.markdown]));
  const index = new MiniSearch(createMiniSearchOptions()); index.addAll(documents);
  const query = () => {const results = index.search('need', MINISEARCH_SEARCH_OPTIONS); const paths = results.map(r => r.path); return {paths, counts: buildMatchCountsByPath('need', paths, byPath)};};
  return {query, async hydrate() {
    let reads = 0, active = 0, peak = 0;
    let committedQuery = 'need', contentRevision = 0;
    const store = createViewStateStore(createFolderScope('', true)), epochs = createViewEpochs();
    const records = documents.map(d => ({...d, file: {path: d.path, stat: {mtime: 2}}, fileKind: 'markdown', previewHtml: '', previewMode: 'empty', hydrated: false, taskSummary: null}));
    store.replaceBaseCards(records); store.replaceVisibleCards(records);
    const context = {store, epochs, getSettings: () => ({...DEFAULT_SETTINGS, searchPreviewSnippetCount: limit}), getUiStrings: () => getUiStrings('en'), getViewWindow: () => globalThis, publishGroups: () => {},
      getApp: () => ({vault: {cachedRead: async file => {reads++; active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return sourceByPath.get(file.path);}}, metadataCache: {getFileCache: () => null}})};
    const controller = new HydrationController({context, isLoading: () => false, getCommittedQuery: () => committedQuery, getSearchContentRevision: () => contentRevision});
    const request = (start, end) => ({generation: epochs.load.value, hydrationRevision: store.getHydrationRevision(), start, end, paths: records.slice(start, end).map(c => c.path)});
    const time = async fn => {const start = performance.now(); await fn(); return performance.now() - start;};
    const firstScreenMs = await time(() => controller.hydrateViewport(request(0, 6)));
    const cacheHitMs = await time(() => controller.hydrateViewport(request(0, 6)));
    assert.equal(reads, 6);
    const scrollSupplementMs = await time(() => controller.hydrateViewport(request(6, 12)));
    assert.equal(reads, 12); assert(peak <= 5);
    const readsBeforeSwitch = reads;
    const querySwitchMs = await time(async () => {
      for (const nextQuery of ['needle', 'need']) {
        committedQuery = nextQuery; contentRevision++;
        store.advanceHydrationRevision();
        store.patchCardPreviews(records.slice(0, 6).map(card => ({path: card.path, patch: {searchPreview: undefined}})));
        await controller.hydrateViewport(request(0, 6));
      }
    });
    assert.equal(peak <= 5, true);
    const querySwitchReads = reads - readsBeforeSwitch;
    const snippets = store.getBaseCard(records[0].path).searchPreview.snippets;
    controller.dispose(); await new Promise(resolve => setTimeout(resolve, 0));
    return {firstScreenMs, cacheHitMs, scrollSupplementMs, querySwitchMs, querySwitchReads, reads, peak, snippets};
  }};
}` }, outfile: file, bundle: true, format: "esm", platform: "node", target: "node18", logLevel: "warning", alias: {obsidian: stub} });
    return import(pathToFileURL(file).href);
  }
  const before = await lane(frozen.baselineRoot, "before");
  const after = await lane(selfCheck ? frozen.baselineRoot : root, "after");
  const compatible = snippets => snippets.map(({presentation: _presentation, ...original}) => original);
  for (const kind of ["plain", "formatted"]) for (const limit of [2, 5]) {
    const fixtures = previewFixtures(kind);
    for (const fixture of fixtures) {
      assert.deepEqual(after.prepareSearchableDocument(fixture), before.prepareSearchableDocument(fixture));
      assert.deepEqual(after.buildLightPreview(fixture.markdown), before.buildLightPreview(fixture.markdown));
    }
    const lanes = [before.setup(fixtures, limit), after.setup(fixtures, limit)], measurements = [{}, {}];
    assert.deepEqual(lanes[1].query(), lanes[0].query());
    for (let iteration = -warmups; iteration < samples; iteration++) {
      for (const i of (iteration % 2 ? [1, 0] : [0, 1])) {
        await new Promise(resolve => setTimeout(resolve, 0)); globalThis.gc();
        const start = performance.now();
        for (let q = 0; q < 100; q++) lanes[i].query();
        const queryMs = (performance.now() - start) / 100, result = await lanes[i].hydrate();
        if (iteration < 0) continue;
        for (const [metric, value] of Object.entries({...result, queryMs})) if (typeof value === "number") (measurements[i][metric] ??= []).push(value);
        measurements[i].lastSnippets = result.snippets;
      }
    }
    assert.deepEqual(compatible(measurements[1].lastSnippets), compatible(measurements[0].lastSnippets));
    const summary = measurements.map(values => Object.fromEntries(Object.entries(values).filter(([key]) => key !== "lastSnippets").map(([key, values]) => [key, summarize(values)])));
    for (const metric of ["firstScreenMs", "scrollSupplementMs", "querySwitchMs", "cacheHitMs", "queryMs"]) {
      const small = metric === "cacheHitMs" || metric === "queryMs";
      gates.push(timingGate(`${kind}/${limit}/${metric}`, summary[0][metric], summary[1][metric], small ? 0.05 : 0.1, small ? 0.25 : 5));
    }
    cases.push({kind, limit, before: summary[0], after: summary[1]});
    console.log(`Measured ${kind}, ${limit} snippets`);
  }
  for (const [name, source, query] of extractionFixtures) for (const limit of [2, 5]) {
    const measurements = [[], []], diagnostics = [[], []];
    for (let iteration = -warmups; iteration < samples; iteration++) {
      const values = [];
      for (const i of (iteration % 2 ? [1, 0] : [0, 1])) {
        await new Promise(resolve => setTimeout(resolve, 0)); globalThis.gc();
        const result = await [before, after][i].extract(source, query, limit);
        values[i] = result;
        if (iteration >= 0) {measurements[i].push(result.diagnostics.elapsedMs); diagnostics[i].push(result.diagnostics);}
      }
      assert.deepEqual(compatible(values[1].snippets), compatible(values[0].snippets));
    }
    const summary = measurements.map(summarize);
    gates.push(timingGate(`extract/${name}/${limit}`, summary[0], summary[1], 0.1, 5));
    extraction.push({name, limit, sourceChars: source.length, before: summary[0], after: summary[1], diagnostics});
    console.log(`Measured extraction ${name}, ${limit} snippets`);
  }
  const report = {schemaVersion: 2, baselineCommit: frozen.revision, baselineIsolation: "complete src and CSS; shared installed dependencies only", selfCheck, warmups, sampleCount: samples,
    environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model}, cases, extraction, gates, passed: gates.every(gate => gate.passed),
    scope: "Node production queue/cache; excludes Obsidian DOM, disk IO and editor opening"};
  mkdirSync(dirname(output), {recursive: true}); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({output, passed: report.passed, failed: gates.filter(gate => !gate.passed)}));
  if ((selfCheck || process.argv.includes("--check")) && !report.passed) process.exitCode = 1;
} finally { frozen.dispose(); }
