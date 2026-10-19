import { moment, TFile, TFolder, type App, type Menu } from "obsidian";
import { ensureTemplateStorageFolder } from "../../services/TemplateStorageService";
import { TemplateFieldModal } from "../modals/TemplateFieldModal";
import type { UiStrings } from "../../i18n";
import { DEFAULT_NOTE_TEMPLATE_DATE_FORMAT, DEFAULT_NOTE_TEMPLATE_TIME_FORMAT,
  NOTE_TEMPLATE_DATE_FORMATS, NOTE_TEMPLATE_TIME_FORMATS, normalizeTemplateFolderPath, resolveTemplateName, type NoteTemplateDefinition } from "../../note-input";
import type { PluginSettings, PartialPluginSettings } from "../../settings";
import { addItem, addSubmenuItem } from "../menus/nav-menu-items";
import { NewTemplateModal } from "../modals/NewTemplateModal";
import { TemplateFormatPickerModal } from "../modals/TemplateFormatPickerModal";

export interface TemplateActionsDeps {
  app: App;
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<void>;
  openNote: (path: string, selectTitle?: boolean) => Promise<void>;
  runOperation?: (work: () => Promise<boolean>) => Promise<boolean>;
  notify: (message: string) => void;
  /** Returns a release function; reservations exclude vault-create events before registration commits. */
  reserveTemplatePath: (path: string) => () => void;
  getStrings: () => UiStrings;
}

export class TemplateActions {
  constructor(private readonly deps: TemplateActionsDeps) {}
  private get strings() { return this.deps.getStrings().noteInput; }
  private find(id: string): NoteTemplateDefinition | undefined {
    return this.deps.getSettings().noteTemplates.find((template) => template.id === id);
  }
  private file(template: NoteTemplateDefinition): TFile | null {
    const file = this.deps.app.vault.getAbstractFileByPath(template.filePath);
    return file instanceof TFile && file.extension.toLowerCase() === "md" ? file : null;
  }
  private definition(filePath: string, name: string, targetFolderPath: string): NoteTemplateDefinition {
    const taken = new Set(this.deps.getSettings().noteTemplates.map((template) => template.id));
    let id: string;
    do { id = `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; } while (taken.has(id));
    return { id, name, filePath, targetFolderPath,
      dateFormat: DEFAULT_NOTE_TEMPLATE_DATE_FORMAT, timeFormat: DEFAULT_NOTE_TEMPLATE_TIME_FORMAT, existingNoteInsertPosition: "end" };
  }
  private async register(file: TFile, name: string, targetFolderPath: string): Promise<void> {
    const templates = this.deps.getSettings().noteTemplates;
    const registered = templates.some((template) => template.filePath === file.path);
    // Repeating the same patch lets the host flush a prior failed disk write.
    await this.deps.saveSettings({ noteTemplates: registered ? templates.map((template) => template.filePath === file.path ? { ...template, name, targetFolderPath } : template) : [...templates, this.definition(file.path, name, targetFolderPath)] });
  }
  newTemplate(): void {
    // Keep the created file and reservation across a failed registration retry.
    let created: TFile | null = null;
    let release: (() => void) | null = null;
    let pending = false;
    let closed = false;
    const releaseReservation = () => { release?.(); release = null; };
    const create = async (name: string, rawFolderPath: string): Promise<boolean> => {
      if (pending) return false;
      pending = true;
      const work = async () => {
        const displayName = name.trim();
        if (!displayName) { this.deps.notify(this.strings.invalidTemplateName); return false; }
        const folderPath = normalizeTemplateFolderPath(rawFolderPath);
        const folder = folderPath === "" ? this.deps.app.vault.getRoot()
          : folderPath === null ? null : this.deps.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) { this.deps.notify(this.strings.targetFolderNotFound); return false; }
        if (!created) {
          const storageFolder = await ensureTemplateStorageFolder(this.deps.app, this.deps.getSettings().templateStorageFolder);
          const basename = this.strings.initialTemplateTitle;
          const pathFor = (suffix: string) => `${storageFolder ? `${storageFolder}/` : ""}${basename}${suffix}.md`;
          let path = pathFor("");
          for (let suffix = 1; this.deps.app.vault.getAbstractFileByPath(path); suffix++) path = pathFor(` ${suffix}`);
          release = this.deps.reserveTemplatePath(path);
          try { created = await this.deps.app.vault.create(path, this.strings.initialTemplateBody + "\n"); }
          catch (error) { release(); release = null; throw error; }
        }
        if (this.deps.app.vault.getAbstractFileByPath(created.path) !== created) {
          this.deps.notify(this.strings.templateNotFound); return false;
        }
        await this.register(created, displayName, folderPath!);
        releaseReservation();
        if (!closed) await this.deps.openNote(created.path, true);
        return true;
      };
      try { return await (this.deps.runOperation ? this.deps.runOperation(work) : work()); }
      catch (error) { this.deps.notify(this.strings.saveTemplateFailed(String(error))); return false; }
      finally { pending = false; if (closed) releaseReservation(); }
    };
    new NewTemplateModal(this.deps.app, this.strings, create,
      () => { closed = true; if (!pending) releaseReservation(); }).open();
  }

  private async patch(id: string, patch: Partial<NoteTemplateDefinition>): Promise<boolean> {
    if (!this.find(id)) return false;
    try {
      await this.deps.saveSettings({ noteTemplates: this.deps.getSettings().noteTemplates
        .map((template) => template.id === id ? { ...template, ...patch } : template) });
      return true;
    } catch (error) { this.deps.notify(this.strings.saveTemplateFailed(String(error))); return false; }
  }
  private chooseFolder(id: string): void {
    new TemplateFieldModal(this.deps.app, this.strings, "folder", this.find(id)?.targetFolderPath ?? "", async (value) => {
      const path = normalizeTemplateFolderPath(value);
      const folder = path === "" ? this.deps.app.vault.getRoot() : path === null ? null : this.deps.app.vault.getAbstractFileByPath(path);
      if (!(folder instanceof TFolder)) { this.deps.notify(this.strings.targetFolderNotFound); return false; }
      return this.patch(id, { targetFolderPath: path! });
    }).open();
  }

  appendHeaderMenu(menu: Menu): void {
    addItem(menu, this.strings.newTemplate, "plus", () => this.newTemplate());
  }
  appendMenu(menu: Menu, templateId: string): void {
    const template = this.find(templateId);
    if (!template) return;
    addItem(menu, this.strings.editTemplate, "square-pen", () => {
      const current = this.find(templateId);
      if (!current || !this.file(current)) { this.deps.notify(this.strings.templateNotFound); return; }
      void this.deps.openNote(current.filePath).catch((error) => this.deps.notify(this.strings.createFailed(String(error))));
    }, (item) => item.setDisabled(this.file(template) === null));
    addItem(menu, this.strings.renameTemplate, "pencil", () => {
      const current = this.find(templateId);
      if (!current) return;
      new TemplateFieldModal(this.deps.app, this.strings, "name", resolveTemplateName(current), (name) => {
        if (!name.trim()) { this.deps.notify(this.strings.invalidTemplateName); return Promise.resolve(false); }
        return this.patch(templateId, { name: name.trim() });
      }).open();
    });
    addItem(menu, this.strings.targetFolder, "folder-input", () => this.chooseFolder(templateId));
    const now = (moment as unknown as (date: Date) => { format: (format: string) => string })(new Date());
    const example = (format: string): string => now.format(format);
    const formats = (key: "dateFormat" | "timeFormat", title: string, options: readonly string[]) => {
      const choose = (format: string) => { void this.patch(templateId, { [key]: format }); };
      addSubmenuItem(menu, title, "calendar-clock", (submenu) => {
        for (const format of options) addItem(submenu, `${format} — ${example(format)}`, "", () => choose(format),
          (item) => item.setChecked(template[key] === format));
      }, () => new TemplateFormatPickerModal(this.deps.app, title, options, example, choose).open());
    };
    formats("dateFormat", this.strings.dateFormat, NOTE_TEMPLATE_DATE_FORMATS);
    formats("timeFormat", this.strings.timeFormat, NOTE_TEMPLATE_TIME_FORMATS);
    menu.addSeparator();
    addItem(menu, this.strings.templateInsertPosition, "arrow-down-up", () => {}, (item) => item.setDisabled(true));
    for (const position of ["start", "end"] as const) {
      addItem(menu, position === "start" ? this.strings.insertBodyStart : this.strings.insertEnd,
        position === "start" ? "arrow-up-to-line" : "arrow-down-to-line", () => {
        void this.patch(templateId, { existingNoteInsertPosition: position });
      }, (item) => item.setChecked((template.existingNoteInsertPosition ?? "end") === position));
    }
    menu.addSeparator();
    addItem(menu, this.strings.unregisterTemplate, "list-minus", () => {
      void this.deps.saveSettings({ noteTemplates: this.deps.getSettings().noteTemplates.filter((entry) => entry.id !== templateId) })
        .catch((error) => this.deps.notify(this.strings.saveTemplateFailed(String(error))));
    });
  }
}
