import { collectAllTags, collectTagCounts, collectVaultTagIndex } from "../metadata-utils";
import { runPipeline, stepsForScope, type PipelineContext } from "../pipeline";
import type { NoteCardRecord, PipelineSearchInput } from "../types";
import type { ViewContext } from "../view-context";

export interface ProjectionControllerDeps {
  context: ViewContext;
  getSearchInput: () => PipelineSearchInput;
  getEffectivePinnedPaths: () => string[];
  getLoadKey: () => string | null;
}

/** Owns visible-card projection and vault-derived tag caches. */
export class ProjectionController {
  private scopeTagCache: {
    key: string;
    value: { availableTags: string[]; tagCounts: Record<string, number> };
  } | null = null;
  private vaultTagCountsCache: { seq: number; counts: Record<string, number> } | null = null;

  constructor(private readonly deps: ProjectionControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  deriveVisibleCards(): NoteCardRecord[] {
    return this.deriveVisibleCardsFrom(this.context.store.getBaseCards());
  }

  deriveVisibleCardsFrom(cards: readonly NoteCardRecord[]): NoteCardRecord[] {
    const pipelineContext: PipelineContext = {
      app: this.context.getApp(),
      filterTags: this.context.getSettings().filter.tags,
      search: this.deps.getSearchInput(),
      pinnedPaths: this.deps.getEffectivePinnedPaths(),
    };

    return runPipeline([...cards], stepsForScope(this.context.store.getScope()), pipelineContext);
  }

  /** Publishes a fresh visible-card array while preserving shared record objects. */
  reprojectCards(): void {
    this.context.store.replaceVisibleCards(this.deriveVisibleCards());
  }

  getOrderedVisiblePaths(): string[] {
    return this.context.store.getVisibleCards().map((card) => card.path);
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
  }
}
