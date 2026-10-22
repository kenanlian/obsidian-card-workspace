import { TFile, type App } from "obsidian";

/** Undocumented host surface; keep detection and access inside this adapter. */
interface NativeDragManager {
  draggable?: unknown;
  dragFile(event: DragEvent, file: TFile): unknown;
  onDragStart(event: DragEvent, draggable: unknown): void;
  onDragEnd(): void;
}

function resolveDragManager(app: App): NativeDragManager | null {
  const manager = (app as App & { dragManager?: Partial<NativeDragManager> }).dragManager;
  return manager && typeof manager.dragFile === "function"
    && typeof manager.onDragStart === "function" && typeof manager.onDragEnd === "function"
    ? manager as NativeDragManager : null;
}

/** Starts one native file drag; the host owns drop behavior and feedback. */
export class NativeFileDragController {
  private finishDrag: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly getApp: () => App) {}

  start(event: DragEvent, path: string): (() => void) | null {
    if (this.disposed || event.defaultPrevented || !event.dataTransfer) return null;
    this.finishDrag?.();
    const app = this.getApp();
    const manager = resolveDragManager(app);
    const file = app.vault.getAbstractFileByPath(path);
    if (!manager || manager.draggable != null || !(file instanceof TFile)) return null;

    let draggable: unknown;
    let finished = false;
    const ownsDrag = () => draggable != null && manager.draggable === draggable;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (this.finishDrag === finish) this.finishDrag = null;
      // A host dragend or a newer drag may already have replaced our session.
      if (ownsDrag()) {
        try { manager.onDragEnd(); }
        catch (error) { console.warn("[Card Workspace] Native file drag cleanup failed.", error); }
      }
    };
    try {
      draggable = manager.dragFile(event, file);
      if (draggable == null) return null;
      this.finishDrag = finish;
      manager.onDragStart(event, draggable);
      if (!ownsDrag()) {
        finish();
        return null;
      }
      return finish;
    } catch (error) {
      finish();
      console.warn("[Card Workspace] Native file drag unavailable.", error);
      return null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.finishDrag?.();
  }
}
