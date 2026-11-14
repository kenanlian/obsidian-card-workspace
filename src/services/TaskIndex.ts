import type { App, TFile } from "obsidian";

import type { RuntimeWorkGate } from "../runtime/work-gate";
import { buildTaskTree, type TaskFileEntry, type TaskIndexChange, type TaskIndexReader, type TaskNode } from "../tasks";
import type { MetadataChangeEvent } from "./MetadataEventBus";
import type { VaultMutationEvent } from "./vault-events";

/**
 * On-demand runtime cache of root checkbox tasks.
 *
 * `ensure` resolves once every listed Markdown path that still exists has a
 * current entry. A caller `AbortSignal` stops scheduling further reads and
 * rejects that call with `DOMException` `AbortError`. A read already in flight
 * is shared with other callers and may still update the cache. A closed work
 * gate stops further reads and resolves without rejecting. `dispose` cancels
 * in-flight work, rejects an in-flight `ensure` with `AbortError`, and makes
 * later calls no-ops.
 *
 * Vault `modify` is ignored. Obsidian re-parses Markdown and emits
 * `metadataCache` `changed`, which the plugin forwards on the metadata bus.
 * Reading on `modify` would pair the new body with list items that may not
 * have been updated yet. `create` is ignored; views call `ensure` for new
 * members.
 */
export class TaskIndex implements TaskIndexReader {
  private readonly entries = new Map<string, TaskFileEntry>();
  private readonly tracked = new Set<string>();
  private readonly generations = new Map<string, number>();
  private readonly inflight = new Map<string, InFlightRead>();
  private readonly listeners = new Set<(change: TaskIndexChange) => void>();
  private readonly readerWaiters: ReaderWaiter[] = [];
  private readonly lifetime = new AbortController();
  private pendingPaths = new Set<string>();
  private notifyScheduled = false;
  private activeReaders = 0;
  private disposed = false;

  constructor(
    private readonly app: App,
    private readonly workGate: RuntimeWorkGate,
    private readonly readers: number,
  ) {}

  async ensure(paths: readonly string[], signal?: AbortSignal): Promise<void> {
    if (this.disposed) return;
    if (signal?.aborted) throw abortError();
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      unique.push(path);
    }
    if (unique.length === 0) return;

    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (!this.disposed) {
        if (signal?.aborted) throw abortError();
        const index = cursor;
        cursor += 1;
        if (index >= unique.length) return;
        await this.refresh(unique[index] ?? "", false, false, signal);
        if (signal?.aborted) throw abortError();
      }
      throw abortError();
    };
    const workers = Math.min(Math.max(this.readers, 1), unique.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
  }

  get(path: string): TaskFileEntry | null {
    return this.entries.get(path) ?? null;
  }

  subscribe(listener: (change: TaskIndexChange) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async handleMetadataEvent(event: MetadataChangeEvent): Promise<void> {
    if (this.disposed || event.kind !== "changed" || !this.isTracked(event.path)) return;
    this.bump(event.path);
    await this.refreshTracked(event.path);
  }

  /**
   * `delete` drops tracked paths. `rename` moves them and recomputes at the
   * new path. Folder events cover descendants, using a `/` boundary so a
   * prefix lookalike is left alone. `modify` and `create` do nothing.
   */
  async handleVaultMutation(event: VaultMutationEvent): Promise<void> {
    if (this.disposed) return;
    if (event.eventType === "delete") {
      for (const path of this.pathsUnder(event.oldPath ?? event.path, event.isFolder)) this.untrack(path);
      return;
    }
    if (event.eventType !== "rename") return;
    const oldRoot = event.oldPath ?? event.path;
    const paths = this.pathsUnder(oldRoot, event.isFolder);
    const nextPaths: string[] = [];
    for (const path of paths) {
      const next = event.isFolder ? event.path + path.slice(oldRoot.length) : event.path;
      this.moveTracked(path, next);
      nextPaths.push(next);
    }
    await Promise.all(nextPaths.map((path) => this.refreshTracked(path)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    for (const waiter of this.readerWaiters.splice(0)) waiter.reject(abortError());
    this.entries.clear();
    this.tracked.clear();
    this.generations.clear();
    this.inflight.clear();
    this.listeners.clear();
    this.pendingPaths.clear();
  }

  private async refreshTracked(path: string): Promise<void> {
    try {
      await this.refresh(path, true, true);
    } catch (error) {
      if (this.disposed || isAbortError(error)) return;
      throw error;
    }
  }

  private async refresh(path: string, force: boolean, dropIfMissing: boolean, signal?: AbortSignal): Promise<void> {
    let mustRead = force;
    while (!this.disposed) {
      this.throwIfCancelled(signal);
      const seen = this.generationOf(path);
      const pending = this.inflight.get(path);
      if (pending && pending.generation === seen) {
        if (await this.joinRead(path, pending, seen, signal)) {
          mustRead = true;
          continue;
        }
        return;
      }

      const gate = await this.waitUntilReadable(signal);
      if (gate === "abort") this.throwIfCancelled(signal);
      if (gate !== "ready" || this.disposed) return;
      if (this.generationOf(path) !== seen) mustRead = true;
      const afterGate = this.inflight.get(path);
      const generationAfterGate = this.generationOf(path);
      if (afterGate && afterGate.generation === generationAfterGate) {
        if (await this.joinRead(path, afterGate, generationAfterGate, signal)) {
          mustRead = true;
          continue;
        }
        return;
      }

      const file = this.app.vault.getFileByPath(path);
      if (!isMarkdownFile(file)) {
        if (dropIfMissing) this.untrack(path);
        return;
      }
      if (!mustRead && this.entries.get(path)?.mtime === file.stat.mtime && this.generationOf(path) === seen) return;

      await this.acquireReader(signal);
      let joined: InFlightRead | null = null;
      let outcome: ReadOutcome = "current";
      try {
        this.throwIfCancelled(signal);
        const generation = this.generationOf(path);
        if (generation !== seen) mustRead = true;
        const again = this.inflight.get(path);
        const live = this.app.vault.getFileByPath(path);
        if (again && again.generation === generation) {
          joined = again;
        } else if (!isMarkdownFile(live)) {
          if (dropIfMissing) this.untrack(path);
          return;
        } else if (!mustRead && this.entries.get(path)?.mtime === live.stat.mtime) {
          return;
        } else {
          const promise = this.readFile(live, generation);
          this.inflight.set(path, { generation, promise });
          outcome = await promise;
        }
      } finally {
        this.releaseReader();
      }
      if (joined) {
        if (await this.joinRead(path, joined, joined.generation, signal)) {
          mustRead = true;
          continue;
        }
        return;
      }
      this.throwIfCancelled(signal);
      if (outcome === "stale" && this.generationOf(path) !== seen) {
        mustRead = true;
        continue;
      }
      return;
    }
    this.throwIfCancelled(signal);
  }

  /** Returns true when the caller must read again because a newer generation won. */
  private async joinRead(path: string, pending: InFlightRead, generation: number, signal?: AbortSignal): Promise<boolean> {
    const outcome = await pending.promise;
    this.throwIfCancelled(signal);
    return outcome === "stale" || this.generationOf(path) !== generation;
  }

  private readFile(file: TFile, generation: number): Promise<ReadOutcome> {
    const path = file.path;
    let promise!: Promise<ReadOutcome>;
    promise = this.readFileBody(file, generation).finally(() => {
      const current = this.inflight.get(path);
      if (current?.promise === promise) this.inflight.delete(path);
    });
    return promise;
  }

  private async readFileBody(file: TFile, generation: number): Promise<ReadOutcome> {
    const path = file.path;
    if (this.disposed) throw abortError();
    if (this.generationOf(path) !== generation) return "stale";
    this.tracked.add(path);
    const mtime = file.stat.mtime;
    const cache = this.app.metadataCache.getFileCache(file);
    const listItems = Array.isArray(cache?.listItems) ? cache.listItems : [];
    const hasTask = cache !== null && listItems.some((item) => typeof item.task === "string");
    let roots: readonly TaskNode[] = [];
    if (hasTask) {
      let content: string;
      try {
        content = await this.app.vault.cachedRead(file);
      } catch (error) {
        if (this.disposed) throw abortError();
        if (this.generationOf(path) !== generation) return "stale";
        console.warn("[Card Workspace] Task index read failed.", error);
        return "current";
      }
      if (this.disposed) throw abortError();
      if (this.generationOf(path) !== generation) return "stale";
      roots = buildTaskTree(listItems, content);
    }
    if (this.disposed) throw abortError();
    if (this.generationOf(path) !== generation) return "stale";
    this.commit(path, { path, mtime, roots });
    return "current";
  }

  private commit(path: string, entry: TaskFileEntry): void {
    this.tracked.add(path);
    const previous = this.entries.get(path);
    if (previous && previous.mtime === entry.mtime && sameRoots(previous.roots, entry.roots)) return;
    this.entries.set(path, entry);
    this.markChanged(path);
  }

  private untrack(path: string): void {
    this.bump(path);
    const hadEntry = this.entries.delete(path);
    this.tracked.delete(path);
    if (hadEntry) this.markChanged(path);
  }

  private moveTracked(from: string, to: string): void {
    if (from === to) return;
    this.bump(from);
    this.bump(to);
    this.tracked.delete(from);
    const entry = this.entries.get(from);
    this.entries.delete(from);
    this.tracked.add(to);
    if (!entry) return;
    this.entries.set(to, { path: to, mtime: entry.mtime, roots: entry.roots });
    this.markChanged(from);
    this.markChanged(to);
  }

  private isTracked(path: string): boolean {
    return this.tracked.has(path) || this.entries.has(path) || this.inflight.has(path);
  }

  private pathsUnder(root: string, folder: boolean): string[] {
    const known = new Set<string>([...this.tracked, ...this.entries.keys(), ...this.inflight.keys()]);
    if (!folder) return known.has(root) ? [root] : [];
    if (root.length === 0) return [...known];
    const prefix = `${root}/`;
    return [...known].filter((path) => path === root || path.startsWith(prefix));
  }

  private generationOf(path: string): number {
    return this.generations.get(path) ?? 0;
  }

  private bump(path: string): void {
    this.generations.set(path, this.generationOf(path) + 1);
  }

  private async waitUntilReadable(signal?: AbortSignal): Promise<"ready" | "abort" | "closed"> {
    const linked = linkSignals(this.lifetime.signal, signal);
    try {
      const allowed = await this.workGate.wait(linked.signal);
      if (signal?.aborted || this.disposed) return "abort";
      return allowed ? "ready" : "closed";
    } finally {
      linked.dispose();
    }
  }

  private acquireReader(signal?: AbortSignal): Promise<void> {
    this.throwIfCancelled(signal);
    if (this.activeReaders < Math.max(this.readers, 1)) {
      this.activeReaders += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter: ReaderWaiter = { signal, grant: () => resolve(), reject };
      const onAbort = () => {
        const index = this.readerWaiters.indexOf(waiter);
        if (index >= 0) this.readerWaiters.splice(index, 1);
        cleanup();
        reject(abortError());
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        this.lifetime.signal.removeEventListener("abort", onAbort);
      };
      waiter.grant = () => {
        cleanup();
        resolve();
      };
      this.readerWaiters.push(waiter);
      signal?.addEventListener("abort", onAbort, { once: true });
      this.lifetime.signal.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted || this.lifetime.signal.aborted) onAbort();
    });
  }

  private releaseReader(): void {
    if (!this.disposed) {
      while (this.readerWaiters.length > 0) {
        const next = this.readerWaiters.shift();
        if (!next) break;
        if (next.signal?.aborted || this.disposed) {
          next.reject(abortError());
          continue;
        }
        next.grant();
        return;
      }
    }
    this.activeReaders = Math.max(0, this.activeReaders - 1);
  }

  private throwIfCancelled(signal?: AbortSignal): void {
    if (signal?.aborted || this.disposed) throw abortError();
  }

  private markChanged(path: string): void {
    if (this.disposed) return;
    this.pendingPaths.add(path);
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      if (this.disposed) {
        this.pendingPaths.clear();
        return;
      }
      if (this.pendingPaths.size === 0) return;
      const change: TaskIndexChange = { paths: this.pendingPaths };
      this.pendingPaths = new Set();
      for (const listener of [...this.listeners]) {
        try {
          listener(change);
        } catch (error) {
          console.warn("[Card Workspace] Task index listener failed.", error);
        }
      }
    });
  }
}

type ReadOutcome = "current" | "stale";

interface InFlightRead {
  readonly generation: number;
  readonly promise: Promise<ReadOutcome>;
}

interface ReaderWaiter {
  readonly signal: AbortSignal | undefined;
  grant: () => void;
  reject: (error: unknown) => void;
}

function isMarkdownFile(file: TFile | null): file is TFile {
  return file !== null && file.extension.toLowerCase() === "md";
}

function sameRoots(left: readonly TaskNode[], right: readonly TaskNode[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || a.line !== b.line || a.lineText !== b.lineText || !sameRoots(a.children, b.children)) return false;
  }
  return true;
}

function abortError(): DOMException {
  return new DOMException("The task index read was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function linkSignals(primary: AbortSignal, extra?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
  if (!extra || extra === primary) return { signal: primary, dispose: () => {} };
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (primary.aborted || extra.aborted) {
    controller.abort();
    return { signal: controller.signal, dispose: () => {} };
  }
  primary.addEventListener("abort", abort, { once: true });
  extra.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      primary.removeEventListener("abort", abort);
      extra.removeEventListener("abort", abort);
    },
  };
}
