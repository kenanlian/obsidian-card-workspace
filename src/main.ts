import {
  MarkdownView,
  Plugin,
  TFile,
  TFolder,
  WorkspaceLeaf,
  debounce,
} from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from "./settings";
import { FOLDER_CARD_VIEW, FolderCardView } from "./view/FolderCardView";
import type { PartialPluginSettings, PluginSettings } from "./settings";

export default class FolderCardExplorerPlugin extends Plugin {
  private selectedFolderPath: string | null = null;
  private settings: PluginSettings = normalizeSettings(DEFAULT_SETTINGS);
  private debouncedRefresh = debounce(
    () => {
      void this.refreshFolderCards();
    },
    250,
    false,
  );

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(FOLDER_CARD_VIEW, (leaf) => new FolderCardView(leaf, this));

    this.addCommand({
      id: "open-folder-card-explorer",
      name: "Open Folder Card Explorer view",
      callback: () => {
        void this.activateView();
      },
    });

    this.registerDomEvent(document, "click", (event: MouseEvent) => {
      void this.onFileExplorerClick(event);
    });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        this.syncSelection(file instanceof TFile ? file.path : null);
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.registerVaultObservers();
      const activeFile = this.app.workspace.getActiveFile();
      this.syncSelection(activeFile?.path ?? null);
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(FOLDER_CARD_VIEW);
  }

  async openNoteFromCard(path: string): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) {
      return;
    }

    const leaf = this.resolveTargetLeaf();
    await leaf.openFile(target, { active: true });
    this.syncSelection(target.path);
  }

  getSettings(): PluginSettings {
    return normalizeSettings(this.settings);
  }

  async saveSettings(patch: PartialPluginSettings): Promise<void> {
    this.settings = mergeSettings(this.settings, patch);
    await this.saveData(this.settings);

    this.withFolderViews((view) => {
      void view.refresh();
    });
  }

  private resolveTargetLeaf(): WorkspaceLeaf {
    const activeMarkdown = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeMarkdown) {
      return activeMarkdown.leaf;
    }

    const existingMarkdown = this.app.workspace.getLeavesOfType("markdown");
    if (existingMarkdown.length > 0) {
      return existingMarkdown[0];
    }

    return this.app.workspace.getLeaf(true);
  }

  private async onFileExplorerClick(event: MouseEvent): Promise<void> {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    const folderPath = this.extractFolderPathFromTarget(target);
    if (!folderPath) {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    this.selectedFolderPath = folder.path;
    await this.activateView();
    this.withFolderViews((view) => {
      void view.setFolder(folder);
    });
  }

  private extractFolderPathFromTarget(target: Element): string | null {
    const titleEl = target.closest(".nav-folder-title");
    if (!titleEl) {
      return null;
    }

    return (
      titleEl.getAttribute("data-path") ??
      titleEl.closest(".nav-folder")?.getAttribute("data-path") ??
      null
    );
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    const leaves = workspace.getLeavesOfType(FOLDER_CARD_VIEW);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({
        type: FOLDER_CARD_VIEW,
        active: true,
      });
    }

    if (!leaf) {
      return;
    }
    workspace.revealLeaf(leaf);
  }

  private withFolderViews(callback: (view: FolderCardView) => void): void {
    this.app.workspace.getLeavesOfType(FOLDER_CARD_VIEW).forEach((leaf) => {
      if (leaf.view instanceof FolderCardView) {
        callback(leaf.view);
      }
    });
  }

  private syncSelection(path: string | null): void {
    this.withFolderViews((view) => view.setSelectedFile(path));
  }

  private registerVaultObservers(): void {
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.shouldRefreshForPath(file.path)) {
          this.debouncedRefresh();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.shouldRefreshForPath(file.path)) {
          this.debouncedRefresh();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.shouldRefreshForPath(file.path)) {
          this.debouncedRefresh();
        }
      }),
    );

    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFolder && this.selectedFolderPath === oldPath) {
          this.selectedFolderPath = file.path;
        }

        if (this.shouldRefreshForPath(file.path) || this.shouldRefreshForPath(oldPath)) {
          this.debouncedRefresh();
        }
      }),
    );
  }

  private async loadSettings(): Promise<void> {
    const rawData = await this.loadData();
    this.settings = normalizeSettings(rawData);
  }

  private shouldRefreshForPath(path: string): boolean {
    if (!this.selectedFolderPath) {
      return false;
    }

    return path === this.selectedFolderPath || path.startsWith(`${this.selectedFolderPath}/`);
  }

  private async refreshFolderCards(): Promise<void> {
    if (!this.selectedFolderPath) {
      return;
    }

    const folder = this.app.vault.getAbstractFileByPath(this.selectedFolderPath);
    if (!(folder instanceof TFolder)) {
      return;
    }

    this.withFolderViews((view) => {
      void view.refresh();
    });
  }
}
