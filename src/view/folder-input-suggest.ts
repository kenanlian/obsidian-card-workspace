import { TFolder, type App } from "obsidian";
import { attachMetadataInputSuggest } from "./metadata-input-suggest";

/** Shared path input for template creation, destination edits and global storage. */
export function attachFolderInputSuggest(app: App, input: HTMLInputElement, onSelect: (path: string) => void) {
  return attachMetadataInputSuggest(app, input, () => {
    const folders = (app.vault.getAllFolders?.() ?? app.vault.getAllLoadedFiles?.() ?? []).filter((entry) => entry instanceof TFolder && entry.path !== "")
      .map((folder) => ({ name: folder.path }));
    return [{ name: "/" }, ...folders];
  }, (name) => onSelect(name === "/" ? "" : name));
}
