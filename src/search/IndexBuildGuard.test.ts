import { describe, expect, it } from "vitest";

import {
  IndexBuildGuard,
  MAX_CONSECUTIVE_INCOMPLETE_BUILDS,
  type IndexBuildGuardStore,
} from "./IndexBuildGuard";

function createGuardStore(initialAttempts = 0): IndexBuildGuardStore & { attempts: number } {
  return {
    attempts: initialAttempts,
    async readBuildAttempts(): Promise<number> {
      return this.attempts;
    },
    async writeBuildAttempts(attempts: number): Promise<void> {
      this.attempts = attempts;
    },
    async clearBuildAttempts(): Promise<void> {
      this.attempts = 0;
    },
  };
}

describe("IndexBuildGuard", () => {
  it("allows an automatic build while incomplete attempts stay under the ceiling", async () => {
    const store = createGuardStore(MAX_CONSECUTIVE_INCOMPLETE_BUILDS - 1);
    const guard = new IndexBuildGuard(store);

    expect(await guard.canAutoBuild()).toBe(true);
    expect(guard.isSuspended()).toBe(false);
  });

  it("suspends automatic builds once the ceiling is reached", async () => {
    const store = createGuardStore(MAX_CONSECUTIVE_INCOMPLETE_BUILDS);
    const guard = new IndexBuildGuard(store);

    expect(await guard.canAutoBuild()).toBe(false);
    expect(guard.isSuspended()).toBe(true);
  });

  it("suspends after consecutive builds that start but never complete", async () => {
    const store = createGuardStore();
    const guard = new IndexBuildGuard(store);

    for (let attempt = 0; attempt < MAX_CONSECUTIVE_INCOMPLETE_BUILDS; attempt += 1) {
      expect(await guard.canAutoBuild()).toBe(true);
      await guard.markBuildStarted();
    }

    expect(await guard.canAutoBuild()).toBe(false);
  });

  it("clears the attempt count once a build completes", async () => {
    const store = createGuardStore();
    const guard = new IndexBuildGuard(store);

    await guard.markBuildStarted();
    await guard.markBuildCompleted();

    expect(store.attempts).toBe(0);
    expect(await guard.canAutoBuild()).toBe(true);
  });

  it("reset lifts an existing suspension so an explicit command can build", async () => {
    const store = createGuardStore(MAX_CONSECUTIVE_INCOMPLETE_BUILDS);
    const guard = new IndexBuildGuard(store);
    expect(await guard.canAutoBuild()).toBe(false);

    await guard.reset();

    expect(guard.isSuspended()).toBe(false);
    expect(await guard.canAutoBuild()).toBe(true);
  });
});
