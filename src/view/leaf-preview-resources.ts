import { PreviewCache } from "./preview-cache";
import { SearchPreviewSourceCache } from "../search";
import type { RuntimeResourceBudget } from "../runtime/resource-budget";

/** One admission pool and bounded cache per desktop leaf, shared by its streams. */
export class LeafPreviewResources {
  readonly cache: PreviewCache;
  readonly searchSources: SearchPreviewSourceCache;
  private active = 0;
  private closed = false;
  private current: object | null = null;
  private lastOwner: object | null = null;
  private readonly queue: Array<{ owner: object; valid: () => boolean; run: () => Promise<void>; resolve: () => void }> = [];

  constructor(private readonly budget: RuntimeResourceBudget) {
    this.cache = new PreviewCache(budget.preview.entries, budget.preview.diagramBytes);
    this.searchSources = new SearchPreviewSourceCache(budget.searchPreview.bytes, budget.searchPreview.entries);
  }
  setCurrent(owner: object | null): void { this.current = owner; this.pump(); }
  run(owner: object, valid: () => boolean, run: () => Promise<void>): Promise<void> {
    if (this.closed || !valid()) return Promise.resolve();
    return new Promise(resolve => { this.queue.push({ owner, valid, run, resolve }); this.pump(); });
  }
  cancel(owner: object): void {
    for (let index = this.queue.length - 1; index >= 0; index--) {
      if (this.queue[index]?.owner === owner) this.queue.splice(index, 1)[0]?.resolve();
    }
  }
  private pump(): void {
    while (!this.closed && this.active < this.budget.preview.concurrency && this.queue.length) {
      // Alternate owners when possible; the current stream wins the first turn.
      let index = this.queue.findIndex(job => job.owner !== this.lastOwner && job.owner === this.current);
      if (index < 0) index = this.queue.findIndex(job => job.owner !== this.lastOwner);
      const job = this.queue.splice(Math.max(0, index), 1)[0];
      if (!job) return;
      if (!job.valid()) { job.resolve(); continue; }
      this.active++;
      this.lastOwner = job.owner;
      void job.run().catch(error => console.warn("[Card Workspace] Preview job failed", error)).finally(() => {
        this.active--; job.resolve(); this.pump();
      });
    }
  }
  getDiagnostics() { return { active: this.active, queued: this.queue.length, cacheEntries: this.cache.size, diagramBytes: this.cache.diagramBytes }; }
  dispose(): void {
    this.closed = true;
    this.queue.splice(0).forEach(job => job.resolve());
    this.cache.clear(); this.searchSources.clear();
  }
}
