export interface SearchTaskDiagnostics {
  elapsedMs: number;
  maxSliceMs: number;
  yields: number;
  phases?: Record<string, number>;
}

/** Schedule a future task, giving rendering and input a turn before resuming. */
export type SearchTaskScheduler = (resume: () => void) => void;

/** MessageChannel avoids nested-timer clamping; older hosts retain timers. */
export const scheduleSearchTask: SearchTaskScheduler = (resume) => {
  if (typeof window.MessageChannel === "function") {
    const channel = new window.MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resume();
    };
    channel.port2.postMessage(null);
  } else window.setTimeout(resume, 0);
};

// A custom scheduler must never make a checkpoint resume synchronously.
function scheduleAsync(scheduler: SearchTaskScheduler, resume: () => void): void {
  let scheduling = true;
  scheduler(() => {
    if (scheduling) window.setTimeout(resume, 0);
    else resume();
  });
  scheduling = false;
}

// All five hydration jobs share one main-thread budget. Independent 8 ms
// budgets would otherwise accumulate in the same microtask turn.
let activeTasks = 0;
let sharedSliceStart = 0;
let sharedPause: Promise<void> | null = null;
let idleResetToken = 0;

function pauseTasks(scheduler: SearchTaskScheduler): void {
  sharedPause = new Promise<void>((resolve) => scheduleAsync(scheduler, () => {
    sharedPause = null;
    sharedSliceStart = performance.now();
    resolve();
  }));
}

/** Checkpoints include copying long lines, rather than only line boundaries. */
export async function runSearchTask<T>(
  task: Generator<unknown, T>,
  isCurrent: () => boolean = () => true,
  onDiagnostics?: (diagnostics: SearchTaskDiagnostics) => void,
  scheduler: SearchTaskScheduler = scheduleSearchTask,
): Promise<T | undefined> {
  const start = performance.now();
  activeTasks += 1;
  if (sharedSliceStart === 0) sharedSliceStart = start;
  idleResetToken += 1;
  let sliceStart = start;
  let maxSliceMs = 0;
  let yields = 0;
  try {
    while (isCurrent()) {
      if (!sharedPause && performance.now() - sharedSliceStart >= 8) pauseTasks(scheduler);
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
        pauseTasks(scheduler);
      }
    }
    return undefined;
  } finally {
    activeTasks -= 1;
    if (activeTasks === 0 && !sharedPause) {
      const resetToken = ++idleResetToken;
      scheduleAsync(scheduler, () => {
        if (resetToken === idleResetToken && activeTasks === 0) sharedSliceStart = 0;
      });
    }
    task.return(undefined as T);
    onDiagnostics?.({ elapsedMs: performance.now() - start, maxSliceMs, yields });
  }
}
