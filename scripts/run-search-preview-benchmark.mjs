/** Alternating full-source diagnostics. Never touches a vault or IndexedDB. */
import "./ensure-main-window.mjs";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { freezePreviewBaseline, root, summarize, timingGate } from "./search-preview-baseline.mjs";
import { previewFixtures, extractionFixtures, hundredsSource } from "./search-preview-fixtures.mjs";

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
const gates = [], cases = [], extraction = [], preparation = [], paging = [];
try {
  async function lane(sourceRoot, name) {
    const file = join(frozen.temporary, `${name}.mjs`);
    const stub = join(frozen.temporary, `${name}-obsidian.ts`);
    writeFileSync(stub, `export * from ${JSON.stringify(join(sourceRoot, "src/__mocks__/obsidian.ts"))}; export class TFile {} export const resolveSubpath = () => null; export const getLanguage = () => "en";`);
    const imports = path => JSON.stringify(join(sourceRoot, path));
    const hasPreparation = existsSync(join(sourceRoot, "src/search/search-preview-source.ts"));
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
import * as previewModule from ${imports("src/search/search-preview.ts")};
${hasPreparation ? `import {prepareSearchPreviewSource} from ${imports("src/search/search-preview-source.ts")};` : ""}
import {runSearchTask} from ${imports("src/search/cooperative-task.ts")};
export {prepareSearchableDocument, buildLightPreview};
export async function prepare(source) {
  ${hasPreparation ? `let diagnostics;
  const prepared = await runSearchTask(prepareSearchPreviewSource(source), () => true, value => {diagnostics = value;});
  return {diagnostics, sourceChars: prepared.source.length, bodyChars: prepared.body.length, estimatedBytes: prepared.estimatedBytes, terms: prepared.terms.size};` : "return undefined;"}
}
export async function extract(source, query, limit) {
  let diagnostics;
  const snippets = await extractSearchPreviewSnippets(source, {limit, idPrefix: 'diagnostic', matcher: createSearchPreviewMatcher(query), onDiagnostics: value => {diagnostics = value;}});
  return {snippets, diagnostics};
}
export async function page(source, offset, limit) {
  const extract = Reflect.get(previewModule, 'extractSearchPreview');
  if (typeof extract !== 'function') return undefined;
  let diagnostics;
  const result = await extract(source, {offset, limit, idPrefix: 'diagnostic', matcher: createSearchPreviewMatcher('needle'), onDiagnostics: value => {diagnostics = value;}});
  return {...result, diagnostics};
}
export function setup(fixtures, limit) {
  const documents = fixtures.map(prepareSearchableDocument), byPath = new Map(documents.map(d => [d.path, d]));
  const sourceByPath = new Map(fixtures.map(f => [f.path, f.markdown]));
  const index = new MiniSearch(createMiniSearchOptions()); index.addAll(documents);
  const query = () => {const results = index.search('need', MINISEARCH_SEARCH_OPTIONS); const paths = results.map(r => r.path); return {paths, counts: buildMatchCountsByPath('need', paths, byPath)};};
  return {query, async hydrate() {
    let reads = 0, active = 0, peak = 0;
    const readCounts = new Map(), demanded = new Set(), readLog = [];
    let phase = 'first-screen';
    let committedQuery = 'need', contentRevision = 0;
    const store = createViewStateStore(createFolderScope('', true)), epochs = createViewEpochs();
    const records = documents.map(d => ({...d, file: {path: d.path, stat: {mtime: 2}}, fileKind: 'markdown', previewHtml: '', previewMode: 'empty', hydrated: false, taskSummary: null}));
    store.replaceBaseCards(records); store.replaceVisibleCards(records);
    const context = {store, epochs, getSettings: () => ({...DEFAULT_SETTINGS, searchPreviewSnippetCount: limit}), getUiStrings: () => getUiStrings('en'), getViewWindow: () => globalThis, publishGroups: () => {},
      getApp: () => ({vault: {cachedRead: async file => {reads++; readCounts.set(file.path, (readCounts.get(file.path) ?? 0) + 1); const speculative = !demanded.has(file.path); readLog.push({path: file.path, phase, query: committedQuery, contentRevision, speculative, startedMs: performance.now()}); active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return sourceByPath.get(file.path);}}, metadataCache: {getFileCache: () => null}})};
    const controller = new HydrationController({context, isLoading: () => false, getCommittedQuery: () => committedQuery, getSearchContentRevision: () => contentRevision});
    const request = (start, end) => {const paths = records.slice(start, end).map(c => c.path); for (const path of paths) demanded.add(path); return {generation: epochs.load.value, hydrationRevision: store.getHydrationRevision(), start, end, visibleStart: start, visibleEnd: end, paths};};
    const time = async fn => {const start = performance.now(); await fn(); return performance.now() - start;};
    const firstScreenMs = await time(() => controller.hydrateViewport(request(0, 6)));
    const readsAfterFirstScreen = reads; phase = 'cache-hit';
    const cacheHitMs = await time(() => controller.hydrateViewport(request(0, 6)));
    ${name === 'before' || selfCheck ? 'assert.equal(reads, 6);' : ''}
    assert(records.slice(0, 6).every(card => store.getBaseCard(card.path).searchPreview), 'First screen did not hydrate'); phase = 'scroll';
    const scrollSupplementMs = await time(() => controller.hydrateViewport(request(6, 12)));
    ${name === 'before' || selfCheck ? 'assert.equal(reads, 12);' : ''}
    const readsAfterScroll = reads; assert(records.slice(6, 12).every(card => store.getBaseCard(card.path).searchPreview), 'Scroll screen did not hydrate'); assert(peak <= 5);
    const readsBeforeSwitch = reads; phase = 'query-switch';
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
    // Drain automatic jobs so speculative work remains visible in the report.
    phase = 'drain'; const drainStarted = performance.now();
    const getDiagnostics = () => typeof controller.getDiagnostics === 'function' ? controller.getDiagnostics() : null;
    for (let turn = 0; turn < 2000; turn++) {const d = getDiagnostics(); if (!active && !d?.active && !d?.queued) break; await new Promise(resolve => setTimeout(resolve, 1));}
    const drainMs = performance.now() - drainStarted, diagnostics = getDiagnostics();
    assert.equal(active, 0); if (diagnostics) {assert.equal(diagnostics.active, 0); assert.equal(diagnostics.queued, 0);}
    const readIdentities = readLog.map(read => JSON.stringify([read.path, read.query, read.contentRevision]));
    assert.equal(new Set(readIdentities).size, readIdentities.length, 'A source/query fingerprint was read more than once');
    const prefetchReads = readLog.filter(read => read.speculative).length, prefetchUsed = readLog.filter(read => read.speculative && demanded.has(read.path)).length;
    const demandReads = readLog.filter(read => !read.speculative).length;
    assert.equal(reads, demandReads + prefetchReads);
    controller.dispose(); await new Promise(resolve => setTimeout(resolve, 0));
    return {firstScreenMs, cacheHitMs, scrollSupplementMs, querySwitchMs, querySwitchReads, reads, uniqueReadPaths: readCounts.size, repeatedPathReads: reads - readCounts.size, peak, snippets, readsAfterFirstScreen, readsAfterScroll, demandReads, prefetchReads, prefetchUsed, prefetchUnused: prefetchReads - prefetchUsed, drainMs, diagnostics, readLog};
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
        (measurements[i].scheduler ??= []).push({diagnostics: result.diagnostics, readLog: result.readLog});
      }
    }
    assert.deepEqual(compatible(measurements[1].lastSnippets), compatible(measurements[0].lastSnippets));
    const summary = measurements.map(values => Object.fromEntries(Object.entries(values).filter(([key]) => key !== "lastSnippets" && key !== "scheduler").map(([key, values]) => [key, summarize(values)])));
    for (const metric of ["firstScreenMs", "scrollSupplementMs", "querySwitchMs", "cacheHitMs", "queryMs"]) {
      const small = metric === "cacheHitMs" || metric === "queryMs";
      gates.push(timingGate(`${kind}/${limit}/${metric}`, summary[0][metric], summary[1][metric], small ? 0.05 : 0.1, small ? 0.25 : 5));
    }
    cases.push({kind, limit, before: summary[0], after: summary[1], scheduler: {before: measurements[0].scheduler, after: measurements[1].scheduler}});
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
  for (const [name, source] of extractionFixtures) {
    const measurements = [[], []], diagnostics = [[], []];
    for (let iteration = -warmups; iteration < samples; iteration++) {
      const results = [];
      for (const i of (iteration % 2 ? [1, 0] : [0, 1])) {
        await new Promise(resolve => setTimeout(resolve, 0)); globalThis.gc();
        results[i] = await [before, after][i].prepare(source);
        if (iteration >= 0 && results[i]) {measurements[i].push(results[i].diagnostics.elapsedMs); diagnostics[i].push(results[i].diagnostics);}
      }
      if (results[0] && results[1]) {
        const {diagnostics: _beforeDiagnostics, ...baseline} = results[0];
        const {diagnostics: _afterDiagnostics, ...candidate} = results[1];
        assert.deepEqual(candidate, baseline, 'Preparation dimensions changed: ' + name);
      }
    }
    const summary = measurements.map(values => values.length ? summarize(values) : null);
    preparation.push({name, sourceChars: source.length, before: summary[0], after: summary[1], medianReduction: summary[0] && summary[1] ? 1 - summary[1].median / summary[0].median : null, diagnostics});
    console.log('Measured preparation ' + name);
  }
  if (!selfCheck) for (const offset of [0, 20, 200]) {
    const timings = [], diagnostics = []; let last;
    const prefix = await after.extract(hundredsSource, "needle", offset + 20);
    for (let iteration = -warmups; iteration < samples; iteration++) {
      await new Promise(resolve => setTimeout(resolve, 0)); globalThis.gc();
      last = await after.page(hundredsSource, offset, 20);
      assert(last, "Candidate is missing rich paged extraction");
      assert.equal(last.totalSnippets, 340);
      assert.deepEqual(last.snippets, prefix.snippets.slice(offset, offset + 20));
      if (iteration >= 0) {timings.push(last.diagnostics.elapsedMs); diagnostics.push(last.diagnostics);}
    }
    paging.push({offset, limit: 20, totalSnippets: last.totalSnippets, returnedSnippets: last.snippets.length, timing: summarize(timings), diagnostics});
  }
  const report = {schemaVersion: 3, baselineCommit: frozen.revision, baselineIsolation: "complete src and CSS; shared installed dependencies only", selfCheck, warmups, sampleCount: samples,
    environment: {node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model}, cases, extraction, preparation, paging, gates, passed: gates.every(gate => gate.passed),
    scope: "Node production queue/cache; excludes Obsidian DOM, disk IO and editor opening"};
  mkdirSync(dirname(output), {recursive: true}); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({output, passed: report.passed, failed: gates.filter(gate => !gate.passed)}));
  if ((selfCheck || process.argv.includes("--check")) && !report.passed) process.exitCode = 1;
} finally { frozen.dispose(); }
