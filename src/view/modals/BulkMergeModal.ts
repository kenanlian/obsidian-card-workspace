import { Notice, Setting, TFile, TFolder, type App } from "obsidian";
import { FolderPickerModal } from "../../FolderPickerModal";
import type { UiStrings } from "../../i18n";
import { buildMergedNoteContent } from "../note-ops";
import { FormModal } from "./FormModal";

export type MergeCleanupMode = "keep" | "trash";

export interface MergeModalSubmitResult {
  files: TFile[];
  targetFolder: TFolder;
  mergedTitle: string;
  separator: string;
  cleanupMode: MergeCleanupMode;
}

export interface BulkMergeModalOptions {
  files: TFile[];
  initialTargetFolder: TFolder;
  initialMergedTitle: string;
  strings: UiStrings["view"]["merge"];
  folderPickerTitle: string;
}

export class BulkMergeModal extends FormModal {
  private readonly strings: UiStrings["view"]["merge"];
  private readonly folderPickerTitle: string;
  private readonly onSubmit: (result: MergeModalSubmitResult) => Promise<boolean>;
  private orderedFiles: TFile[];
  private targetFolder: TFolder;
  private mergedTitle: string;
  private separator = "\n\n";
  private cleanupMode: MergeCleanupMode = "keep";
  private previewText: string;
  private previewError: string | null = null;
  private closed = true;
  private previewRequestSeq = 0;
  private submitRequestSeq = 0;

  constructor(app: App, options: BulkMergeModalOptions, onSubmit: (result: MergeModalSubmitResult) => Promise<boolean>) {
    super(app, { cancel: options.strings.cancel, submit: options.strings.mergeNotes, submitting: options.strings.merging });
    this.orderedFiles = [...options.files];
    this.targetFolder = options.initialTargetFolder;
    this.mergedTitle = options.initialMergedTitle;
    this.strings = options.strings;
    this.folderPickerTitle = options.folderPickerTitle;
    this.previewText = options.strings.loadingPreview;
    this.onSubmit = onSubmit;
  }

  override onOpen(): void {
    this.closed = false;
    void this.refreshPreview();
    this.render();
  }

  override onClose(): void {
    this.closed = true;
    this.previewRequestSeq += 1;
    this.submitRequestSeq += 1;
    this.contentEl.empty();
  }

  private getScrollContainer(): HTMLElement {
    if (this.modalEl.scrollTop > 0 || this.modalEl.scrollHeight > this.modalEl.clientHeight) {
      return this.modalEl;
    }
    return this.contentEl;
  }

  protected override render(): void {
    if (this.closed) {
      return;
    }
    const scrollContainer = this.getScrollContainer();
    const scrollTop = scrollContainer.scrollTop;
    this.contentEl.empty();
    this.renderBody();
    this.renderActions();
    this.renderPreview();
    scrollContainer.scrollTop = scrollTop;
  }

  protected renderBody(): void {
    this.setTitle(this.strings.title);
    this.contentEl.createEl("p", { text: this.strings.sourceCount(this.orderedFiles.length) });
    new Setting(this.contentEl).setName(this.strings.mergedTitle).addText((text) => {
      text.setValue(this.mergedTitle).onChange((value) => {
        this.mergedTitle = value;
      });
    });
    new Setting(this.contentEl)
      .setName(this.strings.targetFolder)
      .setDesc(this.targetFolder.path === "" ? "/" : this.targetFolder.path)
      .addButton((button) => {
        button.setButtonText(this.strings.chooseFolder).onClick(() => {
          const picker = new FolderPickerModal(this.app, (folder: TFolder) => {
            this.targetFolder = folder;
            this.render();
          }, this.folderPickerTitle);
          picker.open();
        });
      });
    new Setting(this.contentEl).setName(this.strings.separator).addText((text) => {
      text.setValue(this.separator).onChange((value) => {
        this.separator = value;
        void this.refreshPreview();
      });
    });
    this.contentEl.createEl("h4", { text: this.strings.sourceOrder });
    this.orderedFiles.forEach((file, index) => {
      new Setting(this.contentEl)
        .setName(`${index + 1}. ${file.path}`)
        .addButton((button) => button.setButtonText(this.strings.up).onClick(() => this.moveFile(index, -1)))
        .addButton((button) => button.setButtonText(this.strings.down).onClick(() => this.moveFile(index, 1)));
    });
    new Setting(this.contentEl)
      .setName(this.strings.sourceCleanup)
      .setDesc(this.cleanupMode === "keep" ? this.strings.keepSourceNotes : this.strings.trashSourceNotesAfterMerge)
      .addButton((button) => {
        button.setButtonText(this.strings.keepSourceNotes).setCta().onClick(() => {
          this.cleanupMode = "keep";
          this.render();
        });
      })
      .addButton((button) => {
        button.setButtonText(this.strings.trashSourceNotesAfterMerge).setWarning().onClick(() => {
          this.cleanupMode = "trash";
          this.render();
        });
      });
  }

  private renderPreview(): void {
    this.contentEl.createEl("h4", { text: this.strings.preview });
    this.contentEl.createEl("pre", { text: this.previewError ?? this.previewText });
  }

  private moveFile(index: number, delta: -1 | 1): void {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= this.orderedFiles.length) {
      return;
    }
    const nextFiles = [...this.orderedFiles];
    const [moved] = nextFiles.splice(index, 1);
    if (!moved) {
      return;
    }
    nextFiles.splice(nextIndex, 0, moved);
    this.orderedFiles = nextFiles;
    void this.refreshPreview();
    this.render();
  }

  private async refreshPreview(): Promise<void> {
    const requestSeq = ++this.previewRequestSeq;
    const orderedFiles = [...this.orderedFiles];
    const separator = this.separator;
    try {
      const notes: Array<{ basename: string; content: string }> = [];
      for (const file of orderedFiles) {
        const content = await this.app.vault.read(file);
        if (this.closed || requestSeq !== this.previewRequestSeq) {
          return;
        }
        notes.push({ basename: file.basename, content });
      }
      if (this.closed || requestSeq !== this.previewRequestSeq) {
        return;
      }
      this.previewText = buildMergedNoteContent(notes, separator);
      this.previewError = null;
    } catch (error) {
      if (this.closed || requestSeq !== this.previewRequestSeq) {
        return;
      }
      this.previewError = this.strings.failedToBuildPreview(String(error));
    }
    this.render();
  }

  protected async handleSubmit(): Promise<boolean> {
    if (this.orderedFiles.length < 2) {
      return false;
    }
    const requestSeq = ++this.submitRequestSeq;
    try {
      const mergedTitle = this.mergedTitle.trim();
      const shouldClose = await this.onSubmit({
        files: [...this.orderedFiles],
        targetFolder: this.targetFolder,
        mergedTitle: mergedTitle.length > 0 ? mergedTitle : this.strings.defaultMergedTitle,
        separator: this.separator,
        cleanupMode: this.cleanupMode,
      });
      if (this.closed || requestSeq !== this.submitRequestSeq) {
        return false;
      }
      return shouldClose;
    } catch (error) {
      if (this.closed || requestSeq !== this.submitRequestSeq) {
        return false;
      }
      new Notice(this.strings.failedToMergeNotes(String(error)));
      return false;
    }
  }
}
