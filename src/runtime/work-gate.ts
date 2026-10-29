/** Cooperative admission gate. Waiting never owns a mutation or persistence lock. */
export class RuntimeWorkGate {
  private active = true;
  private closed = false;
  private readonly listeners = new Set<(active: boolean) => void>();
  private readonly waiters = new Set<(allowed: boolean) => void>();

  get isActive(): boolean { return this.active && !this.closed; }
  get isClosed(): boolean { return this.closed; }
  get isPaused(): boolean { return !this.active && !this.closed; }

  setActive(active: boolean): void {
    if (this.closed || this.active === active) return;
    this.active = active;
    if (active) this.releaseWaiters(true);
    for (const listener of this.listeners) listener(active);
  }

  /** No initial notification: constructors may subscribe before host assembly. */
  subscribe(listener: (active: boolean) => void): () => void {
    if (this.closed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  wait(signal?: AbortSignal): Promise<boolean> {
    if (this.closed || signal?.aborted) return Promise.resolve(false);
    if (this.active) return Promise.resolve(true);
    return new Promise((resolve) => {
      const finish = (allowed: boolean) => {
        this.waiters.delete(finish);
        signal?.removeEventListener("abort", cancel);
        resolve(allowed);
      };
      const cancel = () => finish(false);
      this.waiters.add(finish);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }

  private releaseWaiters(allowed: boolean): void {
    for (const waiter of this.waiters) waiter(allowed);
    this.waiters.clear();
  }

  getDiagnostics() { return { paused: this.isPaused, closed: this.closed, waiters: this.waiters.size }; }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.releaseWaiters(false);
    for (const listener of this.listeners) listener(false);
    this.listeners.clear();
  }
}
