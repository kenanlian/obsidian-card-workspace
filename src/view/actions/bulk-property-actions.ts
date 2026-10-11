import type { TFile } from "obsidian";
import { buildBulkMetadataSnapshot } from "../bulk-metadata";
import { BulkPropertiesModal } from "../modals/BulkPropertiesModal";
import { editPropertiesInFile } from "../note-property-ops";
import type { ViewContext } from "../view-context";
import { BulkMetadataSession } from "./bulk-metadata-session";

export interface BulkPropertyActionsDeps {
  context: ViewContext;
  resolveLiveMarkdownFile: (notePath: string) => TFile | null;
  isBulkMode: () => boolean;
  resolveSelectedLiveMarkdownFilesInOrder: () => { filesInOrder: TFile[] };
  reconcileSelectionToOrderedPaths: (paths: string[]) => void;
}
export class BulkPropertyActions {
  constructor(private readonly deps: BulkPropertyActionsDeps) {}
  /** Card menu entry: the bulk property dialog scoped to one note. */
  editPropertiesForNote(notePath: string): void {
    const file = this.deps.resolveLiveMarkdownFile(notePath);
    if (file) this.openPropertiesEditor([file]);
  }
  bulkEditPropertiesSelected(): void {
    if (!this.deps.isBulkMode()) return;
    const files = this.deps.resolveSelectedLiveMarkdownFilesInOrder().filesInOrder;
    if (!files.length) return;
    this.openPropertiesEditor(files, (failedPaths) => this.deps.reconcileSelectionToOrderedPaths(failedPaths));
  }
  private openPropertiesEditor(files: TFile[], onApplied?: (failedPaths: string[]) => void): void {
    const app = this.deps.context.getApp();
    const strings = this.deps.context.getUiStrings().view.bulkMetadata;
    const session = new BulkMetadataSession(files);
    const modal = new BulkPropertiesModal(app, { strings, snapshot: buildBulkMetadataSnapshot(app, files), targetCount: files.length }, async (draft) => {
      const result = await session.apply(app, (file) => editPropertiesInFile(app, file, draft));
      onApplied?.(result.failed.map((file) => file.path));
      const message = strings.result(result.changed, result.noop, result.failed.length) + (result.failed.length ? ` ${strings.retry}\n${result.errors.join("\n")}` : "");
      modal.showResult(message, result.failed.length);
      this.deps.context.notify(message);
      return !result.failed.length;
    });
    modal.open();
  }
}
