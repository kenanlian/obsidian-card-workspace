// Compare two local production builds in fresh, offline macOS Obsidian profiles.
// Run from the worktree root after installing its locked dependencies.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { baseline, calibrate, calibrationSize, compare, matchWork } from "./multi-stream-timing.mjs";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const bundleHashes = {};
const candidate = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
assert.equal(process.platform, "darwin", "The paired fixture requires macOS and Obsidian 1.13.4");
const binary = "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
const offline = '(version 1)(allow default)(deny network-outbound (require-all (remote ip) (require-not (remote ip "localhost:*"))))';
const temp = await mkdtemp(path.join(tmpdir(), "card-stream-pair-"));
const fileCount = 1000;

async function buildLane(lane, revision) {
  const root = path.join(temp, lane);
  await mkdir(root);
  const archive = execFileSync("git", ["archive", revision, "src", "scripts/build-options.mjs", "esbuild.config.mjs",
    "THIRD_PARTY_NOTICES", "package.json", "tsconfig.json", "manifest.json", "styles.css"], { maxBuffer: 32 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", root], { input: archive });
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"), "dir");
  execFileSync(process.execPath, ["esbuild.config.mjs", "--production"], { cwd: root, stdio: "inherit" });
  bundleHashes[lane] = createHash("sha256").update(await readFile(path.join(root, "main.js"))).digest("hex");
  return root;
}

async function setup(root) {
  const vault = path.join(root, "vault"), profile = path.join(root, "profile");
  const notes = path.join(vault, "Notes"), config = path.join(vault, ".obsidian");
  const plugin = path.join(config, "plugins", "card-workspace");
  await Promise.all([mkdir(profile), mkdir(notes, { recursive: true }), mkdir(plugin, { recursive: true })]);
  for (let i = 1; i <= fileCount; i++) {
    const name = 'Note ' + String(i).padStart(4, "0");
    await writeFile(path.join(notes, name + ".md"), 'Preview of ' + name + '.\n\nThree plain text paragraphs.\n\nNo attachments.\n');
  }
  await Promise.all(["main.js", "styles.css", "manifest.json"].map(name => copyFile(path.join(root, name), path.join(plugin, name))));
  // Expose only the runtime version in the test copy, outside the measured render path.
  await writeFile(path.join(plugin, "main.js"), '\n;window.streamBenchVersion = require("obsidian").apiVersion;\n', { flag: "a" });
  const vaultId = "000000000000abcd";
  await writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ updateDisabled: true, vaults: { [vaultId]: { path: vault, ts: Date.now(), open: true } } }));
  await writeFile(path.join(profile, vaultId + ".json"), JSON.stringify({ x: 10, y: 32, width: 1340, height: 800, zoom: 0 }));
  await writeFile(path.join(config, "community-plugins.json"), '["card-workspace"]');
  await writeFile(path.join(config, "core-plugins.json"), '[]');
  return { vault, profile };
}

async function connect(profile, child) {
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("Obsidian exited before its isolated debugger started");
    const info = await readFile(path.join(profile, "DevToolsActivePort"), "utf8").catch(() => "");
    if (info) {
      const [port, endpoint] = info.trim().split("\n");
      return chromium.connectOverCDP('ws://127.0.0.1:' + port + endpoint);
    }
    await delay(150);
  }
  throw new Error("Isolated DevToolsActivePort did not appear");
}

async function openWindow(browser, vault) {
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 30000 });
  await page.waitForFunction(() => window.app?.vault?.adapter?.getBasePath?.());
  assert.equal(await realpath(await page.evaluate(() => app.vault.adapter.getBasePath())), await realpath(vault));
  await page.waitForFunction(() => window.streamBenchVersion || /Trust author and enable plugins|信任作者/.test(document.body.innerText));
  if (!await page.evaluate(() => !!window.streamBenchVersion)) {
    const trust = page.getByRole("button", { name: /Trust author and enable plugins|信任作者/i });
    await trust.click({ timeout: 10000 });
  }
  await page.waitForFunction(() => app.plugins.plugins["card-workspace"] && window.streamBenchVersion);
  assert.equal(await page.evaluate(() => window.streamBenchVersion), "1.13.4");
  await page.bringToFront();
  await page.evaluate(async () => {
    app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    const leaf = app.workspace.getLeaf(false);
    await leaf.setViewState({ type: "folder-card-view", active: true });
    await app.workspace.revealLeaf(leaf); await leaf.loadIfDeferred?.();
    window.streamBenchView = leaf.view;
    await leaf.view.waitForForeground();
    await leaf.view.selectFolderFromNav("Notes");
  });
  await page.waitForFunction(() => app.plugins.plugins["card-workspace"].getSearchSnapshot()?.health?.readiness === "ready", undefined, { timeout: 60000 });
  return page;
}

async function restoreLayout(page, count) {
  await page.evaluate(async count => {
    const view = window.streamBenchView, saved = view.getState();
    const source = saved.streams[0];
    const streams = Array.from({ length: count }, (_, index) => ({
      ...source, id: "bench-" + index, anchor: null, anchorIndex: 0, title: null, desiredExpanded: true,
      browse: { ...source.browse, sort: { field: "name", direction: "asc" } }
    }));
    const leaf = index => ({ kind: "stream", id: streams[index].id });
    const split = (id, axis, first, second) => ({ kind: "split", id, axis, first, second, ratio: 0.5 });
    const row = count > 1 ? split("top", "x", leaf(0), leaf(1)) : leaf(0);
    const layout = count === 4 ? split("rows", "y", row, split("bottom", "x", leaf(2), leaf(3))) : row;
    // Releasing the old leaf also releases its shared preview cache. Every count
    // starts from the same cold resource state in either build and launch order.
    const host = view.leaf;
    await host.setViewState({ type: "empty" });
    await host.setViewState({ type: "folder-card-view", active: true, state: { ...saved, version: 2, streams,
      currentStreamId: streams[0].id, maximizedStreamId: null, layout, navigation: { ...saved.navigation, collapsed: true } } });
    await host.loadIfDeferred?.();
    window.streamBenchView = host.view;
    await host.view.waitForForeground();
  }, count);
  await page.waitForFunction(({ count, files }) => {
    const entries = window.streamBenchView.streamPanelModel.getState().entries;
    return entries.length === count && entries.every(e => !e.pending && e.panelModel?.getState().cards.records.length === files)
      && [...document.querySelectorAll("[data-stream-id] .fce-list")].filter(node => node.clientHeight && node.querySelector(".fce-card")).length === count;
  }, { count, files: fileCount });
}

// This fixture's path suffixes uniquely identify its thousand notes. Runs of
// consecutive ids are lossless, and keep the raw report readable.
function pathSet(paths) {
  const ids = [...new Set(paths)].map(path => {
    const match = /^Notes\/Note (\d{4})\.md$/.exec(path);
    assert.ok(match, "unexpected benchmark path: " + path);
    return Number(match[1]);
  }).sort((a, b) => a - b);
  const ranges = [];
  for (const id of ids) {
    const last = ranges.at(-1);
    if (last && last[1] + 1 === id) last[1] = id;
    else ranges.push([id, id]);
  }
  return { count: ids.length, ranges };
}

// Install these test-only observations in the isolated renderer, once per count.
async function prepareSampling(page) {
  return await page.evaluate(async () => {
    window.streamBenchVisible = list => {
      const rect = list.getBoundingClientRect();
      const paths = [];
      for (const row of list.querySelectorAll(".fce-wall-row-grid")) {
        const box = row.getBoundingClientRect();
        if (box.bottom <= rect.top || box.top >= rect.bottom) continue;
        for (const title of row.querySelectorAll(".fce-card h4")) paths.push("Notes/" + title.textContent + ".md");
      }
      return paths;
    };
    const idle = [];
    let last = await new Promise(requestAnimationFrame);
    for (let i = 0; i < 40; i++) {
      const now = await new Promise(requestAnimationFrame);
      idle.push(now - last);
      last = now;
    }
    return idle.sort((a, b) => a - b)[Math.floor(idle.length / 2)];
  });
}

async function checkpoint(page, position) {
  // Poll between timed segments. Stable row measurements, a drained queue
  // and fully hydrated visible cards are all needed for comparable endpoints.
  const state = await page.evaluate(async target => {
    const view = window.streamBenchView;
    let last, stableSince = 0;
    const deadline = performance.now() + 8000;
    while (performance.now() < deadline) {
      const entries = view.streamPanelModel.getState().entries;
      const snapshots = entries.map(entry => {
        const list = document.querySelector('[data-stream-id="' + entry.id + '"] .fce-list');
        const cards = entry.panelModel.getState().cards;
        const visible = window.streamBenchVisible(list);
        const hydrated = cards.records.filter(c => c.hydrated).map(c => c.path);
        return { id: entry.id, width: list.clientWidth, height: list.clientHeight,
          columns: Number(list.querySelector(".fce-wall-row-grid")?.style.getPropertyValue("--fce-column-count")),
          scrollTop: list.scrollTop, visible, hydrated,
          ready: !entry.pending && !cards.loading && cards.records.length === 1000 && visible.length > 0
            && visible.every(path => hydrated.includes(path)) };
      });
      const preview = view.getRuntimeDiagnostics().preview;
      const foreground = document.visibilityState === "visible" && document.hasFocus();
      if (snapshots[0].scrollTop !== target) {
        document.querySelector('[data-stream-id="bench-0"] .fce-list').scrollTop = target;
      }
      const ready = foreground && !preview.active && !preview.queued && snapshots.every(item => item.ready)
        && snapshots[0].scrollTop === target;
      const signature = JSON.stringify(snapshots.map(s => [s.width, s.height, s.columns, s.scrollTop, s.visible, s.hydrated]));
      if (!ready || signature !== last) stableSince = performance.now();
      last = signature;
      if (ready && performance.now() - stableSince > 240) {
        const streams = view.getState().streams;
        return snapshots.map(s => ({ ...s, anchor: streams.find(stream => stream.id === s.id).anchor }));
      }
      if (performance.now() + 70 >= deadline) throw new Error("Fixture did not settle at " + target + ": " + JSON.stringify({
        foreground, active: preview.active, queued: preview.queued, streams: snapshots.map(s => [s.id, s.scrollTop, s.ready, s.hydrated.length]) }));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("Timed out waiting for settled fixture");
  }, position);
  return state.map(({ ready, hydrated, ...s }) => ({ ...s, hydrated: pathSet(hydrated) }));
}

async function measure(page, startY, slowControl, cadenceMs) {
  const result = await page.evaluate(async ({ startY, slowControl }) => {
    const list = document.querySelector('[data-stream-id="bench-0"] .fce-list');
    const siblings = [...document.querySelectorAll("[data-stream-id] .fce-list")].filter(node => node !== list);
    const otherTops = siblings.map(node => node.scrollTop);
    const visited = new Set(window.streamBenchVisible(list));
    const nextFrame = () => new Promise(requestAnimationFrame);
    let previous = await nextFrame(), blanks = 0, maxCorrection = 0, siblingsMoved = false;
    const intervalsMs = [], inputs = [];
    for (let i = 1; i <= 120; i++) {
      const target = startY + i * 32;
      list.scrollTop = target;
      inputs.push(target);
      if (slowControl && i % 10 === 0) {
        const stop = performance.now() + 36;
        while (performance.now() < stop) { /* inject a main-thread stall in the control alone */ }
      }
      const now = await nextFrame();
      intervalsMs.push(now - previous); previous = now;
      const paths = window.streamBenchVisible(list);
      if (!paths.length) blanks++;
      for (const path of paths) visited.add(path);
      maxCorrection = Math.max(maxCorrection, Math.abs(list.scrollTop - target));
      if (siblings.some((node, index) => node.scrollTop !== otherTops[index])) siblingsMoved = true;
    }
    return { intervalsMs, inputs, visited: [...visited], blanks, siblingsMoved, maxCorrection,
      foreground: document.visibilityState === "visible" && document.hasFocus(), endScroll: list.scrollTop };
  }, { startY, slowControl });
  assert.ok(result.foreground, "scroll sample lost foreground");
  const sorted = [...result.intervalsMs].sort((a, b) => a - b);
  return { ...result, cadenceMs, missedFrames: result.intervalsMs.filter(dt => dt > 1.5 * cadenceMs).length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
}

async function checkRestore(page) {
  const before = await page.evaluate(async () => {
    const view = window.streamBenchView, state = view.getState();
    const saved = state.streams.find(s => s.id === "bench-0");
    await view.setState(state, {});
    return saved.anchor;
  });
  assert.ok(before?.ref?.kind === "card", "scrolled stream must have a reading anchor");
  const restored = await page.waitForFunction(anchor => {
    const state = window.streamBenchView.getState().streams.find(s => s.id === "bench-0");
    const list = document.querySelector('[data-stream-id="bench-0"] .fce-list');
    const title = anchor.ref.path.split("/").pop().replace(/\.md$/, "");
    const mounted = [...(list?.querySelectorAll(".fce-card h4") ?? [])].some(node => node.textContent === title);
    return mounted && list.scrollTop > 0 && state?.anchor?.ref.path === anchor.ref.path && Math.abs(state.anchor.offset - anchor.offset) <= 2;
  }, before, { timeout: 10000 }).then(() => true, error => {
    if (error.name === "TimeoutError") return false;
    throw error;
  });
  const after = await page.evaluate(() => window.streamBenchView.getState().streams.find(s => s.id === "bench-0")?.anchor);
  return { before, after, restored };
}

async function runLane(lane, revision, slowControl = false) {
  const { profile, vault } = await setup(await buildLane(lane, revision));
  // Chromium cannot nest its renderer seatbelt inside this macOS network sandbox.
  const child = spawn("/usr/bin/sandbox-exec", ["-p", offline, binary, "--no-sandbox", "--user-data-dir=" + profile, "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", "--disable-background-networking", "--lang=en-US"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-3000); });
  const exited = once(child, "exit");
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 180000);
  let browser;
  try {
    browser = await connect(profile, child);
    const page = await openWindow(browser, vault);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const durations = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics
      .filter(metric => ["TaskDuration", "ScriptDuration", "LayoutDuration"].includes(metric.name))
      .map(metric => [metric.name, metric.value]));
    const results = [];
    for (const count of [1, 2, 4]) {
      await restoreLayout(page, count);
      const cadenceMs = await prepareSampling(page);
      const rounds = [];
      for (let i = 0; i < 3; i++) {
        const startY = i * 120 * 32;
        const before = await checkpoint(page, startY);
        const start = await durations();
        const { inputs, visited, foreground, ...round } = await measure(page, startY, slowControl, cadenceMs);
        const end = await durations();
        const after = await checkpoint(page, startY + 120 * 32);
        round.width = before[0].width;
        round.height = before[0].height;
        round.columns = before[0].columns;
        round.workload = { count, segment: i + 1, inputs, before, after,
          visited: before.map((s, j) => ({ id: s.id, ...pathSet(j === 0 ? visited : s.visible) })) };
        round.rendererMs = Object.fromEntries(Object.keys(end).map(key => [key, Math.round((end[key] - start[key]) * 1000)]));
        rounds.push(round);
      }
      await delay(350);
      const anchor = await checkRestore(page);
      const result = { lane, count, rounds, anchor };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    return results;
  } catch (error) {
    console.error(lane, stderr);
    throw error;
  } finally {
    clearTimeout(watchdog);
    await browser?.close();
    child.kill("SIGTERM");
    const closed = await Promise.race([exited.then(() => true), delay(2000, false, { ref: false })]);
    if (!closed) { child.kill("SIGKILL"); await exited; }
  }
}

const args = process.argv.slice(2);
const calibrating = args.includes("--calibrate");
const selfCheck = args.includes("--self-check");
const candidateFirst = args.includes("--candidate-first");
const outputIndex = args.indexOf("--output");
const output = outputIndex >= 0 ? args[outputIndex + 1] : null;
const calibrationFile = new URL("../diagnostics/multi-stream-scroll-calibration.json", import.meta.url);
const protocolHash = createHash("sha256")
  .update(await readFile(new URL(import.meta.url)))
  .update(await readFile(new URL("./multi-stream-timing.mjs", import.meta.url))).digest("hex");
const report = { protocolHash, baseline, candidate, bundleHashes, host: "macOS Obsidian 1.13.4", arch: process.arch, runs: [] };

async function record(lane, revision, slowControl = false) {
  const groups = await runLane(lane, revision, slowControl);
  report.runs.push({ lane, revision, groups });
  return groups;
}

function requirePass(verdict) {
  console.log(JSON.stringify({ verdict }));
  assert.ok(verdict.every(group => group.failed.length === 0), "Timing gate failed: " + JSON.stringify(verdict));
}

try {
  if (calibrating) {
    assert.ok(output && !candidateFirst && !selfCheck, "Pass --calibrate --output <path> for a new control experiment");
    const training = [];
    for (let i = 1; i <= calibrationSize; i++) {
      const sample = await record("train-" + i, baseline);
      if (i > 1) matchWork(training[0], sample);
      training.push(sample);
    }
    report.calibration = calibrate(training);
    const holdoutA = await record("holdout-a", baseline);
    const holdoutB = await record("holdout-b", baseline);
    const slow = await record("stall-control", baseline, true);
    assert.equal(new Set(Object.values(bundleHashes)).size, 1, "Control bundles must be byte-identical");
    matchWork(training[0], holdoutA);
    matchWork(training[0], holdoutB);
    report.holdout = compare([holdoutA, holdoutB], report.calibration.limit);
    report.reverseHoldout = compare([holdoutB, holdoutA], report.calibration.limit);
    report.stallControl = compare([holdoutA, slow], report.calibration.limit);
    requirePass(report.holdout);
    requirePass(report.reverseHoldout);
    assert.ok(report.stallControl.every(group => group.failed.includes("p95Ms") && group.failed.includes("candidateFrameBudget")),
      "Injected periodic stalls must trip the frame gates for every stream count");
  } else {
    const control = JSON.parse(await readFile(calibrationFile, "utf8"));
    assert.ok(control.passed && control.protocolHash === protocolHash && control.baseline === baseline
      && control.host === report.host && control.arch === report.arch, "No matching validated control experiment");
    const training = control.runs.slice(0, calibrationSize).map(run => run.groups);
    const { limit } = calibrate(training);
    const test = selfCheck ? baseline : candidate;
    const first = candidateFirst ? await record("candidate", test) : await record("baseline", baseline);
    const second = candidateFirst ? await record("baseline", baseline) : await record("candidate", test);
    const [before, after] = candidateFirst ? [second, first] : [first, second];
    assert.equal(bundleHashes.baseline, control.bundleHashes["train-1"], "Baseline bundle differs from the control");
    if (selfCheck) assert.equal(bundleHashes.baseline, bundleHashes.candidate);
    matchWork(training[0], before);
    report.verdict = compare([before, after], limit);
    requirePass(report.verdict);
  }
  report.passed = true;
  console.log(JSON.stringify({ baseline, candidate, passed: true, files: fileCount, host: report.host }));
} finally {
  try {
    if (output) await writeFile(output, JSON.stringify(report) + "\n");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
