// Compare two local production builds in fresh, offline macOS Obsidian profiles.
// Run from the worktree root after installing its locked dependencies.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

const baseline = "030bc84ef9871587c55917da6e1fc46de7410c8d";
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
    await view.setState({ ...saved, version: 2, streams, currentStreamId: streams[0].id, maximizedStreamId: null,
      layout, navigation: { ...saved.navigation, collapsed: true } }, {});
  }, count);
  await page.waitForFunction(({ count, files }) => {
    const entries = window.streamBenchView.streamPanelModel.getState().entries;
    return entries.length === count && entries.every(e => !e.pending && e.panelModel?.getState().cards.records.length === files)
      && [...document.querySelectorAll("[data-stream-id] .fce-list")].filter(node => node.clientHeight && node.querySelector(".fce-card")).length === count;
  }, { count, files: fileCount });
}

async function measure(page) {
  return page.evaluate(async () => {
    const list = document.querySelector('[data-stream-id="bench-0"] .fce-list');
    const siblings = [...document.querySelectorAll("[data-stream-id] .fce-list")].filter(node => node !== list);
    const otherTops = siblings.map(node => node.scrollTop);
    const nextFrame = () => new Promise(requestAnimationFrame);
    let previous = await nextFrame(), lastTop = list.scrollTop, blanks = 0, maxCorrection = 0;
    const intervals = [];
    for (let i = 0; i < 120; i++) {
      list.scrollTop += 32;
      lastTop = list.scrollTop;
      const now = await nextFrame();
      intervals.push(now - previous); previous = now;
      const rect = list.getBoundingClientRect();
      const visible = [...list.querySelectorAll(".fce-card")].some(card => {
        const box = card.getBoundingClientRect();
        return box.bottom > rect.top && box.top < rect.bottom;
      });
      if (!visible) blanks++;
      maxCorrection = Math.max(maxCorrection, Math.abs(list.scrollTop - lastTop));
    }
    intervals.sort((a, b) => a - b);
    return { p95: Number(intervals[Math.ceil(intervals.length * 0.95) - 1].toFixed(2)), blanks, maxCorrection,
      height: list.clientHeight, width: list.clientWidth, endScroll: list.scrollTop,
      siblingsMoved: siblings.some((node, index) => node.scrollTop !== otherTops[index]) };
  });
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

async function runLane(lane, revision) {
  const { profile, vault } = await setup(await buildLane(lane, revision));
  const child = spawn("/usr/bin/sandbox-exec", ["-p", offline, binary, "--user-data-dir=" + profile, "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0", "--disable-background-networking", "--lang=en-US"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-3000); });
  const exited = once(child, "exit");
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 180000);
  let browser;
  try {
    browser = await connect(profile, child);
    const page = await openWindow(browser, vault);
    const results = [];
    for (const count of [1, 2, 4]) {
      await restoreLayout(page, count);
      await delay(400);
      const rounds = [];
      for (let i = 0; i < 3; i++) rounds.push(await measure(page));
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

try {
  const before = await runLane("baseline", baseline);
  const after = await runLane("candidate", candidate);
  for (const [i, result] of after.entries()) {
    const refs = before[i].rounds;
    assert.ok(result.anchor.restored, "saved reading anchor did not restore: " + JSON.stringify(result.anchor));
    for (const [j, r] of result.rounds.entries()) {
      assert.deepEqual([r.width, r.height], [refs[j].width, refs[j].height], "paired scrollports must have equal dimensions");
      assert.equal(r.blanks, 0, "blank scrollport in candidate");
      assert.equal(r.siblingsMoved, false, "inactive stream moved");
      assert.ok(r.maxCorrection < r.height && r.endScroll > 0, "candidate jumped at least a viewport or failed to scroll");
    }
    assert.ok(Math.min(...result.rounds.map(r => r.p95)) <= Math.max(...refs.map(r => r.p95)) + 0.1,
      "all candidate P95 samples exceed the paired baseline range: " + result.count + " streams");
  }
  console.log(JSON.stringify({ baseline, candidate, passed: true, files: fileCount, host: "macOS Obsidian 1.13.4" }));
} finally { await rm(temp, { recursive: true, force: true }); }
