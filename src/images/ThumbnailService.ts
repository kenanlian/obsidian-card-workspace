import { IMAGE_MAX_BYTES, MEMORY_MAX_BYTES, MEMORY_MAX_ENTRIES, imageKey,
  type ImageFingerprint, type ThumbnailGenerator, type ThumbnailResult, type ThumbnailStorage } from "./types";
interface Consumer { signal: AbortSignal; canGenerate: () => boolean; onEligible: () => void; resolve: (result: ThumbnailResult) => void; abort: () => void }
interface Job { fingerprint: ImageFingerprint; key: string; consumers: Set<Consumer>; eligible: boolean; invalidated?: boolean; step?: string; phase: "cache" | "queued" | "active" }
export interface ThumbnailServiceDeps {
  storage: ThumbnailStorage;
  generator: ThumbnailGenerator;
  read: (fingerprint: ImageFingerprint) => Promise<ArrayBuffer>;
  isCurrent: (fingerprint: ImageFingerprint) => boolean;
}
/** Plugin-wide single cold task, dedupe, bounded Blob LRU and demand-only persistence. */
export class ThumbnailService {
  private readonly memory = new Map<string, Blob>();
  private readonly touched = new Map<string, number>();
  private readonly outcomes = new Map<string, ThumbnailResult>();
  private readonly jobs = new Map<string, Job>();
  private bytes = 0;
  private active = false;
  private coldTurn: number | null = null;
  private disposed = false;
  private owners = 0;
  constructor(private readonly deps: ThumbnailServiceDeps) {}
  acquire(): () => void {
    this.owners++;
    let released = false;
    return () => { if (released) return; released = true; if (--this.owners === 0) { if (this.coldTurn !== null) window.clearTimeout(this.coldTurn); this.coldTurn = null; this.deps.generator.dispose(); this.deps.storage.close(); } };
  }
  request(fingerprint: ImageFingerprint, options: { signal: AbortSignal; canGenerate: () => boolean; onEligible: () => void }): Promise<ThumbnailResult> {
    if (this.disposed || options.signal.aborted || !this.deps.isCurrent(fingerprint)) return Promise.resolve({ status: "skipped" });
    const key = imageKey(fingerprint), cached = this.memory.get(key);
    if (cached) { this.memory.delete(key); this.memory.set(key, cached);
      if (Date.now() - (this.touched.get(key) ?? 0) >= 30_000) { this.touched.set(key, Date.now()); void this.deps.storage.touch?.(key).catch(() => undefined); }
      return Promise.resolve({ status: "ready", blob: cached }); }
    const outcome = this.outcomes.get(key);
    if (outcome) return Promise.resolve(outcome);
    if (fingerprint.size <= 0 || fingerprint.size > IMAGE_MAX_BYTES) return Promise.resolve({ status: "skipped" });
    return new Promise((resolve) => {
      let job = this.jobs.get(key);
      const fresh = !job;
      if (!job) { job = { fingerprint, key, consumers: new Set(), eligible: false, phase: "cache" }; this.jobs.set(key, job); }
      const currentJob = job;
      const consumer: Consumer = { ...options, resolve, abort: () => {
        currentJob.consumers.delete(consumer); resolve({ status: "skipped" });
        if (!currentJob.consumers.size && currentJob.phase !== "active") this.jobs.delete(key);
        this.pump();
      } };
      job.consumers.add(consumer);
      options.signal.addEventListener("abort", consumer.abort, { once: true });
      if (job.eligible) options.onEligible();
      if (fresh) void this.lookup(job);
      else this.pump();
    });
  }
  invalidate(paths: readonly string[], prefix: boolean): void {
    const matches = (path: string): boolean => paths.some((root) => path === root || (prefix && path.startsWith(`${root}/`)));
    for (const key of [...this.memory.keys(), ...this.outcomes.keys()]) {
      if (matches((JSON.parse(key) as string[])[1])) { this.remove(key); this.outcomes.delete(key); }
    }
    for (const job of this.jobs.values()) if (matches(job.fingerprint.path)) { job.invalidated = true; this.finish(job, { status: "skipped" }); }
    void this.deps.storage.invalidate?.(paths, prefix).catch(() => undefined);
  }
  private valid(job: Job): boolean { return !this.disposed && !job.invalidated && this.deps.isCurrent(job.fingerprint); }
  private async lookup(job: Job): Promise<void> {
    let blob: Blob | null = null;
    try { blob = await this.deps.storage.get(job.key); } catch { /* memory-only operation */ }
    if (this.jobs.get(job.key) !== job || this.disposed) return;
    if (!this.valid(job)) { this.finish(job, { status: "skipped" }); return; }
    if (blob) { this.remember(job.key, blob); this.finish(job, { status: "ready", blob }); return; }
    if (!this.deps.generator.available()) { this.finish(job, { status: "skipped" }); return; }
    job.phase = "queued";
    this.pump();
  }
  /** Called after visible text hydration settles or demand changes. Cache lookup never waits. */
  pump(): void {
    if (this.disposed || this.active || this.coldTurn !== null || ![...this.jobs.values()].some((job) => job.phase === "queued")) return;
    // Let the foreground card paint and its ResizeObserver demand settle first.
    // Cache hits bypass this cold-only turn entirely.
    this.coldTurn = window.setTimeout(() => { this.coldTurn = null; this.runNext(); }, 32);
  }
  private runNext(): void {
    if (this.disposed || this.active) return;
    const job = [...this.jobs.values()].find((item) => item.phase === "queued" && [...item.consumers].some((owner) => !owner.signal.aborted && owner.canGenerate()));
    if (!job) return;
    if (!this.valid(job)) { this.finish(job, { status: "skipped" }); this.pump(); return; }
    job.phase = "active"; this.active = true;
    void this.generate(job).finally(() => { this.active = false; this.pump(); });
  }
  private async generate(job: Job): Promise<void> {
    let result: ThumbnailResult = { status: "skipped" };
    try {
      if (this.deps.generator.available() && this.valid(job)) {
        job.step = "read";
        const buffer = await this.deps.read(job.fingerprint);
        if (this.valid(job) && buffer.byteLength <= IMAGE_MAX_BYTES && job.consumers.size) {
          job.step = "render";
          result = await this.deps.generator.generate(buffer, () => {
            if (!this.valid(job)) return;
            job.eligible = true;
            for (const consumer of job.consumers) if (!consumer.signal.aborted) consumer.onEligible();
          });
        }
      }
    } catch { result = { status: job.eligible ? "failed" : "skipped" }; }
    if (result.status === "failed" && !job.eligible) result = { status: "skipped" };
    if (!this.valid(job)) result = { status: "skipped" };
    else if (result.status === "ready") {
      this.remember(job.key, result.blob);
      // Cache the completed current fingerprint even if its viewport has left.
      job.step = "persist";
      try { await this.deps.storage.put(job.key, result.blob); } catch { /* bounded memory remains usable */ }
      if (!this.valid(job)) { this.remove(job.key); result = { status: "skipped" }; }
    } else if (job.consumers.size > 0) { this.outcomes.set(job.key, result); if (this.outcomes.size > MEMORY_MAX_ENTRIES) this.outcomes.delete(this.outcomes.keys().next().value!); }
    this.finish(job, result);
  }
  private finish(job: Job, result: ThumbnailResult): void {
    if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
    for (const consumer of job.consumers) { consumer.signal.removeEventListener("abort", consumer.abort); consumer.resolve(result); }
    job.consumers.clear();
  }
  private remove(key: string): void { const blob = this.memory.get(key); if (blob) this.bytes -= blob.size; this.memory.delete(key); this.touched.delete(key); }
  private remember(key: string, blob: Blob): void {
    this.remove(key);
    if (blob.size > MEMORY_MAX_BYTES) return;
    this.memory.set(key, blob); this.touched.set(key, Date.now()); this.bytes += blob.size;
    while (this.memory.size > MEMORY_MAX_ENTRIES || this.bytes > MEMORY_MAX_BYTES) this.remove(this.memory.keys().next().value!);
  }
  getDiagnostics(): { entries: number; bytes: number; jobs: number; active: number; owners: number } {
    return { entries: this.memory.size, bytes: this.bytes, jobs: this.jobs.size, active: Number(this.active), owners: this.owners };
  }
  dispose(): void {
    this.disposed = true;
    if (this.coldTurn !== null) window.clearTimeout(this.coldTurn);
    this.coldTurn = null;
    for (const job of this.jobs.values()) this.finish(job, { status: "skipped" });
    this.memory.clear(); this.touched.clear(); this.outcomes.clear(); this.bytes = 0;
    this.deps.generator.dispose(); this.deps.storage.close();
  }
}
