import { build } from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { chromium } from "@playwright/test";
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { thumbnailWorkerPlugin } from "./build-options.mjs";
import { createFixtures } from "./image-benchmark/fixtures.mjs";
const args = process.argv.slice(2), option = (key, fallback) => { const index = args.indexOf(key); return index < 0 ? fallback : args[index + 1]; };
const output = option("--output");
if (!output || !path.isAbsolute(output)) throw new Error("Pass --output <absolute report path>");
const baselineCommit = option("--baseline", "60724aceb4cfebffad3e4d26d8f7043271f6749d");
const samples = Number(option("--samples", "30")), warmups = Number(option("--warmups", "5"));
const smoke = args.includes("--smoke");
const project = process.cwd(), temporary = await mkdtemp(path.join(tmpdir(), "card-images-"));
const frozen = path.join(temporary, "baseline"), publicDir = path.join(temporary, "public");
let browser, server, traceSession;
const report = { schemaVersion: 1, baselineCommit, samples, warmups, smoke, environment: { platform: process.platform, node: process.version }, metrics: [], resources: [], violations: [], limitations: ["Synthetic Vault/MetadataCache APIs; native local File.arrayBuffer reads stand in for vault.readBinary. Real Svelte, production hydration/projection/image controllers, Worker decode, IndexedDB and layout.", "Search measures ready-result projection and rendering, not MiniSearch query/build time.", "Obsidian desktop disk IO and Electron decode peaks require the desktop acceptance procedure."] };
const p95 = (values) => [...values].sort((a,b) => a-b)[Math.max(0, Math.ceil(values.length * .95) - 1)];
function imageTaskGate(tasks, label) {
  const byKind = {};
  for (const task of tasks) { const stat = byKind[task.kind] ??= { count: 0, max: 0 }; stat.count++; stat.max = Math.max(stat.max, task.duration); }
  const max = Math.max(0, ...Object.values(byKind).map((stat) => stat.max)), passed = max < 50;
  if (!passed) report.violations.push(`${label}: image task reached ${max.toFixed(2)} ms`);
  return { limit: 50, passed, byKind };
}
try {
  await mkdir(frozen); await mkdir(publicDir);
  execFileSync("bash", ["-c", 'git archive "$1" | tar -x -C "$2"', "image-benchmark", baselineCommit, frozen], { cwd: project });
  await symlink(path.join(project, "node_modules"), path.join(frozen, "node_modules"));
  const stats = await createFixtures(path.join(publicDir, "fixtures")); await writeFile(path.join(publicDir, "stats.json"), JSON.stringify(stats));
  for (const [target, root] of [["baseline", frozen], ["candidate", project]]) {
    const redirect = { name: "benchmark-source", setup(build) {
      build.onResolve({ filter: /\.\.\/\.\.\/src\// }, (args) => {
        // Image modules only exist in the candidate; baseline never activates them.
        // Both lanes use the same Obsidian DOM helpers from the shared host stub.
        const relative = args.path.replace("../../src/", "src/");
        const owner = relative.startsWith("src/images/") || relative.endsWith("CardImageController")
          || relative === "src/__mocks__/obsidian-dom" ? project : root;
        const suffix = args.path.endsWith(".svelte") ? "" : relative === "src/i18n" ? "/index.ts" : ".ts";
        return { path: path.join(owner, relative + suffix) };
      });
      build.onResolve({ filter: /^obsidian$/ }, () => ({ path: path.join(project, "scripts/image-benchmark/obsidian.ts") }));
    } };
    await build({ entryPoints: [path.join(project, "scripts/image-benchmark/browser.ts")], outfile: path.join(publicDir, `${target}.js`),
      bundle: true, format: "iife", platform: "browser", target: "es2020", minify: true, sourcemap: false,
      conditions: ["browser"], define: { BENCHMARK_BASELINE: String(target === "baseline") },
      plugins: [redirect, thumbnailWorkerPlugin({ production: true }), sveltePlugin({ compilerOptions: { dev: false, css: "injected" } })] });
    const css = await readFile(path.join(root, "styles.css"), "utf8");
    await writeFile(path.join(publicDir, `${target}.html`), `<!doctype html><meta charset="utf-8"><style>
      :root { --background-primary:#fff; --background-secondary:#eee; --text-normal:#222; --text-muted:#666; --text-faint:#999; --interactive-accent:#668cee; --font-interface:Arial; --font-text:Arial; --font-monospace:monospace; } body { margin:0; font:14px Arial; } button,input,select { font:inherit; } #mount { display:flex; } .folder-card-view { height:720px; } ${css}
      .folder-card-view { --fce-card-min-width:220px; --fce-wall-gap:12px; }
      </style><input type="file" id="fixtures" multiple hidden><div id="mount" class="folder-card-view"></div><script src="/${target}.js"></script>`);
  }
  server = createServer(async (request, response) => {
    try {
      const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).slice(1);
      const file = path.resolve(publicDir, relative);
      if (!file.startsWith(`${publicDir}/`)) { response.writeHead(400).end(); return; }
      const data = await readFile(file);
      response.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : file.endsWith(".js") ? "text/javascript" : file.endsWith(".json") ? "application/json" : "image/png"); response.end(data);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] }); report.environment.chromium = browser.version();
  if (option("--trace")) {
    traceSession = await browser.newBrowserCDPSession();
    await traceSession.send("Tracing.start", { categories: "devtools.timeline,blink.user_timing,disabled-by-default-v8.gc", transferMode: "ReturnAsStream" });
  }
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const scenarios = option("--scenarios")?.split(",") ?? (smoke ? ["mixed", "repeat", "pixel-over", "byte-over"] : ["none", "mixed", "dense", "8k", "long", "repeat", "pixel-boundary", "pixel-over", "byte-boundary", "byte-over"]);
  const columnsList = option("--columns")?.split(",").map(Number) ?? (smoke ? [1, 4] : [1,2,4]);
  report.scenarios = scenarios; report.columns = columnsList;
  // Interleave baseline and candidate measurements within each fixture/width to reduce environmental drift.
  for (const scenario of scenarios) for (const columns of columnsList) {
    const baselineMetrics = {};
    for (const target of ["baseline", "candidate"]) {
      for (const mode of target === "baseline" ? ["off"] : ["off", "right", "inline"]) {
        // Each mode starts in its own renderer, just as the baseline does.
        // Previous mode scroll/decoder teardown must not contaminate its samples.
        const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await context.newPage();
        const errors = []; page.on("pageerror", (error) => errors.push(String(error)));
        await page.goto(`${baseURL}/${target}.html`); await page.waitForFunction(() => !!window.imageBenchmark);
        await page.locator("#fixtures").setInputFiles(Object.keys(stats).map((name) => path.join(publicDir, "fixtures", name)));
        await page.evaluate(() => window.imageBenchmark.setFixtureFiles([...document.querySelector("#fixtures").files]));
        const values = { cardPublish: [], textReady: [], search: [] }, mainThreadLongTasks = [], originalReadSamples = [], imageTaskSamples = [];
        await page.evaluate((options) => window.imageBenchmark.open(options), { mode, columns, scenario, namespace: `bench-${target}-${scenario}-${columns}-${mode}` });
        for (let i = 0; i < warmups + samples; i++) {
          await page.evaluate(() => window.imageBenchmark.restoreBrowse());
          await page.evaluate(() => window.imageBenchmark.resetCounters());
          const timings = await page.evaluate(async () => {
            const result = await window.imageBenchmark.load();
            result.search = await window.imageBenchmark.search(); await window.imageBenchmark.settleImages(); const diagnostics = window.imageBenchmark.diagnostics(); result.longTasks = diagnostics.longTasks; result.imageTasks = diagnostics.imageTasks; result.originalReads = diagnostics.originalReads; return result;
          });
          if (i >= warmups) { for (const metric of Object.keys(values)) values[metric].push(timings[metric]); mainThreadLongTasks.push(...timings.longTasks); imageTaskSamples.push(...timings.imageTasks); originalReadSamples.push(timings.originalReads); }
        }
        await page.evaluate(() => window.imageBenchmark.settleImages());
        const row = { target, mode, scenario, columns, p95: Object.fromEntries(Object.entries(values).map(([key, list]) => [key, p95(list)])), samples: values, mainThreadLongTasks, originalReadSamples };
        if (target === "baseline") baselineMetrics.off = row.p95;
        else {
          row.gates = Object.fromEntries((mode === "off" ? ["cardPublish", "search"] : ["cardPublish", "textReady"]).map((metric) => {
            const multiplier = mode === "off" ? 1.05 : 1.1, allowance = mode === "off" ? 2 : 5;
            const limit = baselineMetrics.off[metric] * multiplier + allowance;
            const passed = row.p95[metric] <= limit;
            if (!passed) report.violations.push(`${scenario}/${columns}/${mode}: ${metric} ${row.p95[metric].toFixed(2)} > ${limit.toFixed(2)} ms`);
            return [metric, { limit, passed }];
          }));
        }
        if (target === "candidate" && mode !== "off") {
          row.imageTaskGate = imageTaskGate(imageTaskSamples, `${scenario}/${columns}/${mode}`);
        }
        report.metrics.push(row);
        await page.evaluate(() => window.imageBenchmark.resetCounters());
        const scroll = await page.evaluate(() => window.imageBenchmark.scroll());
        await page.evaluate(() => window.imageBenchmark.settleImages());
        const diagnostics = await page.evaluate(() => window.imageBenchmark.diagnostics());
        assert(diagnostics.peakReads <= 1, "Original image concurrency exceeded one");
        if (mode === "off") { assert.equal(diagnostics.originalReads, 0); assert.equal(diagnostics.referenceReads, 0); }
        if (scenario === "byte-over") assert.equal(diagnostics.originalReads, 0);
        if (diagnostics.service) { assert(diagnostics.service.entries <= 64); assert(diagnostics.service.bytes <= 16 * 1024 * 1024); }
        if (target === "candidate" && mode !== "off") diagnostics.imageTaskGate = imageTaskGate(diagnostics.imageTasks, `scroll/${scenario}/${columns}/${mode}`);
        delete diagnostics.imageTasks;
        const layout = mode === "right" && scenario !== "none" ? await page.evaluate(() => window.imageBenchmark.layoutCheck()) : null;
        await page.evaluate(() => window.imageBenchmark.close());
        const closed = await page.evaluate(() => window.imageBenchmark.diagnostics()); assert.equal(closed.heldUrls, 0, "URLs leaked on close");
        report.resources.push({ target, mode, scenario, columns, scroll, diagnostics, layout, afterClose: closed.heldUrls });
        console.log(`${target} ${scenario} ${columns}col ${mode}: publish=${row.p95.cardPublish.toFixed(2)}ms text=${row.p95.textReady.toFixed(2)}ms search=${row.p95.search.toFixed(2)}ms`);
        assert.deepEqual(errors, [], "Browser errors"); await context.close();
      }
    }
  }
  // Sample cold, memory and fresh-service persistent paths separately in Chromium.
  const context = await browser.newContext(); const page = await context.newPage(); await page.goto(`${baseURL}/candidate.html`);
  await page.locator("#fixtures").setInputFiles(Object.keys(stats).map((name) => path.join(publicDir, "fixtures", name)));
  await page.evaluate(() => window.imageBenchmark.setFixtureFiles([...document.querySelector("#fixtures").files]));
  report.formats = await page.evaluate(() => window.imageBenchmark.formatChecks());
  const cacheResults = [];
  for (const columns of scenarios.includes("repeat") ? columnsList : []) {
    for (const cache of ["cold", "memory", "persistent"]) {
      const values = { cardPublish: [], textReady: [] }, readCounts = [], mainThreadLongTasks = [], imageTaskSamples = [];
      const stableNamespace = `cache-${columns}-${cache}`;
      if (cache !== "cold") {
        await page.evaluate((options) => window.imageBenchmark.open(options), { mode: "right", columns, scenario: "repeat", namespace: stableNamespace });
        await page.evaluate(async () => { await window.imageBenchmark.load(); await window.imageBenchmark.settleImages(); });
      }
      for (let i = 0; i < warmups + samples; i++) {
        if (cache !== "memory") {
          await page.evaluate((options) => window.imageBenchmark.open(options), { mode: "right", columns, scenario: "repeat", namespace: cache === "cold" ? `${stableNamespace}-${i}` : stableNamespace });
        }
        await page.evaluate(() => window.imageBenchmark.resetCounters());
        const result = await page.evaluate(async () => { const times = await window.imageBenchmark.load(); await window.imageBenchmark.settleImages(); return { times, diagnostics: window.imageBenchmark.diagnostics() }; });
        assert.equal(result.diagnostics.originalReads, cache === "cold" ? 1 : 0, `${cache} original-read contract`);
        assert.equal(result.diagnostics.peakReads, cache === "cold" ? 1 : 0);
        assert(await page.locator(".fce-card-image img").count() > 0, `${cache} thumbnail not displayed`);
        if (i >= warmups) { for (const metric of Object.keys(values)) values[metric].push(result.times[metric]); readCounts.push(result.diagnostics.originalReads); mainThreadLongTasks.push(...result.diagnostics.longTasks); imageTaskSamples.push(...result.diagnostics.imageTasks); }
      }
      const comparison = report.metrics.find((metric) => metric.target === "baseline" && metric.scenario === "repeat" && metric.columns === columns).p95;
      const row = { columns, cache, p95: Object.fromEntries(Object.entries(values).map(([key, list]) => [key, p95(list)])), samples: values, originalReads: readCounts, mainThreadLongTasks };
      row.gates = Object.fromEntries(Object.keys(values).map((metric) => {
        const limit = comparison[metric] * 1.1 + 5, passed = row.p95[metric] <= limit;
        if (!passed) report.violations.push(`cache/${columns}/${cache}: ${metric} ${row.p95[metric].toFixed(2)} > ${limit.toFixed(2)} ms`);
        return [metric, { limit, passed }];
      }));
      row.imageTaskGate = imageTaskGate(imageTaskSamples, `cache/${columns}/${cache}`);
      cacheResults.push(row); await page.evaluate(() => window.imageBenchmark.close());
      assert.equal((await page.evaluate(() => window.imageBenchmark.diagnostics())).heldUrls, 0);
      console.log(`cache ${columns}col ${cache}: publish=${row.p95.cardPublish.toFixed(2)}ms text=${row.p95.textReady.toFixed(2)}ms`);
    }
  }
  report.cacheResults = cacheResults; await context.close();

} catch (error) { report.violations.push(String(error)); throw error; }
finally {
  if (traceSession) {
    const completed = new Promise((resolve) => traceSession.once("Tracing.tracingComplete", resolve));
    await traceSession.send("Tracing.end");
    const { stream } = await completed;
    let trace = "";
    for (;;) { const chunk = await traceSession.send("IO.read", { handle: stream }); trace += chunk.data; if (chunk.eof) break; }
    await traceSession.send("IO.close", { handle: stream }); await writeFile(option("--trace"), trace);
  }
  await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve));
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  await rm(temporary, { recursive: true, force: true }); console.log(`Diagnostic report: ${output}`);
}
if (report.violations.length) { console.error(report.violations.join("\n")); if (!args.includes("--diagnostic-only")) process.exitCode = 1; }
