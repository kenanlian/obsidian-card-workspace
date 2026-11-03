import { TFile, TFolder, type App } from "obsidian";
import { editablePropertyKey } from "../bulk-metadata";
import { addManualPaths } from "../card-boxes";
import type { CardDropTarget } from "../card-drop";
import { isMarkdownFile, moveFile } from "../note-ops";
import { editTagsInFile } from "../note-tag-ops";
import type { ViewContext } from "../view-context";

export interface CardDropResult { changed: number; noop: number; skipped: number; failed: number }

/** Read/modify/write the live value inside the host transaction, never a cached value. */
export async function applyDroppedProperty(app: App, file: TFile, target: Extract<CardDropTarget, { kind: "property" }>): Promise<boolean> {
  const key = editablePropertyKey(target.key);
  if (!key || target.value.kind === "missing" || !isMarkdownFile(file)) throw new Error("Invalid property destination");
  const value = target.value.value;
  let changed = false;
  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    const keys = Object.keys(frontmatter).filter(raw => editablePropertyKey(raw) === key);
    // Validate all case aliases before changing any of them.
    for (const raw of keys) {
      const previous = frontmatter[raw];
      if (previous !== null && typeof previous === "object" && !Array.isArray(previous)) throw new Error("Unsupported property structure");
    }
    for (const raw of keys.length ? keys : [target.key.trim()]) {
      const previous = frontmatter[raw];
      if (Array.isArray(previous) ? previous.includes(value) : previous === value) continue;
      Object.defineProperty(frontmatter, raw, { value: Array.isArray(previous) ? [...previous, value] : value,
        enumerable: true, configurable: true, writable: true });
      changed = true;
    }
  });
  return changed;
}

interface Deps {
  context: ViewContext;
  getVisiblePaths: () => string[];
  getSourceVersion?: () => number;
  getSelection: () => Set<string>;
  isBulkMode: () => boolean;
  setSelection: (paths: string[]) => void;
}
interface FrozenDrag { sourceVersion?: number; paths: string[]; files: TFile[]; originals: Map<TFile, string>; scope: unknown; selection: string[] }

/** Owns frozen file identities and one-shot card-drop writes for a view. */
export class CardDropActions {
  private frozen: FrozenDrag | null = null;
  private pending = false;
  private disposed = false;
  dispose(): void { this.disposed = true; this.frozen = null; }
  constructor(private readonly deps: Deps) {}
  resolvePaths(origin: string): string[] {
    const selected = this.deps.getSelection();
    return this.deps.isBulkMode() && selected.has(origin)
      ? this.deps.getVisiblePaths().filter(path => selected.has(path)) : [origin];
  }
  begin(paths: string[]): void {
    if (this.disposed) return;
    const vault = this.deps.context.getApp().vault;
    const originals = new Map<TFile, string>();
    for (const path of paths) { const file = vault.getAbstractFileByPath(path); if (file instanceof TFile) originals.set(file, path); }
    this.frozen = { sourceVersion: this.deps.getSourceVersion?.(), originals, paths: [...paths], files: paths.map(path => vault.getAbstractFileByPath(path)).filter((file): file is TFile => file instanceof TFile),
      scope: this.deps.context.store.getScope(), selection: [...this.deps.getSelection()] };
  }
  async drop(target: CardDropTarget, paths: string[]): Promise<CardDropResult | null> {
    const frozen = this.frozen;
    this.frozen = null;
    const { context } = this.deps;
    if (this.disposed || this.pending || !frozen || frozen.sourceVersion !== this.deps.getSourceVersion?.() || frozen.scope !== context.store.getScope()
      || frozen.paths.length !== paths.length || !paths.every((path, index) => path === frozen.paths[index])) return null;
    this.pending = true;
    const app = context.getApp();
    const result: CardDropResult = { changed: 0, noop: 0, skipped: 0, failed: 0 };
    const completed = new Set<string>();
    const boxPaths: string[] = [];
    const errors: string[] = [];
    const folder = target.kind === "folder" ? (target.path === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(target.path)) : null;
    try {
      for (const file of frozen.files) {
        const original = frozen.originals.get(file)!;
        try {
          if (app.vault.getAbstractFileByPath(file.path) !== file) throw new Error("Source file no longer exists");
          let changed = false;
          if (target.kind === "folder") {
            if (!(folder instanceof TFolder) || (folder.path === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folder.path)) !== folder) throw new Error("Destination folder no longer exists");
            if ((file.parent?.path ?? "") !== folder.path) {
              const moved = await moveFile(app, file, folder, context.getUiStrings().noteOps);
              if (!moved.ok) throw new Error(moved.error);
              changed = true;
            }
          } else if (target.kind === "box") {
            const settings = context.getSettings();
            const box = settings.boxes.find(entry => entry.id === target.boxId);
            if (!box) throw new Error("Destination box no longer exists");
            changed = !box.manualPaths.includes(file.path) || box.excludedPaths.includes(file.path);
            if (changed) boxPaths.push(file.path);
          } else {
            if (!isMarkdownFile(file)) { result.skipped++; continue; }
            if (target.kind === "tag") {
              const edited = await editTagsInFile(app, file, { addTags: [target.tag], removeTags: [] });
              if (!edited.ok) throw new Error(edited.error);
              changed = edited.changed;
            } else changed = await applyDroppedProperty(app, file, target);
          }
          if (changed) result.changed++; else result.noop++;
          completed.add(original); completed.add(file.path);
        } catch (error) { result.failed++; errors.push(`${file.path}: ${String(error)}`); }
      }
      if (target.kind === "box" && boxPaths.length) {
        try {
          const settings = context.getSettings();
          if (!settings.boxes.some(box => box.id === target.boxId)) throw new Error("Destination box no longer exists");
          await context.saveSettings({ boxes: settings.boxes.map(box => box.id === target.boxId ? addManualPaths(box, boxPaths) : box) });
        } catch (error) {
          result.changed -= boxPaths.length; result.failed += boxPaths.length;
          for (const file of frozen.files) if (boxPaths.includes(file.path)) { completed.delete(file.path); completed.delete(frozen.originals.get(file)!); }
          errors.push(String(error));
        }
      }
      result.failed += frozen.paths.length - frozen.files.length;
      const selected = [...this.deps.getSelection()];
      if (!this.disposed && frozen.scope === context.store.getScope() && selected.length === frozen.selection.length
        && selected.every((path, index) => path === frozen.selection[index])) {
        this.deps.setSelection(selected.filter(path => !completed.has(path)));
      }
      const strings = context.getUiStrings().view;
      if (!this.disposed) context.notify(strings.bulkMetadata.result(result.changed, result.noop, result.failed)
        + (result.skipped ? ` ${strings.cardDropSkipped(result.skipped)}` : "")
        + (errors.length ? `\n${errors.join("\n")}` : ""));
      return result;
    } finally { this.pending = false; }
  }
}
