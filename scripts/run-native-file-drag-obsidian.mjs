// Uses real pointer drags in an isolated generated vault/profile, never a user's vault.
import { chromium, expect } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  executable: { type: "string" }, version: { type: "string" },
  excalidraw: { type: "string" }, output: { type: "string" },
} });
for (const key of ["executable", "excalidraw", "output"]) {
  assert(values[key] && path.isAbsolute(values[key]), `Pass --${key} <absolute path>`);
}
assert(values.version, "Pass --version <expected Obsidian API version>");
const temporary = await mkdtemp(path.join(tmpdir(), "card-native-drag-desktop-"));
const vault = path.join(temporary, "vault"), profile = path.join(temporary, "profile");
const report = { version: values.version, vault, profile, phases: [], errors: [],
  limitations: ["Linux Xvfb/software rendering; pointer drags are browser input, not physical hardware."] };
let child, browser, page;
const phase = (name, detail = {}) => { report.phases.push({ name, ...detail }); console.log(`${values.version}: ${name}`); };

async function openFile(file) {
  await page.evaluate(async (file) => {
    window.dragTargetLeaf ??= app.workspace.getLeaf("tab");
    await dragTargetLeaf.openFile(app.vault.getAbstractFileByPath(file));
  }, file);
}

async function dragTo(selector, modifiers = [], { pointerPage = page, cancel = false } = {}) {
  const source = pointerPage.locator(".fce-card").filter({ has: pointerPage.locator("h4", { hasText: /^A$/ }) });
  const target = pointerPage.locator(selector).last();
  await source.waitFor(); await target.waitFor();
  const from = await source.boundingBox(), to = await target.boundingBox();
  assert(from && to, "Drag source and target must be visible");
  const startsBefore = await page.evaluate(() => window.cardDragStarts ?? 0);
  try {
    await pointerPage.mouse.move(from.x + from.width / 2, from.y + 20);
    await pointerPage.mouse.down();
    await pointerPage.mouse.move(from.x + from.width / 2 + 15, from.y + 35, { steps: 5 });
    for (const key of modifiers) await pointerPage.keyboard.down(key);
    await pointerPage.mouse.move(to.x + to.width * 0.65, to.y + to.height * 0.55, { steps: 15 });
    await pointerPage.mouse.move(to.x + to.width * 0.65 + 2, to.y + to.height * 0.55 + 2);
    if (cancel) await pointerPage.keyboard.press("Escape");
    await pointerPage.mouse.up();
  } finally {
    for (const key of modifiers) await pointerPage.keyboard.up(key);
  }
  await page.waitForFunction(() => app.dragManager.draggable == null);
  assert.equal(await page.evaluate(() => window.cardDragStarts), startsBefore + 1, "Must start a fresh card drag");
  const drag = await page.evaluate(() => window.lastCardDrag);
  assert.equal(drag.path, "notes/A.md");
  assert(drag.types.includes("application/x-card-workspace-note"));
  assert.equal(drag.effectAllowed, "copyLink");
  assert.equal(drag.nativeGhost, true);
  assert.equal(drag.customGhost, false);
  assert.equal(await pointerPage.locator(".drag-ghost, .fce-card-drag-ghost, .fce-card.is-dragging").count(), 0);
  return drag;
}

try {
  const ownDirectory = path.join(vault, ".obsidian/plugins/card-workspace");
  const drawingDirectory = path.join(vault, ".obsidian/plugins/obsidian-excalidraw-plugin");
  await mkdir(ownDirectory, { recursive: true }); await mkdir(drawingDirectory); await mkdir(profile);
  await mkdir(path.join(vault, "notes"));
  await writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ updateDisabled: true,
    vaults: { nativeDrag: { path: vault, ts: Date.now(), open: true } } }));
  await writeFile(path.join(vault, ".obsidian/community-plugins.json"), '["card-workspace","obsidian-excalidraw-plugin"]');
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    await copyFile(file, path.join(ownDirectory, file));
    await copyFile(path.join(values.excalidraw, file), path.join(drawingDirectory, file));
  }
  report.excalidraw = JSON.parse(await readFile(path.join(drawingDirectory, "manifest.json"), "utf8")).version;
  await writeFile(path.join(drawingDirectory, "data.json"), JSON.stringify({ previousRelease: report.excalidraw, showReleaseNotes: false }));
  await writeFile(path.join(ownDirectory, "main.js"), await readFile("main.js", "utf8") + '\n;window.dragHostApi = require("obsidian");\n');
  await writeFile(path.join(vault, "notes/A.md"), "# Heading\n\nDrag source body.\n");
  await writeFile(path.join(vault, "notes/B.md"), "Another card.\n");
  await writeFile(path.join(vault, "Target.md"), "Target\n");
  await writeFile(path.join(vault, "Target.canvas"), '{"nodes":[],"edges":[]}');
  await writeFile(path.join(vault, "Popout.canvas"), '{"nodes":[],"edges":[]}');
  const drawing = { type: "excalidraw", version: 2, source: "https://excalidraw.com", elements: [],
    appState: { viewBackgroundColor: "#ffffff" }, files: {} };
  await writeFile(path.join(vault, "Drawing.excalidraw.md"),
    `---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n\u0060\u0060\u0060json\n${JSON.stringify(drawing)}\n\u0060\u0060\u0060\n%%\n`);
  const port = 9600 + Math.floor(Math.random() * 300);
  child = spawn("xvfb-run", ["-a", values.executable, `--user-data-dir=${profile}`, "--no-sandbox", "--disable-gpu",
    `--remote-debugging-port=${port}`], { detached: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 150; attempt++) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
  assert(browser, "Obsidian failed to start");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.waitForFunction(() => !!window.app?.plugins?.plugins?.["card-workspace"]
    || document.body.innerText.includes("Trust author and enable plugins"));
  const trust = page.getByText("Trust author and enable plugins", { exact: true });
  if (await trust.isVisible()) await trust.click();
  await page.waitForFunction(() => !!window.app?.plugins?.plugins?.["card-workspace"]);
  await page.waitForFunction(() => !!window.app?.plugins?.plugins?.["obsidian-excalidraw-plugin"]);
  await page.keyboard.press("Escape");
  await page.evaluate(() => app.setting.close());
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => dragHostApi.apiVersion), values.version);
  await page.evaluate(async () => {
    window.dragPlugin = app.plugins.plugins["card-workspace"];
    window.dragEditorTrace = [];
    const controller = dragPlugin.editorDropController;
    for (const name of ["handleDomDrop", "handleActiveLeafChange", "handleEditorChange", "cancelPendingDrop"]) {
      const original = controller[name].bind(controller);
      controller[name] = (...args) => {
        const before = !!controller.pendingDrop;
        const result = original(...args);
        dragEditorTrace.push({ name, before, after: !!controller.pendingDrop, result,
          targetPath: controller.pendingDrop?.targetPath });
        return result;
      };
    }
    await dragPlugin.activateAndEnsureScope(true);
    await dragPlugin.saveSettings({ sort: { field: "name", direction: "asc" }, navPaneCollapsed: true });
    window.dragCardView = app.workspace.getLeavesOfType("folder-card-view")[0].view;
    await dragCardView.modules.scopeController.moveScopeToFolder("notes");
    window.recordCardDrag = (event) => {
      if (!event.dataTransfer?.types.includes("application/x-card-workspace-note")) return;
      const sourceDocument = event.target.ownerDocument;
      window.cardDragStarts = (window.cardDragStarts ?? 0) + 1;
      window.lastCardDrag = { path: app.dragManager.draggable?.file?.path, types: [...event.dataTransfer.types],
        effectAllowed: event.dataTransfer.effectAllowed, nativeGhost: !!sourceDocument.querySelector(".drag-ghost"),
        customGhost: !!sourceDocument.querySelector(".fce-card-drag-ghost") };
    };
    document.addEventListener("dragstart", recordCardDrag);
    document.addEventListener("drop", (event) => {
      window.lastCardDrop = { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey,
        target: event.target.className, nativePath: app.dragManager.draggable?.file?.path };
    }, true);
  });
  await page.waitForSelector(".fce-card");
  await page.locator(".modal-container").waitFor({ state: "hidden" });
  phase("enabled", { excalidraw: report.excalidraw });

  await openFile("Target.canvas");
  const drag = await dragTo('.workspace-leaf-content[data-type="canvas"] .canvas-wrapper');
  await page.waitForFunction(() => dragTargetLeaf.view.canvas.nodes.size === 1);
  const node = await page.evaluate(() => [...dragTargetLeaf.view.canvas.nodes.values()][0].getData());
  assert.equal(node.type, "file"); assert.equal(node.file, "notes/A.md");
  phase("canvas-native-file-card", { node, drag });

  await openFile("Target.md");
  await page.evaluate(async () => {
    await dragTargetLeaf.setViewState({ type: "markdown", state: { file: "Target.md", mode: "source" } });
    await dragPlugin.saveSettings({ dragInsertAction: "ask" });
  });
  await page.waitForFunction(() => dragTargetLeaf.view.editor?.getValue() === "Target\n");
  // Let the host finish its deferred editor/focus events before snapshotting a drop.
  await page.waitForTimeout(250);
  await dragTo('.workspace-leaf-content[data-type="markdown"] .cm-content');
  let menuItem;
  // Newer hosts can render menus in a separate window.
  await expect.poll(async () => {
    for (const candidate of browser.contexts()[0].pages()) {
      const item = candidate.locator(".menu-item").filter({ hasText: "Insert wiki link" });
      if (await item.isVisible()) { menuItem = item; return true; }
    }
    return false;
  }, { timeout: 5000 }).toBe(true);
  assert.equal(await page.evaluate(() => dragTargetLeaf.view.editor.getValue()), "Target\n");
  await menuItem.click();
  await page.waitForFunction(() => dragTargetLeaf.view.editor.getValue().includes("[[A]]"));
  assert.equal((await page.evaluate(() => dragTargetLeaf.view.editor.getValue())).match(/\[\[A\]\]/g).length, 1);
  phase("markdown-menu-single-insertion");

  await page.evaluate(async () => { await dragPlugin.saveSettings({ dragInsertAction: "content" }); });
  await dragTo('.workspace-leaf-content[data-type="markdown"] .cm-content');
  await page.waitForFunction(() => dragTargetLeaf.view.editor.getValue().includes("Drag source body."));
  assert.equal((await page.evaluate(() => dragTargetLeaf.view.editor.getValue())).match(/Drag source body\./g).length, 1);
  phase("markdown-default-content-single-insertion");

  await openFile("Drawing.excalidraw.md");
  await page.waitForFunction(() => !!dragTargetLeaf.view.excalidrawAPI);
  await dragTo('.workspace-leaf-content[data-type="excalidraw"] .excalidraw');
  await page.waitForFunction(() => dragTargetLeaf.view.excalidrawAPI.getSceneElements().some((element) =>
    [element.link, element.rawText, element.originalText].some((text) => text?.includes("[[A]]"))));
  phase("excalidraw-native-file-link");

  const embedModifiers = await page.evaluate(() => {
    const rule = app.plugins.plugins["obsidian-excalidraw-plugin"].settings.modifierKeyConfig.Win.InternalDragAction.rules
      .find((rule) => rule.result === "embeddable");
    if (!rule) throw new Error("Excalidraw fixture has no embeddable modifier rule");
    return [rule.shift && "Shift", rule.ctrl_cmd && "Control", rule.alt_opt && "Alt", rule.meta_ctrl && "Meta"].filter(Boolean);
  });
  report.embedModifiers = embedModifiers;
  await dragTo('.workspace-leaf-content[data-type="excalidraw"] .excalidraw', embedModifiers);
  await page.waitForFunction(() => dragTargetLeaf.view.excalidrawAPI.getSceneElements().some((element) => element.type === "embeddable")
    || !!document.querySelector(".modal-container"));
  phase("excalidraw-native-modifier", { modifiers: embedModifiers,
    elements: await page.evaluate(() => dragTargetLeaf.view.excalidrawAPI.getSceneElements().map(({ type }) => type)) });
  await page.keyboard.press("Escape");

  await openFile("Target.canvas");
  await page.evaluate(() => { dragCardView.modules.bulk.toggleBulkMode(); dragCardView.modules.bulk.setSelectedPaths(new Set(["notes/A.md", "notes/B.md"])); });
  await dragTo('.workspace-leaf-content[data-type="canvas"] .canvas-wrapper');
  await page.waitForFunction(() => dragTargetLeaf.view.canvas.nodes.size === 2);
  phase("bulk-mode-still-one-file");
  await dragTo('.workspace-leaf-content[data-type="canvas"] .canvas-wrapper', [], { cancel: true });
  assert.equal(await page.evaluate(() => dragTargetLeaf.view.canvas.nodes.size), 2);
  phase("cancel-cleans-session-without-drop");

  const popupPromise = browser.contexts()[0].waitForEvent("page");
  await page.evaluate(async () => {
    const leaf = await app.workspace.openPopoutLeaf({ width: 1100, height: 800 });
    await leaf.setViewState({ type: "folder-card-view", active: true });
    await leaf.view.modules.scopeController.moveScopeToFolder("notes");
    leaf.view.containerEl.ownerDocument.addEventListener("dragstart", recordCardDrag);
    window.popoutDragTarget = app.workspace.createLeafBySplit(leaf, "vertical");
    await popoutDragTarget.openFile(app.vault.getAbstractFileByPath("Popout.canvas"));
  });
  const popup = await popupPromise;
  await dragTo('.workspace-leaf-content[data-type="canvas"] .canvas-wrapper', [], { pointerPage: popup });
  await page.waitForFunction(() => popoutDragTarget.view.canvas.nodes.size === 1);
  assert.equal(await page.evaluate(() => [...popoutDragTarget.view.canvas.nodes.values()][0].getData().file), "notes/A.md");
  phase("popout-native-file-card");
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.failure = String(error);
  if (page) {
    report.diagnostics = await page.evaluate(() => ({ text: document.body.innerText.slice(-4000),
      drag: window.lastCardDrag, drop: window.lastCardDrop, type: window.dragTargetLeaf?.view.getViewType(),
      editorTrace: window.dragEditorTrace.slice(-20),
      menu: (() => { const dom = dragPlugin.editorDropController.pendingDrop?.menu?.dom;
        return dom ? { text: dom.textContent, connected: dom.isConnected,
          sameDocument: dom.ownerDocument === document, html: dom.outerHTML.slice(0, 2500) } : null; })(),
      elements: window.dragTargetLeaf?.view.excalidrawAPI?.getSceneElements(),
      nativeDrag: app.dragManager.draggable?.type })).catch(() => null);
    await page.screenshot({ path: `${values.output}.png` }).catch(() => undefined);
  }
  throw error;
} finally {
  await browser?.close();
  if (child) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  await mkdir(path.dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2));
}
