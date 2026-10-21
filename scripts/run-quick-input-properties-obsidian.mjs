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
const temporary = await mkdtemp(path.join(tmpdir(), "card-workspace-properties-probe-"));
const vault = path.join(temporary, "vault"), profile = path.join(temporary, "profile");
const pluginDirectory = path.join(vault, ".obsidian/plugins/card-workspace");
const report = { schemaVersion: 2, platform: process.platform, phases: [], errors: [], limitations: [
  "Real application checks on Linux/Electron; Windows/macOS, physical IME and mixed-DPI behavior require manual acceptance.",
  "Unsaved draft links have no file context and resolve from the vault root.",
] };
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
try {
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(pluginDirectory, { recursive: true }); await mkdir(profile);
  await writeFile(path.join(profile, "obsidian.json"), JSON.stringify({ updateDisabled: true, vaults: { quickInputAcceptance: { path: vault, ts: Date.now(), open: true } } }));
  if (asar) await copyFile(asar, path.join(profile, path.basename(asar)));
  await writeFile(path.join(vault, ".obsidian/community-plugins.json"), '["card-workspace"]');
  await writeFile(path.join(vault, ".obsidian/app.json"), '{"showInlineTitle":false}');
  await writeFile(path.join(vault, "Target.md"), "# Target\nLink destination\n#alpha-choice\n");
  for (const file of ["manifest.json", "styles.css"]) await copyFile(file, path.join(pluginDirectory, file));
  await writeFile(path.join(pluginDirectory, "main.js"), await readFile("main.js", "utf8") + '\n;window.quickInputHostApi = require("obsidian");window.propertiesCmView = require("@codemirror/view");\n');
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
  main.on("console", (message) => { if (message.type() === "warning" || message.type() === "error") console.log(message.text()); });
  main.setDefaultTimeout(15_000);
  await main.waitForFunction(() => !!window.app?.plugins?.plugins?.["card-workspace"] || document.body.innerText.includes("Trust author and enable plugins"));
  const trust = main.getByText("Trust author and enable plugins", { exact: true });
  if (await trust.isVisible()) await trust.click();
  await main.waitForFunction(() => !!window.app?.plugins?.plugins?.["card-workspace"]);
  report.runtime = await main.evaluate(() => {
    window.quickInputPlugin = app.plugins.plugins["card-workspace"];
    return { obsidian: quickInputHostApi.apiVersion, electron: process.versions.electron, frame: window.titlebarStyle, mainId: electronWindow.id,
      activeWindowClosed: activeWindow.closed, activeDocumentMatches: activeDocument === document,
      existingNativeIds: electron.remote.BrowserWindow.getAllWindows().map((win) => win.id) };
  });
  if (expectedVersion) assert.equal(report.runtime.obsidian, expectedVersion);
  phase("enabled", report.runtime);

  const template = "---\n# Keep this comment\nstatus: 'draft' # Keep status comment\ncount: 3\ndone: false\ndue: 2026-10-20\ntags:\n  - alpha\nrelated:\n  - '[[Target]]'\n---\n# Draft body\nKeep this body unchanged.\n";
  await main.evaluate(async (text) => {
    await app.vault.createFolder("Templates");
    await app.vault.create("Templates/Properties probe.md", text);
    await quickInputPlugin.settingsStore.updateFlat({
      quickInput: { templateId: "properties-probe", folderPath: "", insertPosition: "end" },
      noteTemplates: [{ id: "properties-probe", filePath: "Templates/Properties probe.md", targetFolderPath: "", dateFormat: "YYYY-MM-DD", timeFormat: "HH:mm:ss" }],
    });
    window.propertiesProbe = { bridges: [], writes: [] };
    for (const name of ["create", "modify", "delete", "rename"]) {
      app.vault.on(name, (file) => propertiesProbe.writes.push({ name, path: file.path }));
    }
  }, template);
  const first = await open();
  const mountProperties = async (id) => main.evaluate((id) => {
    const session = [...quickInputPlugin.quickInputManager.sessions.values()].find((entry) => entry.id === id);
    const draft = session.draft;
    draft.editor.focus();
    const nativeOwner = app.workspace.activeEditor;
    const cm = nativeOwner.editor.cm;
    const metadata = draft.root.querySelector(".metadata-container");
    if (!metadata) throw new Error("Production native properties did not mount");
    const bridge = { id, cm, draft, nativeOwner, metadata, doc: draft.root.ownerDocument };
    propertiesProbe.bridges.push(bridge);
    const bounds = session.window.handle.getBounds();
    session.window.handle.setBounds({ ...bounds, width: 560, height: 760 });
    return { hasFile: !!nativeOwner.file,
      adoptedIntoDraft: metadata.ownerDocument === session.window.win.document,
      yamlHidden: !cm.contentDOM.innerText.includes("status: 'draft'"),
      widgets: [...metadata.querySelectorAll(".metadata-property")].map((row) => ({ key: row.dataset.propertyKey,
        type: row.querySelector(".metadata-property-value").dataset.propertyType })),
    };
  }, id);
  report.mount = await mountProperties(first.snapshot.id);
  assert.equal(report.mount.hasFile, false);
  assert.equal(report.mount.adoptedIntoDraft, true);
  assert.equal(report.mount.yamlHidden, true);
  assert.equal(await first.page.locator(".metadata-property").count(), 6);
  phase("native-properties-mounted-with-null-file", report.mount);

  assert.equal(await first.page.getByRole("button", { name: "Edit YAML", exact: true }).count(), 0);
  assert.equal(await first.page.getByRole("button", { name: "Show properties", exact: true }).count(), 0);
  report.headingAlignment = await first.page.locator(".metadata-container").evaluate((panel) => {
    const title = panel.querySelector(".metadata-properties-title");
    const range = panel.ownerDocument.createRange();
    range.selectNodeContents(title);
    const input = panel.querySelector(".metadata-property-key-input");
    return { title: range.getBoundingClientRect().left,
      property: input.getBoundingClientRect().left + parseFloat(getComputedStyle(input).paddingLeft) };
  });
  assert.ok(Math.abs(report.headingAlignment.title - report.headingAlignment.property) < 1, "Properties heading must align with property names");
  phase("properties-heading-aligned-without-yaml-toggle", report.headingAlignment);


  const snapshot = async (id = first.snapshot.id) => main.evaluate((id) => {
    const bridge = propertiesProbe.bridges.find((entry) => entry.id === id);
    const text = bridge.draft.editor.getValue();
    const info = quickInputHostApi.getFrontMatterInfo(text);
    return { text, body: text.slice(info.contentStart), properties: quickInputHostApi.parseYaml(info.frontmatter),
      panel: Object.fromEntries([...bridge.metadata.querySelectorAll(".metadata-property")].map((row) => {
        const key = row.querySelector(".metadata-property-key-input").value;
        const value = row.querySelector(".metadata-property-value");
        const type = value.dataset.propertyType;
        return [key, type === "checkbox" ? value.querySelector("input").checked : type === "number" ? Number(value.querySelector("input").value)
          : value.querySelector("input")?.value ?? value.querySelector("[contenteditable=true]")?.innerText];
      })), writes: propertiesProbe.writes };
  }, id);
  const row = (key) => first.page.locator(`.metadata-property[data-property-key="${key}"]`);
  const expanded = await first.page.locator(".metadata-container").evaluate((el) => el.getBoundingClientRect().height);
  await first.page.locator(".metadata-properties-title").click();
  await first.page.waitForFunction(() => getComputedStyle(document.querySelector(".metadata-content")).display === "none");
  assert.ok(await first.page.locator(".metadata-container").evaluate((el, height) => el.getBoundingClientRect().height < height / 2, expanded));
  await first.page.locator(".metadata-properties-title").click();
  await first.page.waitForFunction((height) => document.querySelector(".metadata-container").getBoundingClientRect().height >= height - 1, expanded);
  phase("native-property-collapse-and-resize");
  const status = row("status").locator("[contenteditable=true]");
  await status.fill("ready");
  await status.press("Enter");
  assert.equal((await snapshot()).properties.status, "ready");
  const count = row("count").locator("input[type=number]");
  await count.fill("7");
  await count.press("Tab");
  assert.equal((await snapshot()).properties.count, 7);
  await row("done").locator("input[type=checkbox]").check();
  assert.equal((await snapshot()).properties.done, true);
  await row("due").locator("input[type=date]").fill("2026-11-01");
  await row("due").locator("input[type=date]").press("Enter");
  assert.equal((await snapshot()).properties.due, "2026-11-01");
  const tags = row("tags").locator(".multi-select-input");
  await tags.fill("al");
  await first.page.waitForFunction(() => [...document.querySelectorAll(".suggestion-item")].some((el) => el.textContent.includes("alpha-choice")), null, { timeout: 5000 });
  report.tagCompletion = await first.page.locator(".suggestion-container").evaluateAll((elements) => elements.filter((el) => el.getBoundingClientRect().height > 0).map((el) => el.textContent));
  await tags.press("Escape");
  await tags.fill("beta");
  await tags.press("Enter");
  assert.deepEqual((await snapshot()).properties.tags, ["alpha", "beta"]);
  const related = row("related").locator(".multi-select-input");
  await related.fill("second");
  await related.press("Enter");
  assert.deepEqual((await snapshot()).properties.related, ["[[Target]]", "second"]);
  assert.equal((await snapshot()).body, "# Draft body\nKeep this body unchanged.\n");
  phase("real-ui-edits-preserve-property-types-and-body");

  // Property transactions must undo independently of the previous field edit.
  await count.fill("19");
  await count.press("Tab");
  await row("count").focus();
  await first.page.keyboard.press("Control+z");
  assert.equal((await snapshot()).properties.count, 7);
  assert.equal((await snapshot()).panel.count, 7);
  await first.page.keyboard.press("Control+Shift+z");
  assert.equal((await snapshot()).properties.count, 19);
  assert.equal((await snapshot()).panel.count, 19);
  phase("property-row-undo-redo-updates-yaml-and-panel");

  assert.ok((await snapshot()).text.includes("# Keep this comment"));
  assert.ok((await snapshot()).text.includes("# Keep status comment"));
  const keyInput = row("status").locator(".metadata-property-key-input");
  await keyInput.fill("state");
  await keyInput.press("Enter");
  assert.equal((await snapshot()).properties.state, "ready");
  assert.equal((await snapshot()).properties.status, undefined);
  await first.page.locator(".metadata-add-button").click();
  const newKey = first.page.locator('.metadata-property[data-property-key=""] .metadata-property-key-input');
  await newKey.fill("extra");
  await newKey.press("Enter");
  const extra = row("extra").locator("[contenteditable=true]");
  await extra.fill("temporary");
  await extra.press("Enter");
  assert.equal((await snapshot()).properties.extra, "temporary");
  await row("extra").focus();
  await first.page.keyboard.press("Delete");
  assert.equal((await snapshot()).properties.extra, undefined);
  phase("rename-add-delete-properties");

  const second = await open();
  await mountProperties(second.snapshot.id);
  assert.equal((await snapshot(second.snapshot.id)).properties.status, "draft");
  assert.equal((await snapshot()).properties.state, "ready");
  assert.deepEqual((await snapshot()).writes, []);
  assert.equal(await main.evaluate(() => app.vault.getAbstractFileByPath("Properties probe.md") === null), true);
  phase("two-independent-drafts-and-no-vault-writes-before-send", { vaultWritesBeforeSend: (await snapshot()).writes.length });

  const screenshotPath = output.replace(/\.json$/, "-preview.png");
  await first.page.screenshot({ path: screenshotPath });
  report.preview = screenshotPath;
  await first.page.bringToFront();
  // Switch directly from the sibling editor to a native property control.
  // Date widgets commit on blur, so Ctrl+Enter must flush before capturing text.
  await row("due").locator("input[type=date]").fill("2026-12-02");
  assert.equal((await snapshot()).properties.due, "2026-11-01");
  report.focus = await main.evaluate(() => ({
    activeDraft: propertiesProbe.bridges.findIndex((bridge) => bridge.nativeOwner === app.workspace.activeEditor),
    owningDocument: activeDocument === propertiesProbe.bridges[0].doc,
  }));
  assert.equal(report.focus.activeDraft, 0);
  assert.equal(report.focus.owningDocument, true);
  const expected = await snapshot();
  // The diagnostic property scope flushes blur-committed values before sending.
  await main.evaluate(() => {
    const manager = quickInputPlugin.quickInputManager;
    const original = manager.options.submit;
    manager.options.submit = async (request) => {
      await new Promise((resolve) => { propertiesProbe.resumeSubmit = resolve; });
      return original(request);
    };
  });
  await first.page.keyboard.press("Control+Enter").catch((error) => { if (!first.page.isClosed()) throw error; });
  await main.waitForFunction(() => !!propertiesProbe.resumeSubmit);
  assert.equal(await first.page.locator(".metadata-container").evaluate((el) => el.inert), true);
  report.pendingEditor = await main.evaluate(() => {
    const cm = propertiesProbe.bridges[0].cm;
    return { readOnly: cm.state.readOnly, editable: cm.state.facet(propertiesCmView.EditorView.editable), contentEditable: cm.contentDOM.getAttribute("contenteditable"),
      dom: cm.contentDOM.outerHTML.slice(0, 180), editorCount: propertiesProbe.bridges[0].draft.root.querySelectorAll(".cm-content").length };
  });
  assert.equal(await first.page.locator(".cm-content").getAttribute("contenteditable"), "false");
  await main.evaluate(() => propertiesProbe.resumeSubmit());
  await main.waitForFunction(() => app.vault.getAbstractFileByPath("Properties probe.md") !== null && quickInputPlugin.quickInputManager.sessions.size === 1);
  report.saved = await main.evaluate(async () => {
    const file = app.vault.getAbstractFileByPath("Properties probe.md");
    return { path: file.path, text: await app.vault.cachedRead(file) };
  });
  assert.equal(report.saved.text, expected.text.replace("due: 2026-11-01", "due: 2026-12-02"));
  assert.equal((await snapshot(second.snapshot.id)).properties.status, "draft");
  phase("send-from-property-input-flushes-pending-edit-and-preserves-sibling");

  // Malformed and nested YAML must fall back to source without changing bytes.
  const originalSecond = (await snapshot(second.snapshot.id)).text;
  for (const text of ["---\nstatus: [\n---\nBody", "---\nstatus:\n  nested: value\n---\nBody"]) {
    await main.evaluate(({ id, text }) => {
      const bridge = propertiesProbe.bridges.find((entry) => entry.id === id);
      bridge.cm.dispatch({ changes: { from: 0, to: bridge.cm.state.doc.length, insert: text } });
    }, { id: second.snapshot.id, text });
    assert.equal(await second.page.locator(".cm-content .metadata-container").count(), 0);
    assert.equal((await windowSnapshot())[0].text, text);
  }
  await main.evaluate(({ id, text }) => {
    const bridge = propertiesProbe.bridges.find((entry) => entry.id === id);
    bridge.cm.dispatch({ changes: { from: 0, to: bridge.cm.state.doc.length, insert: text } });
  }, { id: second.snapshot.id, text: originalSecond });
  assert.equal(await second.page.locator(".cm-content .metadata-container").count(), 1);
  phase("invalid-and-nested-yaml-source-fallback-and-recovery");
  const yamlOnly = "---\nstatus: draft\n---";
  await main.evaluate(({ id, text }) => {
    const bridge = propertiesProbe.bridges.find((entry) => entry.id === id);
    bridge.cm.dispatch({ changes: { from: 0, to: bridge.cm.state.doc.length, insert: text }, selection: { anchor: text.length } });
    bridge.draft.editor.focus();
  }, { id: second.snapshot.id, text: yamlOnly });
  assert.equal((await windowSnapshot())[0].text, yamlOnly);
  await second.page.keyboard.insertText("Body after properties");
  assert.equal((await windowSnapshot())[0].text, `${yamlOnly}\nBody after properties`);
  assert.equal(await second.page.locator(".cm-content .metadata-container").count(), 1);
  phase("yaml-only-template-accepts-first-body-input-without-changing-untouched-draft");
  await main.evaluate(async () => { await app.plugins.disablePlugin("card-workspace"); });
  report.cleanup = await main.evaluate(() => propertiesProbe.bridges.map((bridge) => ({
    closed: bridge.draft.session.closed, panelConnected: bridge.metadata.isConnected, editorConnected: bridge.cm.dom.isConnected,
  })));
  assert.equal(report.cleanup.every((bridge) => bridge.closed && !bridge.panelConnected && !bridge.editorConnected), true);
  const remainingIds = await main.evaluate(() => electron.remote.BrowserWindow.getAllWindows().map((win) => win.id));
  assert.equal(remainingIds.every((id) => report.runtime.existingNativeIds.includes(id)), true);
  assert.deepEqual(report.errors, []);
  phase("unload-releases-native-properties-components");
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
