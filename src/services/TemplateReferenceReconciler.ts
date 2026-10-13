import type { PartialPluginSettings, PluginSettings } from "../settings";
import { rewritePathReference } from "../path-references";
import { resolveTemplateName } from "../note-input";
import type { VaultMutationEvent } from "./vault-events";

/** Missing references stay registered; only a vault rename rewrites identity. */
export class TemplateReferenceReconciler {
  constructor(private readonly deps: {
    getSettings: () => PluginSettings;
    saveSettings: (patch: PartialPluginSettings) => Promise<void>;
  }) {}

  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    if (event.eventType !== "rename" || event.oldPath === null) return;
    const settings = this.deps.getSettings();
    const rewrite = (path: string): string => event.isFolder
      ? rewritePathReference(path, event.oldPath as string, event.path)
      : path === event.oldPath ? event.path : path;
    const noteTemplates = settings.noteTemplates.map((template) => ({
      ...template,
      filePath: rewrite(template.filePath),
      ...(rewrite(template.filePath) !== template.filePath ? { name: resolveTemplateName(template) } : {}),
      targetFolderPath: template.targetFolderPath === null || !event.isFolder
        ? template.targetFolderPath : rewrite(template.targetFolderPath),
    }));
    const changed = noteTemplates.some((template, index) => template.filePath !== settings.noteTemplates[index].filePath
      || template.targetFolderPath !== settings.noteTemplates[index].targetFolderPath);
    const folderPath = event.isFolder ? rewrite(settings.quickInput.folderPath) : settings.quickInput.folderPath;
    const templateStorageFolder = event.isFolder ? rewrite(settings.templateStorageFolder) : settings.templateStorageFolder;
    if (!changed && folderPath === settings.quickInput.folderPath && templateStorageFolder === settings.templateStorageFolder) return;
    await this.deps.saveSettings({
      ...(changed ? { noteTemplates } : {}),
      ...(folderPath !== settings.quickInput.folderPath ? { quickInput: { ...settings.quickInput, folderPath } } : {}),
      ...(templateStorageFolder !== settings.templateStorageFolder ? { templateStorageFolder } : {}),
    });
  }
}
