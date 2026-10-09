export interface SearchTaskDiagnostics {
  elapsedMs: number;
  maxSliceMs: number;
  yields: number;
  phases?: Record<string, number>;
}

// All five hydration jobs share one main-thread budget. Independent 8 ms
// budgets would otherwise accumulate in the same microtask turn.
let activeTasks = 0;
let sharedSliceStart = 0;
let sharedPause: Promise<void> | null = null;
let idleReset: number | null = null;

function pauseTasks(): void {
  sharedPause = new Promise<void>((resolve) => window.setTimeout(() => {
    sharedPause = null;
    sharedSliceStart = performance.now();
    resolve();
  }, 0));
}

/** Checkpoints include copying long lines, rather than only line boundaries. */
export async function runSearchTask<T>(
  task: Generator<unknown, T>,
  isCurrent: () => boolean = () => true,
  onDiagnostics?: (diagnostics: SearchTaskDiagnostics) => void,
): Promise<T | undefined> {
  const start = performance.now();
  activeTasks += 1;
  if (sharedSliceStart === 0) sharedSliceStart = start;
  if (idleReset !== null) { window.clearTimeout(idleReset); idleReset = null; }
  let sliceStart = start;
  let maxSliceMs = 0;
  let yields = 0;
  try {
    while (isCurrent()) {
      if (!sharedPause && performance.now() - sharedSliceStart >= 8) pauseTasks();
      if (sharedPause) {
        yields += 1;
        await sharedPause;
        sliceStart = performance.now();
        continue;
      }
      const step = task.next();
      const now = performance.now();
      const sliceMs = now - sliceStart;
      maxSliceMs = Math.max(maxSliceMs, sliceMs);
      if (step.done) return isCurrent() ? step.value : undefined;
      if (now - sharedSliceStart >= 8) {
        pauseTasks();
      }
    }
    return undefined;
  } finally {
    activeTasks -= 1;
    if (activeTasks === 0 && !sharedPause) {
      idleReset = window.setTimeout(() => { idleReset = null; sharedSliceStart = 0; }, 0);
    }
    task.return(undefined as T);
    onDiagnostics?.({ elapsedMs: performance.now() - start, maxSliceMs, yields });
  }
}
