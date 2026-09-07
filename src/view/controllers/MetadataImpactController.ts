import type { GroupDimension } from "../../card-grouping-settings";
import { isMarkdownCardKind } from "../file-kind";
import { deriveCardTaskSummary, type CardTaskSummary } from "../task-summary";
import type { NoteCardRecord } from "../types";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";
import type { MetadataMembershipOutcome } from "./ScopeController";

/** The one coherent immediate publication a metadata event may produce. */
export type MetadataImpactBatch =
  | {
      /** Card-reprojecting event: fresh scope, cards, projection, bulk, and nav. */
      readonly kind: "reprojected";
      /** Includes the search group when a non-empty query was silently refreshed. */
      readonly includeSearch: boolean;
    }
  | {
      /** Tags/facets-only event: one fresh projection snapshot drives nav. */
      readonly kind: "facets";
      /** Cards are republished alongside the facets when a summary was patched. */
      readonly includeCards: boolean;
    };

export interface MetadataImpactControllerDeps {
  context: ViewContext;
  getGroupDimension: () => GroupDimension;
  /** True while the runtime scope is a folder with an active browse Tag filter. */
  isBrowseTagFilterActive: () => boolean;
  /** True while the view's query is non-empty (drives the batch's search group). */
  isSearchActive: () => boolean;
  /** Symmetric Box membership reconciliation for one path. */
  reconcileMetadataMembershipForPath: (path: string) => MetadataMembershipOutcome;
  /**
   * Recomputes metadata-derived group buckets over the full base-card set,
   * retains the refreshed cache, and reports whether the stable
   * `path + bucket key + label` signature moved.
   */
  refreshMetadataGroupBuckets: () => boolean;
  /** Recomputes scope tag data and reports whether available tags/counts moved. */
  refreshScopeTagData: () => boolean;
  /**
   * Property lane impact for one in-base metadata change. Bumps the facet
   * metadata revision at most once and reports the follow-up work:
   * "reproject" (active clauses), "nav" (facets only), or "none".
   */
  classifyPropertyMetadataImpact: (path: string) => "reproject" | "nav" | "none";
  /**
   * Invalidates Box card-count and scope/vault tag caches for relevant
   * Markdown metadata and schedules the existing debounced count refresh.
   */
  invalidateMetadataDerivedCaches: () => void;
  /**
   * Silent indexed-candidate refresh: current query, full new base-card paths,
   * SearchController's existing stale guards, no intermediate publication.
   * Resolves immediately for empty queries.
   */
  refreshSearchCandidatesSilently: () => Promise<void>;
  /** Reprojects visible cards and reconciles bulk selection to the new set. */
  reprojectCardsForMetadata: () => void;
  /** Publishes the one coherent panel batch for this event. */
  publishImpactBatch: (batch: MetadataImpactBatch) => void;
  /** Schedules forced hydration only for paths still visible and unhydrated. */
  scheduleVisibleHydrationCandidates: (paths: readonly string[]) => void;
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

/**
 * The single per-view consumer of `MetadataEventBus`.
 *
 * `main.ts` remains the only direct `metadataCache.on("changed")` owner; this
 * coordinator receives `{ path }` through the bus and re-reads live Vault and
 * MetadataCache state at handling time. Vault and Metadata buses have no
 * cross-bus delivery-order guarantee, so every step is repeat-safe and
 * resolves current state rather than event payloads: an already-applied
 * counterpart Vault event simply reports "unchanged".
 *
 * Each event produces at most one immediate panel-model notification plus the
 * existing coalesced debounced nav-count refresh.
 */
export class MetadataImpactController implements DisposableController {
  private disposed = false;

  constructor(private readonly deps: MetadataImpactControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  async handleMetadataChange(path: string): Promise<void> {
    if (this.disposed) {
      return;
    }

    // Membership first, so a departed rule member cannot fall through to the
    // manual-only presentation bucket and an entering member is installed
    // before any projection reads the card set.
    const membership = this.deps.reconcileMetadataMembershipForPath(path);
    if (membership !== "unchanged") {
      await this.applyMembershipImpact(path, membership);
      return;
    }

    // Everything beyond membership is in-base only; out-of-base paths in a
    // folder scope (or non-member Box paths) are safe no-ops.
    const card = this.context.store.getBaseCard(path);
    if (card === undefined) {
      return;
    }
    this.applyInBaseImpact(path, card);
  }

  /**
   * A Box membership change also changes the candidate set of any active
   * indexed query. The base cards are already installed; await the silent
   * candidate refresh (empty queries return immediately) so the reprojection
   * and its one coherent batch reflect the refreshed search state. A scope
   * load that started during the await owns the state instead.
   */
  private async applyMembershipImpact(
    path: string,
    membership: MetadataMembershipOutcome,
  ): Promise<void> {
    this.deps.invalidateMetadataDerivedCaches();
    const loadToken = this.context.epochs.load.token();
    await this.deps.refreshSearchCandidatesSilently();
    if (this.disposed || !this.context.epochs.load.isCurrent(loadToken)) {
      return;
    }
    this.deps.reprojectCardsForMetadata();
    this.deps.publishImpactBatch({
      kind: "reprojected",
      includeSearch: this.deps.isSearchActive(),
    });
    if (membership === "entered") {
      // Reproject first; a search-hidden entry stays unhydrated until ordinary
      // viewport demand finds it visible.
      this.deps.scheduleVisibleHydrationCandidates([path]);
    }
  }

  private applyInBaseImpact(path: string, card: NoteCardRecord): void {
    this.deps.invalidateMetadataDerivedCaches();

    // Classify the property lane once so the whole event ends in at most one
    // coherent panel batch for its final state.
    const propertyImpact = this.deps.classifyPropertyMetadataImpact(path);

    let summaryChanged = false;
    let movedTaskBucket = false;
    if (isMarkdownCardKind(card.fileKind)) {
      const next = deriveCardTaskSummary(this.context.getApp(), card.file, card.fileKind);
      if (!taskSummariesEqual(card.taskSummary, next)) {
        this.context.store.patchCardPreviews([{ path, patch: { taskSummary: next } }]);
        summaryChanged = true;

        // Under the task dimension a bucket move can leave the card rendered
        // under the wrong header, so the minimal patch path is not enough there.
        movedTaskBucket = taskBucketKind(card.taskSummary) !== taskBucketKind(next)
          && this.deps.getGroupDimension() === "task";
      }
    }

    // Metadata-derived buckets and scope tag data read metadata this event just
    // invalidated; no vault-content epoch bump follows a metadata-only edit.
    const bucketsMoved = this.deps.refreshMetadataGroupBuckets();
    const tagsChanged = this.deps.refreshScopeTagData();

    // Folder scope: an in-base tag change re-runs the sole pipeline whenever
    // browse Tag filters are active, so matching-to-nonmatching and back are
    // visible immediately. Box scopes skip browse Tag and Property filters.
    const needsReproject = this.deps.isBrowseTagFilterActive()
      || movedTaskBucket
      || bucketsMoved
      || propertyImpact === "reproject";
    if (needsReproject) {
      this.deps.reprojectCardsForMetadata();
      this.deps.publishImpactBatch({ kind: "reprojected", includeSearch: false });
      return;
    }

    if (propertyImpact === "nav" || tagsChanged) {
      this.deps.publishImpactBatch({ kind: "facets", includeCards: summaryChanged });
      return;
    }

    // Summary-only change: patch the record, publish cards only.
    if (summaryChanged) {
      this.context.publishGroups("cards");
    }
  }

  dispose(): DisposeReport {
    this.disposed = true;
    return {};
  }
}
