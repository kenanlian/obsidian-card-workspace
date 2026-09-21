type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };

type IdleCapableWindow = typeof globalThis & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Runs `task` once the host is idle, falling back to a timer where
 * `requestIdleCallback` is unavailable. `timeoutMs` bounds how long the task
 * may be deferred so index work still lands on a permanently busy app.
 */
export function scheduleIdleTask(task: () => void, timeoutMs: number): () => void {
  const host = globalThis as IdleCapableWindow;
  if (typeof host.requestIdleCallback === "function" && typeof host.cancelIdleCallback === "function") {
    const handle = host.requestIdleCallback(() => task(), { timeout: timeoutMs });
    const cancel = host.cancelIdleCallback;
    return () => cancel.call(host, handle);
  }

  const handle = setTimeout(task, timeoutMs);
  return () => clearTimeout(handle);
}
