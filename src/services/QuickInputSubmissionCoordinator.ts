import type { NoteInputResult, QuickInputRequest } from "../note-input";
import type { PartialPluginSettings, PluginSettings } from "../settings";
import { addManualPaths } from "../view/card-boxes";
import { QuickInputPreflightError, type NoteCreationService } from "./NoteCreationService";

export function validateQuickInputBoxes(settings: PluginSettings, request: QuickInputRequest): void {
  if (request.boxIds?.some((id) => !settings.boxes.some((box) => box.id === id))) throw new QuickInputPreflightError("missing-box");
}
export class QuickInputBoxesSaveError extends Error {
  constructor(readonly path: string) { super("quick-input-boxes-save-failed"); }
}
/** Plugin-owned two-stage submission. A successful note write survives UI/window disposal. */
export class QuickInputSubmissionCoordinator {
  private readonly saved = new Map<string, NoteInputResult>();
  private readonly started = new Set<string>();
  private readonly pending = new Map<string, Promise<NoteInputResult>>();
  private boxesQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: {
    notes: NoteCreationService;
    getSettings(): PluginSettings;
    saveSettings(patch: PartialPluginSettings): Promise<void>;
  }) {}
  submit(request: QuickInputRequest): Promise<NoteInputResult> {
    const pending = this.pending.get(request.submissionId);
    if (pending) return pending;
    const snapshot = { ...request, boxIds: [...(request.boxIds ?? [])] };
    const work = this.write(snapshot);
    this.pending.set(request.submissionId, work);
    const clear = () => { this.pending.delete(request.submissionId); };
    void work.then(clear, clear);
    return work;
  }
  private async write(request: QuickInputRequest): Promise<NoteInputResult> {
    let result = this.saved.get(request.submissionId);
    if (!result) {
      // Only the note writer can establish whether a failed attempt wrote data.
      // A later missing box must not turn an uncertain write into an editable draft.
      if (!this.started.has(request.submissionId)) {
        validateQuickInputBoxes(this.options.getSettings(), request);
        this.started.add(request.submissionId);
      }
      try { result = await this.options.notes.submitQuickInput(request); }
      catch (error) {
        if (error instanceof QuickInputPreflightError) this.started.delete(request.submissionId);
        throw error;
      }
      this.saved.set(request.submissionId, result);
      this.started.delete(request.submissionId);
    }
    const saved = result;
    if (!request.boxIds?.length) return saved;
    const boxesWork = this.boxesQueue.catch(() => undefined).then(async () => {
      const settings = this.options.getSettings();
      validateQuickInputBoxes(settings, request);
      const selected = new Set(request.boxIds);
      await this.options.saveSettings({ boxes: settings.boxes.map((box) => selected.has(box.id) ? addManualPaths(box, [saved.file.path]) : box) });
    });
    this.boxesQueue = boxesWork;
    try { await boxesWork; }
    catch { throw new QuickInputBoxesSaveError(saved.file.path); }
    return saved;
  }
}
