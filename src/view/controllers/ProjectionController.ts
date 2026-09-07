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
import { resolveSourceCapabilities } from "../source-capabilities";
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

/**
 * Compares the stable `path + bucket key + label` signature of two full-set
 * bucket maps over the current base cards. Cardinality, per-card key/label
 * equality, and stale-path removal all count as movement.
 */
function bucketSignaturesDiffer(
  old: ReadonlyMap<string, GroupBucket>,
  fresh: ReadonlyMap<string, GroupBucket>,
  cards: readonly NoteCardRecord[],
): boolean {
  if (old.size !== fresh.size) {
    return true;
  }
  for (const card of cards) {
    const oldBucket = old.get(card.path);
    const freshBucket = fresh.get(card.path);
    if (oldBucket === undefined || freshBucket === undefined) {
      return true;
    }
    if (oldBucket.key !== freshBucket.key || oldBucket.label !== freshBucket.label) {
      return true;
    }
  }
  for (const path of old.keys()) {
    if (!fresh.has(path)) {
      return true;
    }
  }
  return false;
}

/** Value equality for the scope tag snapshot; order-sensitive by construction. */
function scopeTagDataEqual(
  left: { availableTags: string[]; tagCounts: Record<string, number> },
  right: { availableTags: string[]; tagCounts: Record<string, number> },
): boolean {
  if (left.availableTags.length !== right.availableTags.length
    || left.availableTags.some((tag, index) => tag !== right.availableTags[index])) {
    return false;
  }
  const leftKeys = Object.keys(left.tagCounts);
  const rightKeys = Object.keys(right.tagCounts);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => left.tagCounts[key] === right.tagCounts[key]);
}

/** Owns visible-card projection, group arrangement, and vault-derived caches. */
export class ProjectionController {
  private scopeTagCache: {
    key: string;
    value: { availableTags: string[]; tagCounts: Record<string, number> };
  } | null = null;
  /**
   * Pre-invalidation snapshot kept for exactly one comparison so the metadata
   * lane can detect tag-data changes even though invalidation cleared the
   * live cache first. Cleared by the next `refreshScopeTagData`.
   */
  private scopeTagStash: {
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
    const settings = this.context.getSettings();
    const pipelineContext: PipelineContext = {
      app: this.context.getApp(),
      filterTags: settings.filter.tags,
      propertyFilters: resolveSourceCapabilities(this.context.store.getScope()).browsePropertyFilter
        ? settings.filter.properties
        : [],
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
    const { groupDimensions } = resolveSourceCapabilities(this.context.store.getScope());
    if (spec.dimension === "box-rule" && !groupDimensions.includes("box-rule")) {
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
   * unrelated vault mutation. Recompute the buckets for the **full base-card
   * set** and compare a stable `path + bucket key + label` signature before the
   * old cache is discarded.
   *
   * Unlike the per-path refresh it replaced, the full-set rebuild can compare
   * labels safely: the label is canonical across the whole scope, so this
   * catches both bucket movement and canonical label-only changes such as
   * `#Work` to `#work`, while a full no-op re-save still reports no move.
   *
   * The freshly built buckets are always retained as the refreshed cache, so
   * the caller's reprojection serves them without a second rebuild. Returns
   * whether the signature moved and the caller should reproject.
   */
  refreshMetadataGroupBuckets(): boolean {
    const spec = this.resolveGroupSpec();
    if (!readsVaultMetadata(spec.dimension)) {
      return false;
    }

    const cached = this.groupBucketCache?.buckets ?? null;
    if (cached === null && this.groupSegments.length === 0) {
      // Nothing has been projected and no cache is warm, so there is no
      // rendered header that could be stale; skip the rebuild entirely.
      return false;
    }

    const cards = this.context.store.getBaseCards();
    const strings = this.context.getUiStrings();
    const labels = this.resolveGroupLabels(strings);
    const rules = this.resolveGroupRules();
    const fresh = buildGroupBuckets(
      this.context.getApp(),
      cards,
      spec,
      rules,
      labels,
      strings,
    );

    const moved = cached === null
      ? true
      : bucketSignaturesDiffer(cached, fresh, cards);

    this.groupBucketCache = {
      key: this.groupBucketCacheKey(spec.dimension, labels, rules),
      buckets: fresh,
    };
    return moved;
  }

  /**
   * Recomputes the scope tag snapshot (available tags + counts) from current
   * metadata and reinstalls it as the refreshed cache. Returns whether the
   * values changed, so a metadata event that touched no tag data can stay on
   * the minimal publication path. When invalidation just cleared the live
   * cache, the one-shot stash installed by that invalidation serves as the
   * baseline (key-matched); a genuinely cold cache with no stash reports no
   * change and the next derive serves the refreshed value.
   */
  refreshScopeTagData(): boolean {
    const key = this.scopeTagCacheKey();
    const live = this.scopeTagCache;
    const stashed = this.scopeTagStash;
    const previous = live?.key === key
      ? live.value
      : stashed?.key === key
        ? stashed.value
        : null;
    const app = this.context.getApp();
    const files = this.context.store.getBaseCards().map((card) => card.file);
    const value = {
      availableTags: this.hasMetadataCache() ? collectAllTags(app, files) : [],
      tagCounts: collectTagCounts(app, files),
    };
    this.scopeTagStash = null;
    this.scopeTagCache = { key, value };
    return previous !== null && !scopeTagDataEqual(previous, value);
  }

  private resolveGroupRules(): Rule[] {
    const { arrangementOwner } = resolveSourceCapabilities(this.context.store.getScope());
    if (arrangementOwner.kind !== "box") {
      return [];
    }
    return findCardBox(this.context.getSettings().boxes ?? [], arrangementOwner.boxId)?.rules ?? [];
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

  /**
   * Metadata-lane invalidation: clears the scope/vault tag caches only, so a
   * caller can still compare metadata-derived group-bucket signatures against
   * the pre-edit cache before deciding to reproject. The cleared scope-tag
   * snapshot is stashed (key-matched) for exactly one `refreshScopeTagData`
   * comparison so tag-data change detection survives this invalidation.
   * Box-rule/tag bucket staleness is owned by {@link refreshMetadataGroupBuckets},
   * which reinstalls a refreshed cache under the current key.
   */
  invalidateMetadataDerivedCaches(): void {
    if (this.scopeTagCache) {
      this.scopeTagStash = this.scopeTagCache;
    }
    this.scopeTagCache = null;
    this.vaultTagCountsCache = null;
  }
}
