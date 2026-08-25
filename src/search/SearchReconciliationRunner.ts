import type { SearchIndexHealthSnapshot, SearchIndexSuccessOutcome } from "./types";

/** FIFO async mutex shared by incremental mutations and replacement cutovers. */
export class SearchMutationGate {
  private locked = false;
  private readonly waiters: Array<(release: () => void) => void> = [];

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return this.createRelease();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiters.shift();
      if (next) next(this.createRelease());
      else this.locked = false;
    };
  }
}

/** Serializes source-wide scans and owns their cancellation lifetime. */
export class SearchReconciliationRunner {
  private tail: Promise<void> = Promise.resolve();
  private activeController: AbortController | null = null;
  private disposed = false;
  private generation = 0;

  run(operation: (signal: AbortSignal, isCurrent: () => boolean) => Promise<void>): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const generation = this.generation;
    const run = this.tail.then(async () => {
      if (this.disposed || generation !== this.generation) return;
      const controller = new AbortController();
      this.activeController = controller;
      const isCurrent = () => !this.disposed && generation === this.generation && !controller.signal.aborted;
      try {
        await operation(controller.signal, isCurrent);
      } finally {
        if (this.activeController === controller) this.activeController = null;
      }
    });
    this.tail = run.catch(() => undefined);
    return run;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
  }
}

export function hasPathPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function rewritePathPrefix(path: string, oldPrefix: string, newPrefix: string): string {
  return path === oldPrefix ? newPrefix : `${newPrefix}${path.slice(oldPrefix.length)}`;
}

export function rewriteFolderPath(folderPath: string, oldPrefix: string, newPrefix: string): string {
  return folderPath === oldPrefix || folderPath.startsWith(`${oldPrefix}/`)
    ? rewritePathPrefix(folderPath, oldPrefix, newPrefix)
    : folderPath;
}

export function countNonOverlappingLiteralOccurrences(haystack: string, needle: string): number {
  if (!needle || !haystack) return 0;
  let count = 0;
  let start = 0;
  while (start < haystack.length) {
    const match = haystack.indexOf(needle, start);
    if (match === -1) break;
    count += 1;
    start = match + needle.length;
  }
  return count;
}

export function createSearchSuccessSnapshot(
  outcome: SearchIndexSuccessOutcome,
  documentCount: number,
  at: number,
  detail: string | null,
): SearchIndexHealthSnapshot["lastSuccessfulBuild"] {
  return { outcome, at, documentCount, detail };
}

export function searchErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
