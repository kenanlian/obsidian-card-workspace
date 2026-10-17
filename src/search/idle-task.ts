type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * Runs `task` once the host is idle, falling back to a timer where
 * `requestIdleCallback` is unavailable. `timeoutMs` bounds how long the task
 * may be deferred so index work still lands on a permanently busy app.
 *
 * The timer stays on the main `window`. Index work is not owned by whichever
 * popout happens to be focused, and a closing popout must not cancel it.
 */
export function scheduleIdleTask(task: () => void, timeoutMs: number): () => void {
  const host: IdleCapableWindow = window;
  if (typeof host.requestIdleCallback === "function" && typeof host.cancelIdleCallback === "function") {
    const handle = host.requestIdleCallback(() => task(), { timeout: timeoutMs });
    const cancel = host.cancelIdleCallback.bind(host);
    return () => cancel(handle);
  }

  const handle = window.setTimeout(task, timeoutMs);
  return () => window.clearTimeout(handle);
}
