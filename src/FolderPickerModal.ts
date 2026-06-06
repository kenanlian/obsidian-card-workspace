import { FuzzySuggestModal, TFolder, type App } from "obsidian";

export type { TFolder };

/**
 * Collects all folders in vault starting from root, including the root itself.
 * Returns folders in depth-first order with root first.
 */
export function collectAllVaultFolders(root: TFolder): TFolder[] {
  const result: TFolder[] = [root];

  const collect = (folder: TFolder): void => {
    const subfolders = folder.children
      .filter((child) => isTFolder(child))
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const subfolder of subfolders) {
      result.push(subfolder);
      collect(subfolder);
    }
  };

  collect(root);
  return result;
}

/**
 * Type guard to check if an object is a TFolder.
 */
function isTFolder(obj: unknown): obj is TFolder {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }

  const candidate = obj as Record<string, unknown>;
  return (
    typeof candidate.path === "string" &&
    typeof candidate.name === "string" &&
    Array.isArray(candidate.children)
  );
}

/**
 * A dedicated searchable folder picker modal using fuzzy search.
 * Enumerates all vault folders including root, displays root as "/",
 * and returns the selected TFolder to a callback.
 */
export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private allFolders: TFolder[] = [];

  constructor(
    app: App,
    private onChoose: (folder: TFolder) => void,
    titleText: string = "Select a folder",
  ) {
    super(app);
    this.setTitle(titleText);
    this.allFolders = collectAllVaultFolders(app.vault.getRoot());
  }

  /**
   * Returns all collected folders for filtering/fuzzy search.
   */
  getItems(): TFolder[] {
    return this.allFolders;
  }

  /**
   * Returns the display text for a folder.
   * Displays vault root as "/" and other folders as their full path.
   */
  getItemText(folder: TFolder): string {
    if (folder.path === "") {
      return "/";
    }
    return folder.path;
  }

  /**
   * Invokes the callback with the selected folder.
   */
  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }
}

