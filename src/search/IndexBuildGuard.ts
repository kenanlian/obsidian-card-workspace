/**
 * Consecutive incomplete full builds tolerated before automatic rebuilding is
 * suspended. A build that hard-freezes or crashes the renderer never clears its
 * attempt marker, so without this ceiling every subsequent launch would repeat
 * the same freeze and leave uninstalling as the only escape.
 */
export const MAX_CONSECUTIVE_INCOMPLETE_BUILDS = 2;

export interface IndexBuildGuardStore {
  readBuildAttempts(): Promise<number>;
  writeBuildAttempts(attempts: number): Promise<void>;
  clearBuildAttempts(): Promise<void>;
}

/**
 * Tracks whether the previous full index builds ran to completion.
 *
 * Only the startup path consults the guard. An explicit user command always
 * builds: the point of suspension is to stop an unattended loop, not to take
 * the capability away.
 */
export class IndexBuildGuard {
  private readonly store: IndexBuildGuardStore;
  private suspended = false;

  constructor(store: IndexBuildGuardStore) {
    this.store = store;
  }

  /** True when the last builds completed often enough to risk another automatic one. */
  async canAutoBuild(): Promise<boolean> {
    const attempts = await this.store.readBuildAttempts();
    const allowed = attempts < MAX_CONSECUTIVE_INCOMPLETE_BUILDS;
    this.suspended = !allowed;
    return allowed;
  }

  /** Whether the most recent `canAutoBuild()` withheld permission. */
  isSuspended(): boolean {
    return this.suspended;
  }

  async markBuildStarted(): Promise<void> {
    const attempts = await this.store.readBuildAttempts();
    await this.store.writeBuildAttempts(attempts + 1);
  }

  async markBuildCompleted(): Promise<void> {
    this.suspended = false;
    await this.store.clearBuildAttempts();
  }

  /** Clears the ceiling so an explicitly requested build starts from a clean slate. */
  async reset(): Promise<void> {
    this.suspended = false;
    await this.store.clearBuildAttempts();
  }
}
