import { ItemView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import FolderCardPanel from "./FolderCardPanel.svelte";
import { buildLightPreview, extractFirstInlineImage, pickFrontmatterImage, resolveImageSource } from "./markdown-utils";
import type { SortDirection, SortField } from "../settings";
import type { NoteCardRecord } from "./types";
import type FolderCardExplorerPlugin from "../main";

export const FOLDER_CARD_VIEW = "folder-card-view";

export class FolderCardView extends ItemView {
  private plugin: FolderCardExplorerPlugin;
  private component: InstanceType<typeof FolderCardPanel> | null = null;
  private hostEl: HTMLElement | null = null;

  private folderPath: string | null = null;
  private cards: NoteCardRecord[] = [];
  private selectedPath: string | null = null;
  private loading = false;

  private generation = 0;
  private pendingHydration = new Set<number>();

  constructor(leaf: WorkspaceLeaf, plugin: FolderCardExplorerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return FOLDER_CARD_VIEW;
  }

  getDisplayText(): string {
    return "Folder Card Explorer";
  }

  getIcon(): string {
    return "gallery-horizontal";
  }

  async onOpen(): Promise<void> {
    const target = (this.containerEl.children[1] as HTMLElement) ?? this.containerEl;
    target.empty();

    this.hostEl = target.createDiv({ cls: "folder-card-view" });
    this.component = new FolderCardPanel({
      target: this.hostEl,
      props: {
        cards: this.cards,
        folderPath: this.folderPath ?? "",
        selectedPath: this.selectedPath,
        loading: this.loading,
        generation: this.generation
      }
    });

    this.component.$on("open-note", (event: any) => {
      this.plugin.openNoteFromCard(event.detail.path);
    });
    this.component.$on("hydrate-range", (event: any) => {
      void this.hydrateRange(event.detail.start, event.detail.end);
    });
  }

  async onClose(): Promise<void> {
    this.component?.$destroy();
    this.component = null;
    this.hostEl = null;
  }

  async setFolder(folder: TFolder): Promise<void> {
    this.folderPath = folder.path;
    this.loading = true;
    this.cards = [];
    this.generation += 1;
    this.pendingHydration.clear();
    this.pushState();

    const buildGeneration = this.generation;
    const settings = this.plugin.getSettings();
    const files = this.collectMarkdownFiles(folder, settings.includeSubfolders);

    const records: NoteCardRecord[] = files.map((file) => {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatterCover = pickFrontmatterImage(cache?.frontmatter as Record<string, unknown> | undefined);

      return {
        file,
        path: file.path,
        title: file.basename,
        ctime: file.stat.ctime,
        mtime: file.stat.mtime,
        cover: frontmatterCover ? resolveImageSource(this.app, frontmatterCover, file) : null,
        excerpt: "",
        previewHtml: "",
        previewMode: "empty",
        hydrated: false
      };
    });

    if (buildGeneration !== this.generation) {
      return;
    }

    records.sort((left, right) =>
      this.compareCards(left, right, settings.sort.field, settings.sort.direction),
    );
    this.cards = records;
    this.loading = false;
    this.pushState();
  }

  setSelectedFile(path: string | null): void {
    this.selectedPath = path;
    this.pushState();
  }

  async refresh(): Promise<void> {
    if (!this.folderPath) {
      return;
    }
    const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
    if (folder instanceof TFolder) {
      await this.setFolder(folder);
    }
  }

  private collectMarkdownFiles(root: TFolder, includeSubfolders: boolean): TFile[] {
    if (!includeSubfolders) {
      const directFiles: TFile[] = [];
      for (const child of root.children) {
        if (child instanceof TFile && child.extension.toLowerCase() === "md") {
          directFiles.push(child);
        }
      }

      return directFiles;
    }

    const result: TFile[] = [];
    const stack: TFolder[] = [root];

    while (stack.length > 0) {
      const folder = stack.pop();
      if (!folder) {
        continue;
      }

      for (const child of folder.children) {
        if (child instanceof TFolder) {
          stack.push(child);
          continue;
        }

        if (child instanceof TFile && child.extension.toLowerCase() === "md") {
          result.push(child);
        }
      }
    }

    return result;
  }

  private compareCards(
    left: NoteCardRecord,
    right: NoteCardRecord,
    field: SortField,
    direction: SortDirection,
  ): number {
    const leftValue = field === "ctime" ? left.ctime : left.mtime;
    const rightValue = field === "ctime" ? right.ctime : right.mtime;
    const difference = leftValue - rightValue;

    if (difference !== 0) {
      return direction === "asc" ? difference : -difference;
    }

    return left.path.localeCompare(right.path);
  }

  private async hydrateRange(start: number, end: number): Promise<void> {
    if (this.cards.length === 0 || this.loading) {
      return;
    }

    const generation = this.generation;
    const targets: number[] = [];
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(this.cards.length, end);

    for (let index = safeStart; index < safeEnd; index += 1) {
      const card = this.cards[index];
      if (!card || card.hydrated || this.pendingHydration.has(index)) {
        continue;
      }
      this.pendingHydration.add(index);
      targets.push(index);
    }

    if (targets.length === 0) {
      return;
    }

    await Promise.all(targets.map((index) => this.hydrateCard(index, generation)));

    targets.forEach((index) => this.pendingHydration.delete(index));
    if (generation === this.generation) {
      this.pushState();
    }
  }

  private async hydrateCard(index: number, generation: number): Promise<void> {
    const card = this.cards[index];
    if (!card) {
      return;
    }

    try {
      const markdown = await this.app.vault.cachedRead(card.file);
      if (generation !== this.generation) {
        return;
      }

      const preview = buildLightPreview(markdown, 200, 4);
      card.previewHtml = preview.html;
      card.previewMode = preview.mode;
      if (!card.cover) {
        const firstInlineImage = extractFirstInlineImage(markdown);
        if (firstInlineImage) {
          card.cover = resolveImageSource(this.app, firstInlineImage, card.file);
        }
      }
      card.hydrated = true;
    } catch {
      card.excerpt = "";
      card.previewHtml = "";
      card.previewMode = "empty";
      card.hydrated = true;
    }
  }

  private pushState(): void {
    this.component?.$set({
      cards: [...this.cards],
      folderPath: this.folderPath ?? "",
      selectedPath: this.selectedPath,
      loading: this.loading,
      generation: this.generation
    });
  }
}
