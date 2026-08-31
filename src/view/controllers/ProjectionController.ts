import type { GroupDimension, GroupSpec } from "../../card-grouping-settings";
import { findCardBox } from "../card-boxes";
import {
  buildGroupBuckets,
  type CardGroupSegment,
  type GroupArrangement,
  type GroupBucket,
  type GroupLabels,
} from "../card-grouping";
import type { UiStrings } from "../../i18n";
import { collectAllTags, collectTagCounts, collectVaultTagIndex } from "../metadata-utils";
import { runPipeline, stepsForScope, type PipelineContext } from "../pipeline";
import { isBoxScope } from "../scope";
import type { NoteCardRecord, PipelineSearchInput, Rule } from "../types";
import type { ViewContext } from "../view-context";

export interface ProjectionControllerDeps {
  context: ViewContext;
  getSearchInput: () => PipelineSearchInput;
  getEffectivePinnedPaths: () => string[];
  getLoadKey: () => string | null;
  getGroupConfig: () => GroupSpec;
  getCollapsedGroupKeys: () => ReadonlySet<string>;
}

const EMPTY_BUCKETS: ReadonlyMap<string, GroupBucket> = new Map<string, GroupBucket>();

/** Dimensions whose bucket resolution reads the metadata cache or the vault. */
function readsVaultMetadata(dimension: GroupDimension): boolean {
  return dimension === "tag" || dimension === "box-rule";
}

function segmentSignature(segments: readonly CardGroupSegment[]): string {
  return segments
    .map((segment) => `${segment.key}:${segment.visibleCount}:${segment.label}:${segment.collapsed}`)
    .join("|");
}

/** Owns visible-card projection, group arrangement, and vault-derived caches. */
export class ProjectionController {
  private scopeTagCache: {
    key: string;
    value: { availableTags: string[]; tagCounts: Record<string, number> };
  } | null = null;
  private vaultTagCountsCache: { seq: number; counts: Record<string, number> } | null = null;
  private groupBucketCache: { key: string; buckets: ReadonlyMap<string, GroupBucket> } | null = null;
  private groupSegments: readonly CardGroupSegment[] = [];
  private groupSegmentSignature = "";
  private groupRevision = 0;
  /**
   * Segment table of the arrangement currently being derived.
   *
   * `deriveArrangement` reads its cards back through `deriveVisibleCards`, which
   * host tests substitute wholesale; a `NoteCardRecord[]` return type cannot
   * carry the segments, so they land here instead.
   */
  private arrangedSegments: CardGroupSegment[] = [];

  constructor(private readonly deps: ProjectionControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  deriveVisibleCards(): NoteCardRecord[] {
    return this.deriveVisibleCardsFrom(this.context.store.getBaseCards());
  }

  /** Cards only; `ScopeController` uses this to pick startup hydration paths. */
  deriveVisibleCardsFrom(cards: readonly NoteCardRecord[]): NoteCardRecord[] {
    return this.deriveArrangementFrom(cards).cards;
  }

  deriveArrangement(): GroupArrangement {
    this.arrangedSegments = [];
    const cards = this.deriveVisibleCards();
    return { cards, segments: this.arrangedSegments };
  }

  deriveArrangementFrom(cards: readonly NoteCardRecord[]): GroupArrangement {
    const spec = this.resolveGroupSpec();
    const pipelineContext: PipelineContext = {
      app: this.context.getApp(),
      filterTags: this.context.getSettings().filter.tags,
      search: this.deps.getSearchInput(),
      pinnedPaths: this.deps.getEffectivePinnedPaths(),
      group: { spec, buckets: this.resolveGroupBuckets(spec, cards) },
      collapsedGroupKeys: this.deps.getCollapsedGroupKeys(),
    };

    const result = runPipeline(
      [...cards],
      stepsForScope(this.context.store.getScope()),
      pipelineContext,
    );
    this.arrangedSegments = result.segments;
    return result;
  }

  /** Publishes a fresh visible-card array while preserving shared record objects. */
  reprojectCards(): void {
    const arrangement = this.deriveArrangement();
    this.context.store.replaceVisibleCards(arrangement.cards);
    this.storeGroupSegments(arrangement.segments);
  }

  getGroupSegments(): readonly CardGroupSegment[] {
    return this.groupSegments;
  }

  getGroupRevision(): number {
    return this.groupRevision;
  }

  getOrderedVisiblePaths(): string[] {
    return this.context.store.getVisibleCards().map((card) => card.path);
  }

  private storeGroupSegments(segments: readonly CardGroupSegment[]): void {
    this.groupSegments = segments;
    const signature = segmentSignature(segments);
    if (signature !== this.groupSegmentSignature) {
      this.groupSegmentSignature = signature;
      this.groupRevision += 1;
    }
  }

  /**
   * `box-rule` is meaningless outside a box: `buildGroupBuckets` would receive
   * an empty rule list and drop every card into the manual bucket. Coerce to
   * `none` for this projection only, without rewriting the persisted value.
   */
  private resolveGroupSpec(): GroupSpec {
    const spec = this.deps.getGroupConfig();
    if (spec.dimension === "box-rule" && !isBoxScope(this.context.store.getScope())) {
      return { ...spec, dimension: "none" };
    }
    return spec;
  }

  private resolveGroupLabels(strings: UiStrings): GroupLabels {
    const group = strings.sortGroup;
    return {
      vaultRoot: group.bucketVaultRoot,
      noTag: group.bucketNoTag,
      noTask: group.bucketNoTask,
      manual: group.bucketManual,
    };
  }

  /**
   * A metadata-only edit never bumps `epochs.vaultContent`, so the cached
   * `tag` / `box-rule` buckets would keep serving the pre-edit header until an
   * unrelated vault mutation. Recompute just this card's bucket and drop the
   * cache only when it actually moved, so an ordinary note save does not pay
   * for a full re-bucket of the scope.
   *
   * Returns whether the caller should reproject.
   */
  refreshGroupBucketForPath(path: string): boolean {
    const spec = this.resolveGroupSpec();
    if (!readsVaultMetadata(spec.dimension)) {
      return false;
    }

    const cached = this.groupBucketCache?.buckets.get(path);
    if (cached === undefined) {
      // A cold cache is ambiguous. Either nothing has been projected yet, or a
      // rendered arrangement outlived an `invalidateVaultCaches()` that did not
      // reproject — the nav-count path does exactly that. Only the second case
      // can be showing a stale header, and a live segment table is what tells
      // them apart. This costs one reprojection per invalidation, after which
      // the cache is warm and the key comparison below takes over again.
      return this.groupSegments.length > 0;
    }

    const card = this.context.store.getBaseCard(path);
    if (card === undefined) {
      return false;
    }

    const strings = this.context.getUiStrings();
    const fresh = buildGroupBuckets(
      this.context.getApp(),
      [card],
      spec,
      this.resolveGroupRules(),
      this.resolveGroupLabels(strings),
      strings,
    ).get(path);

    // Key only, deliberately. A metadata edit cannot change a `box-rule` label,
    // which comes from rule identity and is already covered by the label
    // signature; and a `tag` label is canonicalized across the whole scope, so
    // a single-card rebuild cannot produce a comparable value. Comparing labels
    // here reported a move on every save for a mixed-casing tag group.
    if (fresh === undefined || fresh.key === cached.key) {
      return false;
    }

    this.groupBucketCache = null;
    return true;
  }

  private resolveGroupRules(): Rule[] {
    const scope = this.context.store.getScope();
    if (!isBoxScope(scope)) {
      return [];
    }
    return findCardBox(this.context.getSettings().boxes ?? [], scope.boxId)?.rules ?? [];
  }

  private resolveGroupBuckets(
    spec: GroupSpec,
    cards: readonly NoteCardRecord[],
  ): ReadonlyMap<string, GroupBucket> {
    if (spec.dimension === "none") {
      return EMPTY_BUCKETS;
    }

    const strings = this.context.getUiStrings();
    const labels = this.resolveGroupLabels(strings);
    const rules = this.resolveGroupRules();
    const build = (): ReadonlyMap<string, GroupBucket> =>
      buildGroupBuckets(this.context.getApp(), cards, spec, rules, labels, strings);

    // `folder` reads `card.path` and `task` reads `card.taskSummary`; both are
    // free, so only the vault-reading dimensions are worth caching.
    if (!readsVaultMetadata(spec.dimension)) {
      return build();
    }

    const key = this.groupBucketCacheKey(spec.dimension, labels, rules);
    const cached = this.groupBucketCache;
    if (cached && cached.key === key) {
      return cached.buckets;
    }

    const buckets = build();
    this.groupBucketCache = { key, buckets };
    return buckets;
  }

  /**
   * The membership signature inside the load key governs whether cards are
   * re-collected; the trailing label signature governs whether buckets are
   * re-labelled. A rule rename and a UI language switch both change labels
   * without touching vault state, so neither is visible in the first four
   * terms alone.
   */
  private groupBucketCacheKey(
    dimension: GroupDimension,
    labels: GroupLabels,
    rules: readonly Rule[],
  ): string {
    let labelSignature = `${labels.noTag}\u0000${labels.manual}`;
    if (dimension === "box-rule") {
      labelSignature += `::${rules.map((rule) => `${rule.id}:${rule.name ?? ""}`).join("|")}`;
    }
    return `${dimension}::${this.scopeTagCacheKey()}::${labelSignature}`;
  }

  private scopeTagCacheKey(): string {
    const baseCards = this.context.store.getBaseCards();
    return `${this.deps.getLoadKey()}::${baseCards.length}::${this.context.epochs.vaultContent.value}`;
  }

  deriveScopeTags(): { availableTags: string[]; tagCounts: Record<string, number> } {
    const key = this.scopeTagCacheKey();
    const cached = this.scopeTagCache;
    if (cached && cached.key === key) {
      return cached.value;
    }

    const app = this.context.getApp();
    const files = this.context.store.getBaseCards().map((card) => card.file);
    const value = {
      availableTags: this.hasMetadataCache() ? collectAllTags(app, files) : [],
      tagCounts: collectTagCounts(app, files),
    };
    this.scopeTagCache = { key, value };
    return value;
  }

  private hasMetadataCache(): boolean {
    const metadataCache = (this.context.getApp() as unknown as { metadataCache?: unknown })
      .metadataCache;
    return (
      typeof metadataCache === "object" &&
      metadataCache !== null &&
      "getFileCache" in metadataCache &&
      typeof (metadataCache as { getFileCache?: unknown }).getFileCache === "function"
    );
  }

  deriveAvailableTags(): string[] {
    return this.deriveScopeTags().availableTags;
  }

  deriveTagCounts(): Record<string, number> {
    return this.deriveScopeTags().tagCounts;
  }

  getVaultTagCounts(): Record<string, number> {
    const seq = this.context.epochs.navCount.value;
    const cached = this.vaultTagCountsCache;
    if (cached && cached.seq === seq) {
      return cached.counts;
    }

    const counts = collectVaultTagIndex(this.context.getApp())?.counts ?? {};
    this.vaultTagCountsCache = { seq, counts };
    return counts;
  }

  invalidateVaultCaches(): void {
    this.scopeTagCache = null;
    this.vaultTagCountsCache = null;
    this.groupBucketCache = null;
  }
}
