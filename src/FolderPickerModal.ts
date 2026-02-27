import { App, FuzzySuggestModal, TFolder } from "obsidian";

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private folders: TFolder[];
  private onSelect: (folder: TFolder) => void;

  constructor(app: App, onSelect: (folder: TFolder) => void) {
    super(app);
    this.onSelect = onSelect;
    this.folders = this.collectAllFolders();
    this.setPlaceholder("Type to search folders...");
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(folder: TFolder): string {
    return folder.path === "/" ? "/" : folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onSelect(folder);
  }

  private collectAllFolders(): TFolder[] {
    const result: TFolder[] = [];
    const stack: TFolder[] = [this.app.vault.getRoot()];
    while (stack.length > 0) {
      const current = stack.pop()!;
      result.push(current);
      for (const child of current.children) {
        if (child instanceof TFolder) {
          stack.push(child);
        }
      }
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
}
