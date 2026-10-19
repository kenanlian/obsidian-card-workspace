// Runs only against a generated vault/profile. No existing Obsidian data is used.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";

const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const executable = option("--executable"), output = option("--output"), expectedVersion = option("--version"), asar = option("--asar");
if (!executable || !output || !path.isAbsolute(executable) || !path.isAbsolute(output) || (asar && !path.isAbsolute(asar))) {
  throw new Error("Pass --executable <absolute Obsidian binary> --output <absolute JSON path> [--version <expected version>] [--asar <absolute updated asar>] [--xvfb]");
}
const temporary = await mkdtemp(path.join(tmpdir(), "card-workspace-quick-input-"));
const vault = path.join(temporary, "vault"), profile = path.join(temporary, "profile");
const pluginDirectory = path.join(vault, ".obsidian/plugins/card-workspace");
const report = { schemaVersion: 1, platform: process.platform, phases: [], errors: [], limitations: ["Native OS corner compositing, physical IME, mixed-DPI displays and physical global-shortcut activation require manual acceptance."] };
let processHandle, browser, main;
const phase = (name, detail = {}) => { report.phases.push({ name, ...detail }); console.log(name); };
const windowSnapshot = () => main.evaluate(() => [...quickInputPlugin.quickInputManager.sessions.values()].map((session) => ({
  id: session.id, nativeId: session.window?.handle.id, visible: session.window?.handle.isVisible(), text: session.draft?.editor.getValue(),
  bounds: session.window?.handle.getBounds(), pinned: session.window?.handle.isAlwaysOnTop(),
})));
const draftPage = async (id) => {
  for (const page of browser.contexts()[0].pages()) {
    if (page === main || page.isClosed()) continue;
    if (await page.evaluate((token) => window.name === token, id).catch(() => false)) return page;
  }
  throw new Error(`Missing draft page ${id}`);
};
async function open(source = true) {
  await deadline(main.evaluate((withSource) => quickInputPlugin.openQuickInput(withSource ? window : undefined), source));
  const snapshots = await windowSnapshot();
  return { page: await draftPage(snapshots.at(-1).id), snapshot: snapshots.at(-1) };
}
async function deadline(operation) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Quick input did not finish within 20 seconds")), 20_000);
    })]);
  } finally { clearTimeout(timer); }
}
async function beginDelayedOpen() {
  await main.evaluate(() => {
    const desktop = quickInputPlugin.quickInputDesktop;
    const original = desktop.createWindow;
    window.quickInputDelay = { original, ready: false };
    desktop.createWindow = async function(options) {
      const result = await original.call(this, options);
      quickInputDelay.ready = true;
      await new Promise((resolve) => { quickInputDelay.resume = resolve; });
      return result;
    };
    quickInputDelay.pending = quickInputPlugin.openQuickInput(window);
  });
  await main.waitForFunction(() => quickInputDelay.ready);
}
async function finishDelayedOpen() {
  await deadline(main.evaluate(async () => {
    quickInputPlugin.quickInputDesktop.createWindow = quickInputDelay.original;
    quickInputDelay.resume(); await quickInputDelay.pending;
  }));
}
try {
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(pluginDirectory, { recursive: true }); await mkdir(profile);
  await writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ updateDisabled: true, vaults: { quickInputAcceptance: { path: vault, ts: Date.now(), open: true } } }));
  if (asar) await copyFile(asar, path.join(profile, path.basename(asar)));
  await writeFile(path.join(vault, ".obsidian/community-plugins.json"), '["card-workspace"]');
  await writeFile(path.join(vault, ".obsidian/app.json"), '{"showInlineTitle":false}');
  await writeFile(path.join(vault, "Target.md"), "# Target\nLink destination\n");
  for (const file of ["manifest.json", "styles.css"]) await copyFile(file, path.join(pluginDirectory, file));
  await writeFile(path.join(pluginDirectory, "main.js"), await readFile("main.js", "utf8") + '\n;window.quickInputHostApi = require("obsidian");\n');
  const port = 9600 + Math.floor(Math.random() * 300);
  const launchArgs = [`--user-data-dir=${profile}`, "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`];
  const xvfb = args.includes("--xvfb");
  if (xvfb) report.limitations.push("Xvfb/software rendering without a window manager does not validate desktop stacking or minimize animations.");
  processHandle = spawn(xvfb ? "xvfb-run" : executable, xvfb ? ["-a", executable, ...launchArgs] : launchArgs, { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  processHandle.stdout.on("data", (chunk) => { log = (log + chunk).slice(-12000); });
  processHandle.stderr.on("data", (chunk) => { log = (log + chunk).slice(-12000); });
  for (let i = 0; i < 150; i++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  if (!browser) throw new Error(`Obsidian did not start: ${log}`);
  main = browser.contexts()[0].pages()[0];
  const observeErrors = (page) => page.on("pageerror", (error) => report.errors.push({ message: error.message, stack: error.stack, url: page.url(), phase: report.phases.at(-1)?.name }));
  browser.contexts()[0].on("page", observeErrors);
  observeErrors(main);
  if (args.includes("--trace-errors")) {
    report.exceptions = [];
    report.rawExceptions = [];
    const debuggerSession = await main.context().newCDPSession(main);
    debuggerSession.on("Runtime.exceptionThrown", (event) => report.rawExceptions.push({ phase: report.phases.at(-1)?.name, ...event }));
    await debuggerSession.send("Runtime.enable");
    debuggerSession.on("Debugger.paused", async (event) => {
      report.exceptions.push({ reason: event.reason, data: event.data, frames: event.callFrames.map(({ functionName, url, location }) => ({ functionName, url, location })) });
      await debuggerSession.send("Debugger.resume");
    });
    await debuggerSession.send("Debugger.enable");
    await debuggerSession.send("Debugger.setPauseOnExceptions", { state: "uncaught" });
  }
  main.on("console", (message) => { if (message.type() === "warning" || message.type() === "error") console.log(message.text()); });
  main.setDefaultTimeout(15_000);
  await main.waitForFunction(() => !!window.app?.plugins?.plugins?.["card-workspace"] || document.body.innerText.includes("Trust author and enable plugins"));
  const trust = main.getByText("Trust author and enable plugins", { exact: true });
  if (await trust.isVisible()) await trust.click();
  await main.waitForFunction(() => !!window.app?.plugins?.plugins?.["card-workspace"]);
  report.runtime = await main.evaluate(() => {
    window.quickInputPlugin = app.plugins.plugins["card-workspace"];
    window.quickInputDiagnostics = { created: [], events: [] };
    electron.remote.getCurrentWebContents().on("did-create-window", (native, details) => {
      quickInputDiagnostics.created.push({ id: native.id, name: details.frameName, options: {
        frame: details.options.frame, show: details.options.show, transparent: details.options.transparent,
        thickFrame: details.options.thickFrame, roundedCorners: details.options.roundedCorners, hasShadow: details.options.hasShadow,
      } });
      for (const name of ["show", "hide", "focus", "blur", "closed"]) native.on(name, () => quickInputDiagnostics.events.push({ id: native.id, name }));
    });
    return { obsidian: quickInputHostApi.apiVersion, electron: process.versions.electron, frame: window.titlebarStyle, mainId: electronWindow.id,
      activeWindowClosed: activeWindow.closed, activeDocumentMatches: activeDocument === document,
      existingNativeIds: electron.remote.BrowserWindow.getAllWindows().map((win) => win.id) };
  });
  if (expectedVersion) assert.equal(report.runtime.obsidian, expectedVersion);
  phase("enabled", report.runtime);
  if (args.includes("--trace-errors")) { await main.waitForTimeout(300); phase("idle-before-open"); }

  const first = await open();
  if (args.includes("--trace-errors")) { await main.waitForTimeout(100); phase("first-open"); }
  assert.equal(first.snapshot.visible, true);
  assert.notEqual(first.snapshot.nativeId, report.runtime.mainId);
  assert.deepEqual(await main.evaluate(() => app.workspace.getLeavesOfType("card-workspace-quick-input").length), 0);
  assert.equal(await first.page.locator(".workspace, .app-container, .titlebar").count(), 0);
  await first.page.locator(".cm-content").click();
  if (args.includes("--trace-errors")) { await main.waitForTimeout(100); phase("first-click"); }
  await first.page.keyboard.insertText("# Native Markdown\n中文 [[Target]]");
  if (args.includes("--trace-errors")) { await main.waitForTimeout(100); phase("first-input"); }
  assert.equal((await windowSnapshot())[0].text, "# Native Markdown\n中文 [[Target]]");
  await first.page.keyboard.press("Control+z");
  if (args.includes("--trace-errors")) { await main.waitForTimeout(100); phase("first-undo"); }
  assert.equal((await windowSnapshot())[0].text, "");
  await first.page.keyboard.press("Control+Shift+z");
  assert.equal((await windowSnapshot())[0].text, "# Native Markdown\n中文 [[Target]]");
  phase("native-editor-input-undo-redo");

  // CDP pointer input does not move the OS screen cursor. Supply deterministic
  // DIPs while exercising real pointer capture, native bounds and cursor events.
  const dragBefore = (await windowSnapshot())[0].bounds;
  await main.evaluate(() => {
    const desktop = quickInputPlugin.quickInputDesktop;
    const contents = [...quickInputPlugin.quickInputManager.sessions.values()][0].window.handle.webContents;
    const test = window.quickInputDragTest = { originalCursor: desktop.cursor, point: desktop.cursor(), cursors: [], contents };
    test.listener = (_event, type) => test.cursors.push(type);
    contents.on("cursor-changed", test.listener);
    desktop.cursor = () => test.point;
  });
  const grip = first.page.locator(".fce-quick-input-grip");
  await grip.hover({ position: { x: 100, y: 10 } });
  assert.equal(await grip.evaluate((el) => getComputedStyle(el).getPropertyValue("-webkit-app-region")), "no-drag");
  assert.equal(await grip.evaluate((el) => getComputedStyle(el).cursor), "grab");
  await main.waitForFunction(() => quickInputDragTest.cursors.includes("grab"));
  await first.page.mouse.down();
  assert.equal(await grip.evaluate((el) => el.classList.contains("is-dragging")), true);
  assert.equal(await grip.evaluate((el) => getComputedStyle(el).cursor), "grabbing");
  await main.evaluate(() => { quickInputDragTest.point = { x: quickInputDragTest.point.x + 40, y: quickInputDragTest.point.y + 25 }; });
  await first.page.mouse.move(110, 12);
  await main.waitForFunction(({ x, y }) => {
    const bounds = [...quickInputPlugin.quickInputManager.sessions.values()][0].window.handle.getBounds();
    return bounds.x === x && bounds.y === y;
  }, { x: dragBefore.x + 40, y: dragBefore.y + 25 });
  assert.deepEqual((await windowSnapshot())[0].bounds, { ...dragBefore, x: dragBefore.x + 40, y: dragBefore.y + 25 });
  await main.waitForFunction(() => quickInputDragTest.cursors.includes("grabbing"));
  await first.page.mouse.up();
  assert.equal(await grip.evaluate((el) => el.classList.contains("is-dragging")), false);
  const dragCursors = await main.evaluate(() => {
    quickInputPlugin.quickInputDesktop.cursor = quickInputDragTest.originalCursor;
    quickInputDragTest.contents.removeListener("cursor-changed", quickInputDragTest.listener);
    return quickInputDragTest.cursors;
  });
  phase("grip-native-cursors-and-pointer-drag", { cursors: dragCursors, delta: { x: 40, y: 25 }, cursorSource: "injected screen DIPs" });

  const beforeDelayedOpen = (await windowSnapshot())[0];
  const eventOffset = await main.evaluate(() => quickInputDiagnostics.events.length);
  await beginDelayedOpen();
  assert.equal((await windowSnapshot())[0].visible, true);
  assert.equal((await windowSnapshot())[0].text, "# Native Markdown\n中文 [[Target]]");
  await finishDelayedOpen();
  assert.equal((await windowSnapshot()).length, 2);
  const afterDelayedOpen = (await windowSnapshot())[0];
  assert.deepEqual(afterDelayedOpen, beforeDelayedOpen);
  const eventsDuringOpen = await main.evaluate(({ id, offset }) => quickInputDiagnostics.events.slice(offset).filter((event) => event.id === id),
    { id: first.snapshot.nativeId, offset: eventOffset });
  assert.deepEqual(eventsDuringOpen.filter((event) => ["show", "hide", "focus"].includes(event.name)), []);
  phase("earlier-draft-untouched-during-delayed-open", { eventsDuringOpen });

  await first.page.locator(".fce-quick-input-pin").click();
  assert.equal((await windowSnapshot())[0].pinned, true);
  assert.equal((await windowSnapshot())[1].pinned, false);
  await main.evaluate(() => {
    document.body.classList.remove("theme-dark"); document.body.classList.add("theme-light");
    document.body.style.setProperty("--font-text-override", "monospace");
  });
  await first.page.waitForFunction(() => document.body.classList.contains("theme-light"));
  const appearance = await first.page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.documentElement).backgroundColor,
    radius: getComputedStyle(document.querySelector(".fce-quick-input")).borderRadius,
    frame: document.body.classList.contains("is-frameless"), font: document.body.style.getPropertyValue("--font-text-override"),
  }));
  assert.equal(appearance.body, "rgba(0, 0, 0, 0)"); assert.equal(appearance.root, "rgba(0, 0, 0, 0)");
  assert.equal(appearance.frame, false); assert.equal(appearance.font, "monospace");
  phase("independent-pins-and-incremental-theme", appearance);
  await first.page.screenshot({ path: output.replace(/\.json$/, "") + "-card.png", omitBackground: true });

  await main.evaluate(() => electronWindow.hide());
  const background = await open(false);
  assert.equal(await main.evaluate(() => electronWindow.isVisible()), false);
  assert.equal(background.snapshot.visible, true);
  phase("opens-with-main-window-hidden");
  await main.evaluate(async () => { await quickInputPlugin.quickInputShortcut.apply("Control+Alt+Shift+F9"); });
  assert.equal(await main.evaluate(() => electron.remote.globalShortcut.isRegistered("Control+Alt+Shift+F9")), true);
  phase("global-shortcut-registration");

  await main.evaluate(async () => { await Promise.all(Array.from({ length: 7 }, () => quickInputPlugin.openQuickInput())); });
  const snapshots = await windowSnapshot();
  assert.equal(snapshots.length, 10); assert.equal(new Set(snapshots.map((item) => item.nativeId)).size, 10);
  assert.equal(snapshots.every((item) => item.visible), true);
  phase("ten-independent-drafts", { nativeIds: snapshots.map((item) => item.nativeId) });

  // A native hotkey routed from the child must submit once and close only itself.
  await first.page.bringToFront(); await first.page.locator(".cm-content").click();
  // Sending can close the native target on keydown, before CDP sends keyup.
  // The session/file assertions below still require a successful single write.
  await first.page.keyboard.press("Control+Enter").catch((error) => { if (!first.page.isClosed()) throw error; });
  await main.waitForFunction(() => quickInputPlugin.quickInputManager.sessions.size === 9);
  const saved = await main.evaluate(async () => {
    const files = app.vault.getMarkdownFiles().filter((file) => file.basename.startsWith("quick-note "));
    return Promise.all(files.map(async (file) => ({ path: file.path, text: await app.vault.cachedRead(file) })));
  });
  assert.equal(saved.length, 1); assert.ok(saved[0].text.includes("中文 [[Target]]"));
  phase("native-mod-enter-saves-once", { saved: saved[0].path });

  await main.evaluate(() => [...quickInputPlugin.quickInputManager.sessions.values()][0].window.win.close());
  await main.waitForFunction(() => quickInputPlugin.quickInputManager.sessions.size === 8);
  await beginDelayedOpen();
  await main.evaluate(async () => { await app.plugins.disablePlugin("card-workspace"); });
  await finishDelayedOpen();
  assert.equal(await main.evaluate(() => [...quickInputPlugin.quickInputManager?.sessions?.values() ?? []].length), 0);
  assert.equal(await main.evaluate(() => electron.remote.globalShortcut.isRegistered("Control+Alt+Shift+F9")), false);
  phase("system-close-and-unload-cancel-pending-window");
  report.diagnostics = await main.evaluate(() => quickInputDiagnostics);
  const remainingIds = await main.evaluate(() => electron.remote.BrowserWindow.getAllWindows().map((win) => win.id));
  assert.equal(remainingIds.every((id) => report.runtime.existingNativeIds.includes(id)), true);
  for (const created of report.diagnostics.created) {
    assert.equal(created.options.show, false); assert.equal(created.options.frame, false);
    assert.equal(created.options.transparent, true); assert.equal(created.options.thickFrame, false);
    assert.equal(created.options.roundedCorners, false); assert.equal(created.options.hasShadow, false);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = error.stack ?? String(error); throw error;
} finally {
  if (main && !main.isClosed()) {
    report.remaining = await main.evaluate(() => ({ windows: electron.remote.BrowserWindow.getAllWindows().map((win) => ({ id: win.id, visible: win.isVisible() })) })).catch(() => null);
  }
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2));
  await browser?.close();
  if (processHandle) {
    try { if (process.platform === "win32") processHandle.kill(); else process.kill(-processHandle.pid, "SIGTERM"); } catch {}
  }
  await rm(temporary, { recursive: true, force: true });
}
