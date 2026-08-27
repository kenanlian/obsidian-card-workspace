import { isMarkdownCardKind } from "../file-kind";
import { deriveCardTaskSummary, type CardTaskSummary } from "../task-summary";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

export interface TaskSummaryControllerDeps {
  context: ViewContext;
}

function taskSummariesEqual(
  left: CardTaskSummary | null,
  right: CardTaskSummary | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null) {
    return false;
  }
  return left.total === right.total && left.incomplete === right.incomplete;
}

/** Patches one card's task summary in place when that note's metadata changes. */
export class TaskSummaryController implements DisposableController {
  private disposed = false;

  constructor(private readonly deps: TaskSummaryControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  handleMetadataChange(path: string): void {
    if (this.disposed) {
      return;
    }

    const card = this.context.store.getBaseCard(path);
    if (card === undefined) {
      return;
    }

    if (!isMarkdownCardKind(card.fileKind)) {
      return;
    }

    const next = deriveCardTaskSummary(this.context.getApp(), card.file, card.fileKind);
    if (taskSummariesEqual(card.taskSummary, next)) {
      return;
    }

    this.context.store.patchCardPreviews([{ path, patch: { taskSummary: next } }]);
    this.context.publishGroups("cards");
  }

  dispose(): DisposeReport {
    this.disposed = true;
    return {};
  }
}
