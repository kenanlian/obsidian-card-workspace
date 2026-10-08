import { Setting, type App } from "obsidian";
import type { UiStrings } from "../../i18n";
import {
  hiddenPathAncestor, mergeHiddenPathDraft, normalizeHiddenFolderPaths, normalizeHiddenTagPaths,
} from "../../navigation-visibility";
import type { PartialPluginSettings, PluginSettings } from "../../settings";
import { FormModal } from "./FormModal";
import { addEmptyGroupRow, createModalGroup } from "./modal-layout";

export interface NavigationVisibilityModalOptions {
  kind: "folders" | "tags";
  strings: UiStrings;
  collectPaths: () => string[];
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<void>;
  flushSettings: () => Promise<void>;
}

/** One inventory snapshot per opening; draft changes merge into the latest shared settings. */
export class NavigationVisibilityModal extends FormModal {
  private readonly key: "hiddenFolderPaths" | "hiddenTagPaths";
  private readonly initial: string[];
  private readonly available: Set<string>;
  private readonly paths: string[];
  private readonly draft: Set<string>;
  private query = "";
  private listEl: HTMLElement | null = null;
  private errorEl: HTMLElement | null = null;

  constructor(app: App, private readonly options: NavigationVisibilityModalOptions) {
    super(app, { cancel: options.strings.box.cancel, submit: options.strings.box.done, submitting: options.strings.box.done });
    this.addClass("fce-navigation-visibility");
    this.useScrollableLayout();
    this.key = options.kind === "folders" ? "hiddenFolderPaths" : "hiddenTagPaths";
    this.initial = [...options.getSettings()[this.key]];
    this.draft = new Set(this.initial);
    const normalize = options.kind === "folders" ? normalizeHiddenFolderPaths : normalizeHiddenTagPaths;
    this.available = new Set(normalize(options.collectPaths()));
    this.paths = [...new Set([...this.available, ...this.initial])].sort((a, b) => a.localeCompare(b));
  }

  private matchingPaths(): string[] {
    const query = this.query.trim().toLowerCase().replace(/^#/, "");
    return this.paths.filter((path) => path.toLowerCase().includes(query));
  }

  protected renderBody(): void {
    const strings = this.options.strings.navigationVisibility;
    this.setTitle(this.options.kind === "folders" ? strings.manageFolders : strings.manageTags);
    const searchBar = this.contentEl.createDiv({ cls: "fce-navigation-visibility__search" });
    new Setting(searchBar).addSearch((search) => {
      search.inputEl.setAttribute("aria-label", strings.search);
      search.setPlaceholder(strings.search).setValue(this.query).onChange((query) => {
        this.query = query;
        this.renderList();
      });
    });
    this.contentEl.createDiv({ text: strings.description });
    new Setting(this.contentEl).setClass("fce-navigation-visibility__actions")
      .addButton((button) => button.setButtonText(strings.hideMatches).onClick(() => this.editMatches(true)))
      .addButton((button) => button.setButtonText(strings.restoreMatches).onClick(() => this.editMatches(false)))
      .addButton((button) => button.setButtonText(strings.restoreAll).onClick(() => {
        if (this.isSubmitting()) return;
        this.draft.clear(); this.renderList();
      }));
    this.errorEl = this.contentEl.createDiv({ cls: "fce-navigation-visibility__error" });
    this.errorEl.setAttribute("role", "alert");
    this.listEl = this.contentEl.createDiv({ cls: "fce-navigation-visibility__list" });
    this.renderList();
  }

  private editMatches(hidden: boolean): void {
    if (this.isSubmitting()) return;
    // Work from the current snapshot so inherited children cannot be edited individually.
    const editable = this.matchingPaths().filter((path) => !hiddenPathAncestor(path, [...this.draft]));
    for (const path of editable) {
      if (hidden) this.draft.add(path);
      else this.draft.delete(path);
    }
    this.renderList();
  }

  private renderList(): void {
    if (!this.listEl) return;
    this.listEl.empty();
    this.rowControls.clear();
    const strings = this.options.strings.navigationVisibility;
    const group = createModalGroup(this.listEl, { compact: true });
    const paths = this.matchingPaths();
    if (paths.length === 0) addEmptyGroupRow(group, strings.empty);
    for (const path of paths) {
      const parent = hiddenPathAncestor(path, [...this.draft]);
      group.addSetting((setting) => {
        setting.setName(this.options.kind === "tags" ? `#${path}` : path);
        const descriptions = [strings.hidden];
        if (!this.available.has(path)) descriptions.push(strings.missing);
        if (parent) descriptions.push(strings.inherited(parent));
        setting.setDesc(descriptions.join(" · "));
        setting.addToggle((toggle) => {
          toggle.setValue(Boolean(parent) || this.draft.has(path)).setDisabled(Boolean(parent) || this.isSubmitting()).onChange((hidden) => {
            if (this.isSubmitting() || hiddenPathAncestor(path, [...this.draft])) return;
            if (hidden) this.draft.add(path);
            else this.draft.delete(path);
            // Patch existing controls so keyboard focus stays on the edited row.
            this.refreshRows();
          });
          this.rowControls.set(path, { toggle, setting });
        });
      });
    }
  }

  private readonly rowControls = new Map<string, {
    toggle: import("obsidian").ToggleComponent;
    setting: Setting;
  }>();

  private refreshRows(submitting = this.isSubmitting()): void {
    const strings = this.options.strings.navigationVisibility;
    for (const [path, { toggle, setting }] of this.rowControls) {
      const parent = hiddenPathAncestor(path, [...this.draft]);
      toggle.setValue(Boolean(parent) || this.draft.has(path)).setDisabled(Boolean(parent) || submitting);
      const descriptions = [strings.hidden];
      if (!this.available.has(path)) descriptions.push(strings.missing);
      if (parent) descriptions.push(strings.inherited(parent));
      setting.setDesc(descriptions.join(" · "));
    }
  }

  protected async handleSubmit(): Promise<boolean> {
    this.refreshRows(true);
    try {
      const latest = this.options.getSettings()[this.key];
      const merged = mergeHiddenPathDraft(latest, this.initial, this.draft);
      await this.options.saveSettings({ [this.key]: merged });
      // A rejected write still changed memory; retry must flush even a semantic no-op patch.
      await this.options.flushSettings();
      return true;
    } catch (error) {
      console.warn("Card Workspace: navigation visibility submission failed", error);
      this.errorEl?.setText(this.options.strings.navigationVisibility.saveFailed);
      return false;
    } finally {
      this.refreshRows(false);
    }
  }
}
