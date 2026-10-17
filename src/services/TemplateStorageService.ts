import { TFile, TFolder, type App } from "obsidian";
import { normalizeTemplateFolderPath } from "../note-input";
import type { PartialPluginSettings, PluginSettings } from "../settings";

export interface TemplateStorageDeps {
  app: App;
  getSettings: () => PluginSettings;
  saveSettings: (patch: PartialPluginSettings) => Promise<void>;
  reservePath: (path: string) => () => void;
  flushVaultEvents: () => Promise<void>;
  assertWritable: () => void | Promise<void>;
}

export class TemplateStorageError extends Error {
  constructor(readonly code: "invalid-folder" | "conflict" | "missing-template", readonly path = "") { super(`${code}: ${path}`); }
}

export async function ensureTemplateStorageFolder(app: App, rawPath: string): Promise<string> {
  const path = normalizeTemplateFolderPath(rawPath);
  if (path === null) throw new TemplateStorageError("invalid-folder", rawPath);
  let current = "";
  for (const part of path ? path.split("/") : []) {
    current = current ? `${current}/${part}` : part;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing && !(existing instanceof TFolder)) throw new TemplateStorageError("conflict", current);
    if (!existing) {
      try { await app.vault.createFolder(current); }
      catch (error) { if (!(app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error; }
    }
  }
  return path;
}

/** Plugin-wide serialization prevents creation and folder migration from racing. */
export class TemplateStorageService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly deps: TemplateStorageDeps) {}

  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(async () => { await this.deps.assertWritable(); return work(); });
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  changeFolder(rawPath: string): Promise<void> {
    return this.runExclusive(async () => {
      const folder = normalizeTemplateFolderPath(rawPath);
      if (folder === null) throw new TemplateStorageError("invalid-folder", rawPath);
      const settings = this.deps.getSettings();
      if (folder === settings.templateStorageFolder && settings.noteTemplates.every((template) => template.filePath.slice(0, Math.max(0, template.filePath.lastIndexOf("/"))) === folder)) {
        // Repeating a previously failed disk write must still flush its revision.
        await this.deps.saveSettings({ templateStorageFolder: folder });
        return;
      }
      const destinations = new Set<string>();
      const moves = settings.noteTemplates.map((template) => {
        const file = this.deps.app.vault.getAbstractFileByPath(template.filePath);
        if (!(file instanceof TFile)) throw new TemplateStorageError("missing-template", template.filePath);
        const filename = template.filePath.split("/").pop()!;
        const path = `${folder ? `${folder}/` : ""}${filename}`;
        const occupied = this.deps.app.vault.getAbstractFileByPath(path);
        if (destinations.has(path) || (occupied && occupied !== file)) throw new TemplateStorageError("conflict", path);
        destinations.add(path);
        return { id: template.id, file, original: file.path, path };
      });
      // Inspect all paths before creating folders or moving any file.
      await ensureTemplateStorageFolder(this.deps.app, folder);
      const releases = moves.flatMap((move) => [this.deps.reservePath(move.original), this.deps.reservePath(move.path)]);
      const syncReferences = async (templateStorageFolder: string) => {
        const actualPaths = new Map(moves.map((move) => [move.id, move.file.path]));
        await this.deps.saveSettings({ templateStorageFolder,
          noteTemplates: this.deps.getSettings().noteTemplates.map((template) => ({ ...template, filePath: actualPaths.get(template.id) ?? template.filePath })) });
      };
      try {
        try {
          for (const move of moves) {
            if (move.file.path === move.path) continue;
            // Recheck after awaits; an external writer may have occupied the path.
            if (this.deps.app.vault.getAbstractFileByPath(move.path)) throw new TemplateStorageError("conflict", move.path);
            await this.deps.app.fileManager.renameFile(move.file, move.path);
            // Drain rename reconciliation before moving again or rolling back.
            await this.deps.flushVaultEvents();
          }
        } catch (error) {
          for (let index = moves.length - 1; index >= 0; index--) {
            const move = moves[index];
            if (move.file.path === move.original) continue;
            try {
              if (this.deps.app.vault.getAbstractFileByPath(move.original)) throw new TemplateStorageError("conflict", move.original);
              await this.deps.app.fileManager.renameFile(move.file, move.original);
              await this.deps.flushVaultEvents();
            } catch (rollbackError) { console.warn("[Card Workspace] Template migration rollback failed.", rollbackError); }
          }
          // Even a failed rollback must retain references to the files' real locations.
          await syncReferences(settings.templateStorageFolder);
          throw error;
        }
        // Persistence failure keeps the completed moves and their synchronous memory references.
        await syncReferences(folder);
      } finally { releases.forEach((release) => release()); }
    });
  }
}
