import type { GroupDimension } from "../../card-grouping-settings";
import { isMarkdownCardKind } from "../file-kind";
import { deriveCardTaskSummary, type CardTaskSummary } from "../task-summary";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

export interface TaskSummaryControllerDeps {
  context: ViewContext;
  getGroupDimension: () => GroupDimension;
  /** Reprojects, reconciles bulk selection, then publishes nav, scope, cards, projection, and bulk. */
  reprojectAndPublish: () => void;
  /** Removes the path when refreshed metadata ends its active Box membership. */
  reconcileMetadataMembershipForPath: (path: string) => boolean;
  /** Drops the cached metadata-derived bucket for one card; true when it moved. */
  refreshGroupBucketForPath: (path: string) => boolean;
  /**
   * Property lane impact for one in-base metadata change (C11). Bumps the
   * facet metadata revision at most once and reports the follow-up work:
   * "reproject" (active clauses), "nav" (facets only), or "none".
   */
  classifyPropertyMetadataImpact: (path: string) => "reproject" | "nav" | "none";
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

/** Mirrors `resolveTaskBucket`: only these three states are distinguishable. */
function taskBucketKind(summary: CardTaskSummary | null): "none" | "incomplete" | "complete" {
  if (summary === null) {
    return "none";
  }
  return summary.incomplete > 0 ? "incomplete" : "complete";
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

    // Box membership is collected at load, but tag-bearing rules can change on
    // this metadata lane. Reconcile before bucket refresh so a departed rule
    // member cannot fall through to the manual-only presentation bucket.
    if (this.deps.reconcileMetadataMembershipForPath(path)) {
      this.deps.reprojectAndPublish();
      return;
    }

    // Classify the property lane once so the whole event ends in at most one
    // coherent panel batch for its final state.
    const propertyImpact = this.deps.classifyPropertyMetadataImpact(path);

    let summaryChanged = false;
    if (isMarkdownCardKind(card.fileKind)) {
      const next = deriveCardTaskSummary(this.context.getApp(), card.file, card.fileKind);
      if (!taskSummariesEqual(card.taskSummary, next)) {
        this.context.store.patchCardPreviews([{ path, patch: { taskSummary: next } }]);
        summaryChanged = true;

        // Under the task dimension a bucket move can leave the card rendered
        // under the wrong header, so the minimal patch path is not enough there.
        const movedBucket = taskBucketKind(card.taskSummary) !== taskBucketKind(next);
        if (movedBucket && this.deps.getGroupDimension() === "task") {
          this.deps.reprojectAndPublish();
          return;
        }
      }
    }

    // The tag and box-rule buckets read metadata this event just invalidated,
    // and no vault-content epoch bump follows a metadata-only edit.
    if (this.deps.refreshGroupBucketForPath(path)) {
      this.deps.reprojectAndPublish();
      return;
    }

    if (propertyImpact === "reproject") {
      this.deps.reprojectAndPublish();
      return;
    }

    if (propertyImpact === "nav") {
      this.context.publishGroups(...(summaryChanged ? ["cards", "nav"] as const : ["nav"] as const));
      return;
    }

    if (summaryChanged) {
      this.context.publishGroups("cards");
    }
  }

  dispose(): DisposeReport {
    this.disposed = true;
    return {};
  }
}
