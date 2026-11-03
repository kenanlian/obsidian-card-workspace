import { TFile, type App } from "obsidian";
import { serializePropertyScalarRef, type PropertyScalarRef } from "../property-filter-settings";
import type { RuntimeWorkGate } from "../runtime/work-gate";
import { scheduleIdleTask } from "../search";
import { getTagEntriesFromCache } from "../view/metadata-utils";
import { extractPropertyScalars, type PropertyKeyExtraction } from "../view/property-metadata";
import type { PropertyFacet } from "../view/property-facets";
import type { MetadataChangeEvent } from "./MetadataEventBus";
import type { VaultMutationEvent } from "./vault-events";

export interface NavigationMetadataSnapshot {
  readonly ready: boolean;
  readonly tags: readonly string[];
  readonly properties: readonly { key: string; label: string; values: readonly PropertyScalarRef[] }[];
}

interface Contribution { tags: string[]; properties: PropertyKeyExtraction[] }
interface PropertyAggregate {
  labels: Map<string, number>;
  values: Map<string, { ref: PropertyScalarRef; count: number }>;
}

export interface NavigationMetadataCatalogDeps {
  getApp: () => App;
  workGate?: RuntimeWorkGate;
  scheduleIdle?: (task: () => void, timeoutMs: number) => () => void;
  yieldTask?: () => Promise<void>;
  scheduleTimer?: (task: () => void, delayMs: number) => () => void;
}

/** Shared cache of metadata identities. Counts remain owned by the current scope. */
export class NavigationMetadataCatalog {
  private readonly contributions = new Map<string, Contribution>();
  private readonly tags = new Map<string, number>();
  private readonly properties = new Map<string, PropertyAggregate>();
  private readonly missingCaches = new Set<string>();
  private readonly scopeTags = new Set<string>();
  private readonly scopeProperties = new Map<string, { label: string; values: Map<string, PropertyScalarRef> }>();
  private lastScopeTags: readonly string[] | null = null;
  private lastScopeProperties: readonly PropertyFacet[] | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly lifetime = new AbortController();
  private snapshot: NavigationMetadataSnapshot | null = null;
  private notification: (() => void) | null = null;
  private cancelIdle: (() => void) | null = null;
  private started = false;
  private ready = false;
  private disposed = false;

  constructor(private readonly deps: NavigationMetadataCatalogDeps) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  getSnapshot(): NavigationMetadataSnapshot {
    if (this.snapshot) return this.snapshot;
    const properties = new Map([...this.properties].map(([key, entry]) => [key, {
      key, label: [...entry.labels.keys()].sort()[0] ?? key,
      values: new Map([...entry.values].map(([id, { ref }]) => [id, ref])),
    }]));
    for (const [key, seeded] of this.scopeProperties) {
      const entry = properties.get(key) ?? { key, label: seeded.label, values: new Map<string, PropertyScalarRef>() };
      if (seeded.label < entry.label) entry.label = seeded.label;
      for (const [id, ref] of seeded.values) entry.values.set(id, ref);
      properties.set(key, entry);
    }
    return this.snapshot = {
      ready: this.ready,
      tags: [...new Set([...this.tags.keys(), ...this.scopeTags])].sort((a, b) => a.localeCompare(b)),
      properties: [...properties.values()].map(entry => ({
        key: entry.key, label: entry.label, values: [...entry.values.values()].map(ref => ({ ...ref })),
      })).sort((a, b) => a.key.localeCompare(b.key)),
    };
  }

  /** Foreground seeding reuses scope identities without another per-file cache walk. */
  seedScope(tags: readonly string[], propertyFacets: readonly PropertyFacet[]): void {
    if (this.disposed || this.ready || (tags === this.lastScopeTags && propertyFacets === this.lastScopeProperties)) return;
    this.lastScopeTags = tags;
    this.lastScopeProperties = propertyFacets;
    let changed = false;
    for (const tag of tags) {
      if (!this.scopeTags.has(tag)) { this.scopeTags.add(tag); changed = true; }
    }
    for (const facet of propertyFacets) {
      let entry = this.scopeProperties.get(facet.key);
      if (!entry) {
        entry = { label: facet.label, values: new Map() };
        this.scopeProperties.set(facet.key, entry);
        changed = true;
      } else if (facet.label < entry.label) { entry.label = facet.label; changed = true; }
      for (const { ref } of facet.values) {
        if (ref.kind === "missing") continue;
        const id = serializePropertyScalarRef(ref);
        if (!entry.values.has(id)) { entry.values.set(id, { ...ref }); changed = true; }
      }
    }
    if (changed) this.changed();
  }

  /** Explicit file seeding for internal callers; foreground navigation uses seedScope. */
  seedFiles(files: readonly TFile[]): void {
    if (this.disposed) return;
    for (const file of files) {
      if (file.extension.toLowerCase() === "md" && !this.contributions.has(file.path)) this.refreshFile(file);
    }
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.cancelIdle = (this.deps.scheduleIdle ?? scheduleIdleTask)(() => {
      this.cancelIdle = null;
      void this.scan().catch((error: unknown) => {
        if (!this.disposed) console.warn("[Card Workspace] Navigation metadata catalog failed.", error);
      });
    }, 10_000);
  }

  private async scan(): Promise<void> {
    if (this.deps.workGate && !(await this.deps.workGate.wait(this.lifetime.signal))) return;
    if (this.disposed) return;
    const files = this.deps.getApp().vault.getMarkdownFiles();
    for (let offset = 0; offset < files.length; offset += 200) {
      if (this.deps.workGate && !(await this.deps.workGate.wait(this.lifetime.signal))) return;
      if (this.disposed) return;
      for (const candidate of files.slice(offset, offset + 200)) {
        // Resolve live identity after each yield: deleted/renamed files cannot resurrect metadata.
        const file = this.deps.getApp().vault.getAbstractFileByPath(candidate.path);
        if (file === candidate) this.refreshFile(candidate);
      }
      if (offset + 200 < files.length) await this.yieldTask();
    }
    if (this.disposed) return;
    this.ready = true;
    this.clearScopeSeeds();
    this.changed();
  }

  private clearScopeSeeds(): void {
    this.scopeTags.clear(); this.scopeProperties.clear();
    this.lastScopeTags = null; this.lastScopeProperties = null;
  }

  handleMetadataChange(event: MetadataChangeEvent): void | Promise<void> {
    if (this.disposed) return;
    if (event.path.length === 0) {
      // Host-wide resolution completes previously absent caches without another vault enumeration.
      return this.refreshMissingCaches();
    }
    this.refreshPath(event.path);
  }

  private async refreshMissingCaches(): Promise<void> {
    const paths = [...this.missingCaches];
    for (let offset = 0; offset < paths.length; offset += 200) {
      if (this.disposed) return;
      for (const path of paths.slice(offset, offset + 200)) this.refreshPath(path);
      if (offset + 200 < paths.length) await this.yieldTask();
    }
  }

  handleVaultMutation(event: VaultMutationEvent): void {
    if (this.disposed) return;
    const oldPath = event.oldPath ?? event.path;
    if (event.eventType === "delete" || event.eventType === "rename") {
      const candidates = event.isFolder ? new Set([...this.contributions.keys(), ...this.missingCaches]) : [oldPath];
      for (const path of candidates) {
        if (path !== oldPath && !(event.isFolder && path.startsWith(`${oldPath}/`))) continue;
        if (event.eventType === "rename") {
          const nextPath = event.path + path.slice(oldPath.length);
          const previous = this.contributions.get(path);
          if (nextPath !== path) {
            this.remove(nextPath);
            this.contributions.delete(path);
            this.missingCaches.delete(path);
            if (previous) this.contributions.set(nextPath, previous);
          }
          this.refreshPath(nextPath);
        } else this.remove(path);
      }
    }
    if (!event.isFolder && event.eventType !== "delete") this.refreshPath(event.path);
  }

  private refreshPath(path: string): void {
    const file = this.deps.getApp().vault.getAbstractFileByPath(path);
    if (file instanceof TFile && file.extension.toLowerCase() === "md") this.refreshFile(file);
    else this.remove(path);
  }

  private refreshFile(file: TFile): void {
    const cache = this.deps.getApp().metadataCache.getFileCache(file);
    if (cache) this.missingCaches.delete(file.path); else this.missingCaches.add(file.path);
    // Cache absence is transient; only an explicit vault deletion removes known identities.
    if (!cache && this.contributions.has(file.path)) return;
    const next: Contribution = {
      tags: getTagEntriesFromCache(cache).map(entry => entry.display),
      properties: extractPropertyScalars(cache?.frontmatter ?? null),
    };
    const previous = this.contributions.get(file.path);
    // Per-file metadata is small; equality avoids repainting on unrelated cache events.
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return;
    this.remove(file.path);
    if (!cache) this.missingCaches.add(file.path);
    this.contributions.set(file.path, next);
    for (const tag of next.tags) this.tags.set(tag, (this.tags.get(tag) ?? 0) + 1);
    for (const entry of next.properties) {
      const aggregate = this.properties.get(entry.key) ?? { labels: new Map<string, number>(), values: new Map<string, { ref: PropertyScalarRef; count: number }>() };
      this.properties.set(entry.key, aggregate);
      aggregate.labels.set(entry.label, (aggregate.labels.get(entry.label) ?? 0) + 1);
      for (const ref of entry.values) {
        const id = serializePropertyScalarRef(ref);
        const value = aggregate.values.get(id);
        aggregate.values.set(id, { ref, count: (value?.count ?? 0) + 1 });
      }
    }
    this.changed();
  }

  private remove(path: string): void {
    this.missingCaches.delete(path);
    const previous = this.contributions.get(path);
    if (!previous) return;
    this.contributions.delete(path);
    for (const tag of previous.tags) {
      const remaining = (this.tags.get(tag) ?? 1) - 1;
      if (remaining > 0) this.tags.set(tag, remaining); else this.tags.delete(tag);
    }
    for (const entry of previous.properties) {
      const aggregate = this.properties.get(entry.key);
      if (!aggregate) continue;
      const remaining = (aggregate.labels.get(entry.label) ?? 1) - 1;
      if (remaining > 0) aggregate.labels.set(entry.label, remaining); else aggregate.labels.delete(entry.label);
      for (const ref of entry.values) {
        const id = serializePropertyScalarRef(ref);
        const value = aggregate.values.get(id);
        if (value && value.count > 1) value.count--; else aggregate.values.delete(id);
      }
      if (aggregate.labels.size === 0) this.properties.delete(entry.key);
    }
    this.changed();
  }

  private changed(): void {
    this.snapshot = null;
    if (this.notification !== null || this.disposed) return;
    this.notification = this.scheduleTimer(() => {
      this.notification = null;
      for (const listener of this.listeners) listener();
    }, 250);
  }

  private scheduleTimer(task: () => void, delayMs: number): () => void {
    if (this.deps.scheduleTimer) return this.deps.scheduleTimer(task, delayMs);
    const id = window.setTimeout(task, delayMs);
    return () => window.clearTimeout(id);
  }

  private yieldTask(): Promise<void> {
    return this.deps.yieldTask?.() ?? new Promise<void>(resolve => { this.scheduleTimer(resolve, 0); });
  }

  dispose(): void {
    this.disposed = true;
    this.lifetime.abort();
    this.cancelIdle?.();
    this.notification?.();
    this.listeners.clear(); this.contributions.clear(); this.tags.clear(); this.properties.clear();
    this.missingCaches.clear();
    this.clearScopeSeeds();
  }
}
