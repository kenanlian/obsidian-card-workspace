import {
  serializePropertyScalarRef,
  type PropertyFilterClause,
  type PropertyInventorySnapshot,
} from "../../property-filter-settings";
import { isMarkdownCardKind } from "../file-kind";
import { getFileFrontmatter } from "../metadata-utils";
import { buildPropertyFacets, type PropertyFacet } from "../property-facets";
import { collectPropertyInventory as scanPropertyInventory } from "../property-metadata";
import type { DisposableController, DisposeReport, ViewContext } from "../view-context";

export interface PropertyControllerDeps {
  context: ViewContext;
  getLoadKey: () => string | null;
}

interface PropertyStringsIdentity {
  valueUnassigned: string;
  valueTrue: string;
  valueFalse: string;
  typeText: string;
  typeNumber: string;
  typeBoolean: string;
}

/**
 * Per-view owner of property facets and the vault property-key inventory.
 *
 * Facet cache key: effective load identity, base-card count,
 * `epochs.vaultContent`, a controller-owned metadata revision (bumped only by
 * the explicit invalidation methods below), enabled keys, active filter
 * identity, and the display-label strings. Identical inputs reuse the cached
 * facet array by reference.
 *
 * Invalidation:
 * - `invalidateMetadata(paths?)` — metadata-only edits carry no vault-content
 *   epoch bump, so they are classified here: no paths means "unknown, assume
 *   impact"; otherwise only an in-base Markdown card counts as an impact.
 *   Returns whether the revision actually moved.
 * - `invalidateVault()` — a vault mutation already bumps `vaultContent`, but
 *   callers that drop vault caches explicitly can bump the metadata revision
 *   through the same door.
 *
 * The inventory is collected fresh from the vault on every call and never
 * retained. This controller never subscribes to `metadataCache` events and
 * never publishes panel groups on its own.
 */
export class PropertyController implements DisposableController {
  private disposed = false;
  private metadataRevision = 0;
  private facetCache: { key: string; facets: PropertyFacet[] } | null = null;

  constructor(private readonly deps: PropertyControllerDeps) {}

  private get context(): ViewContext {
    return this.deps.context;
  }

  /** Cached facet snapshot for the current base cards, settings, and labels. */
  derivePropertyFacets(): PropertyFacet[] {
    if (this.disposed) {
      return [];
    }

    const settings = this.context.getSettings();
    const strings = this.context.getUiStrings().property;
    const key = this.facetCacheKey(
      settings.visiblePropertyKeys,
      settings.filter.properties,
      strings,
    );
    const cached = this.facetCache;
    if (cached !== null && cached.key === key) {
      return cached.facets;
    }

    const app = this.context.getApp();
    const facets = buildPropertyFacets(
      this.context.store.getBaseCards(),
      settings.visiblePropertyKeys,
      settings.filter.properties,
      (file) => getFileFrontmatter(app, file),
      strings,
    );
    this.facetCache = { key, facets };
    return facets;
  }

  /** Fresh vault scan on every call — chooser-safe, never cached here. */
  collectPropertyInventory(): PropertyInventorySnapshot {
    if (this.disposed) {
      return { status: "unavailable", options: [] };
    }
    return scanPropertyInventory(this.context.getApp());
  }

  /**
   * Classifies a metadata-only change by path impact. With explicit paths,
   * only an in-base Markdown card can affect property facets; an isolated
   * out-of-base (or non-Markdown) event moves nothing and publishes nothing.
   * Without paths the change is assumed impactful.
   */
  invalidateMetadata(paths?: readonly string[]): boolean {
    if (this.disposed) {
      return false;
    }
    if (paths !== undefined) {
      const impacted = paths.some((path) => {
        const card = this.context.store.getBaseCard(path);
        return card !== undefined && isMarkdownCardKind(card.fileKind);
      });
      if (!impacted) {
        return false;
      }
    }
    this.bumpMetadataRevision();
    return true;
  }

  /** Unconditional metadata-revision bump for explicit vault-cache drops. */
  invalidateVault(): void {
    if (this.disposed) {
      return;
    }
    this.bumpMetadataRevision();
  }

  dispose(): DisposeReport {
    this.disposed = true;
    this.facetCache = null;
    return {};
  }

  private bumpMetadataRevision(): void {
    this.metadataRevision += 1;
    this.facetCache = null;
  }

  private facetCacheKey(
    visibleKeys: readonly string[],
    clauses: readonly PropertyFilterClause[],
    strings: PropertyStringsIdentity,
  ): string {
    // JSON encoding keeps every component unambiguous: visible keys, clause
    // key text, and label strings are all user/localization-controlled and may
    // contain delimiter-like text, so delimiter joins could alias distinct
    // inputs onto one cache entry.
    return JSON.stringify([
      this.deps.getLoadKey() ?? "",
      this.context.store.getBaseCards().length,
      this.context.epochs.vaultContent.value,
      this.metadataRevision,
      visibleKeys,
      clauses.map((clause) => [clause.key, clause.values.map(serializePropertyScalarRef)]),
      [
        strings.valueUnassigned,
        strings.valueTrue,
        strings.valueFalse,
        strings.typeText,
        strings.typeNumber,
        strings.typeBoolean,
      ],
    ]);
  }
}
