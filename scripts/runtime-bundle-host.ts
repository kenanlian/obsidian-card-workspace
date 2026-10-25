/** Explicit host substitutes for the production bundle admission test. */
export * from "../src/__mocks__/obsidian";
import { TFile, TFolder } from "../src/__mocks__/obsidian";
import { installObsidianDomHelpers } from "../src/__mocks__/obsidian-dom";

export const Platform = { isDesktopApp: false, isMacOS: false, isWin: false };
export const requireApiVersion = () => false;
export const getLanguage = () => "en";
export const notices: string[] = [];
export class Notice { constructor(message: string) { notices.push(message); } }
export class Component {
  private cleanups: Array<() => void> = [];
  load() {}
  register(cleanup: () => void) { this.cleanups.push(cleanup); }
  registerDomEvent(target: EventTarget, event: string, callback: EventListener) { target.addEventListener(event, callback); this.register(() => target.removeEventListener(event, callback)); }
  registerEvent(ref: { stop?: () => void }) { this.register(() => ref.stop?.()); }
  unload() { this.cleanups.splice(0).reverse().forEach(cleanup => cleanup()); }
}
export class View extends Component {}
export class MarkdownView extends View {}
export class ItemView extends View {
  app: unknown; containerEl = document.createElement("div");
  constructor(readonly leaf: { app: unknown }) { super(); this.app = leaf.app; this.containerEl.append(document.createElement("div"), document.createElement("div")); document.body.append(this.containerEl); }
}
export class Plugin extends Component {
  commands: Array<{ id: string; callback: () => void }> = [];
  views = new Map(); tabs: unknown[] = []; writes = 0;
  constructor(readonly app: unknown, readonly manifest: unknown) { super(); }
  registerView(type: string, factory: unknown) { this.views.set(type, factory); }
  addCommand(command: { id: string; callback: () => void }) { this.commands.push(command); }
  addRibbonIcon() { return document.createElement("button"); }
  addSettingTab(tab: unknown) { this.tabs.push(tab); }
  registerHoverLinkSource() {}
  registerEditorExtension() { throw new Error("Editor drop registered without platform support"); }
  async loadData() { return null; }
  async saveData() { this.writes++; }
}
export class PluginSettingTab { containerEl = document.createElement("div"); constructor(_app: unknown, _plugin: unknown) { document.body.append(this.containerEl); } }
class Control {
  inputEl = document.createElement("input"); buttonEl = document.createElement("button");
  constructor(container: HTMLElement) { container.append(this.inputEl, this.buttonEl); }
  setValue(value: unknown) { this.inputEl.value = String(value); return this; }
  setPlaceholder(value: string) { this.inputEl.placeholder = value; return this; }
  setButtonText(value: string) { this.buttonEl.textContent = value; return this; }
  setIcon() { return this; } setTooltip() { return this; } setCta() { return this; } setWarning() { return this; }
  setDisabled() { return this; } setLimits() { return this; } setDynamicTooltip() { return this; }
  addOption() { return this; } addOptions() { return this; } onChange() { return this; } onClick() { return this; }
}
export class ButtonComponent extends Control {}
export class Setting {
  settingEl = document.createElement("div"); controlEl = document.createElement("div");
  constructor(container: HTMLElement) { container.append(this.settingEl); this.settingEl.append(this.controlEl); }
  setName() { return this; } setDesc() { return this; } setHeading() { return this; } setClass() { return this; }
  addDropdown(cb: (control: Control) => void) { cb(new Control(this.controlEl)); return this; }
  addToggle(cb: (control: Control) => void) { return this.addDropdown(cb); }
  addSlider(cb: (control: Control) => void) { return this.addDropdown(cb); }
  addText(cb: (control: Control) => void) { return this.addDropdown(cb); }
  addButton(cb: (control: Control) => void) { return this.addDropdown(cb); }
  addExtraButton(cb: (control: Control) => void) { return this.addDropdown(cb); }
}
export class SettingGroup {
  constructor(readonly container: HTMLElement) {}
  setHeading() { return this; }
  addSetting(cb: (setting: Setting) => void) { cb(new Setting(this.container)); return this; }
}

export function installDom() {
  installObsidianDomHelpers(document);
  Object.assign(Node.prototype, {
    empty() { (this as Node).replaceChildren(); },
    setText(text: string) { (this as Node).textContent = text; },
  });
  Object.assign(HTMLElement.prototype, {
    addClass(...names: string[]) { this.classList.add(...names); }, removeClass(...names: string[]) { this.classList.remove(...names); },
    toggleClass(name: string, enabled: boolean) { this.classList.toggle(name, enabled); },
    getBoundingClientRect() { return { top: 0, left: 0, right: 600, bottom: 640, width: 600, height: 640 }; },
  });
}

export function createApp() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = (name: string, callback: (...args: unknown[]) => void) => {
    let entries = listeners.get(name); if (!entries) listeners.set(name, entries = new Set()); entries.add(callback);
    return { stop: () => entries!.delete(callback) };
  };
  const file = Object.assign(new TFile(), { path: "note.md", basename: "note", extension: "md", name: "note.md", stat: { mtime: 1, ctime: 1, size: 14 } });
  const root = Object.assign(new TFolder(), { path: "", name: "/", children: [file] });
  const leaves: Array<Record<string, any>> = []; let ready = () => {}; let plugin: Plugin;
  const app = {
    vault: { adapter: {}, on, getRoot: () => root, getFiles: () => [file], getMarkdownFiles: () => [file], getName: () => "synthetic-bundle-vault",
      getAbstractFileByPath: (path: string) => path === "" ? root : path === file.path ? file : null,
      cachedRead: async () => "Core browsing preview", readBinary: async () => new ArrayBuffer(0) },
    metadataCache: { on, getFileCache: () => ({}), resolvedLinks: {}, getFirstLinkpathDest: () => null },
    fileManager: {}, workspace: {
      on, onLayoutReady: (callback: () => void) => { ready = callback; }, rootSplit: {},
      getActiveFile: () => null, getLeavesOfType: (type: string) => leaves.filter(leaf => leaf.type === type),
      getActiveViewOfType: () => null, getMostRecentLeaf: () => null, iterateAllLeaves: (callback: (leaf: unknown) => void) => leaves.forEach(callback),
      revealLeaf: async () => {}, setActiveLeaf: () => {}, trigger: () => {},
      getLeftLeaf: () => ({ app, getRoot: () => ({}), async setViewState({ type }: { type: string }) {
        this.type = type; this.view = plugin.views.get(type)(this); leaves.push(this); await this.view.onOpen();
      } }),
    },
  };
  return { app, file, leaves, layoutReady: () => ready(), bind: (value: Plugin) => { plugin = value; } };
}
