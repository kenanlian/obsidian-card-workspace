import { afterEach, describe, expect, it, vi } from "vitest";

import { VaultEventBus } from "./VaultEventBus";
import type { VaultMutationEvent } from "./vault-events";

function createEvent(overrides: Partial<VaultMutationEvent> = {}): VaultMutationEvent {
  return {
    eventType: "modify",
    path: "notes/a.md",
    oldPath: null,
    isFolder: false,
    fileKind: "markdown",
    ...overrides,
  };
}

describe("VaultEventBus", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("V50 runs listeners in registration order", async () => {
    const bus = new VaultEventBus();
    const log: string[] = [];
    bus.subscribe(() => {
      log.push("first");
    });
    bus.subscribe(() => {
      log.push("second");
    });
    bus.subscribe(() => {
      log.push("third");
    });

    await bus.publish(createEvent());

    expect(log).toEqual(["first", "second", "third"]);
  });

  it("V50 awaits async listeners one-by-one without interleaving", async () => {
    const bus = new VaultEventBus();
    const log: string[] = [];
    const stamps: number[] = [];
    let seq = 0;
    let releaseFirst!: () => void;
    const firstHold = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    bus.subscribe(async () => {
      log.push("first-start");
      stamps.push(++seq);
      await firstHold;
      log.push("first-end");
      stamps.push(++seq);
    });
    bus.subscribe(async () => {
      log.push("second-start");
      stamps.push(++seq);
      log.push("second-end");
      stamps.push(++seq);
    });

    const published = bus.publish(createEvent());
    expect(log).toEqual(["first-start"]);
    expect(stamps).toEqual([1]);

    releaseFirst();
    await published;

    expect(log).toEqual(["first-start", "first-end", "second-start", "second-end"]);
    expect(stamps).toEqual([1, 2, 3, 4]);
    expect(stamps).toEqual([...stamps].sort((left, right) => left - right));
  });

  it("V50 isolates a sync throw so later listeners still run and publish does not reject", async () => {
    const bus = new VaultEventBus();
    const log: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const boom = new Error("sync boom");

    bus.subscribe(() => {
      throw boom;
    });
    bus.subscribe(() => {
      log.push("later");
    });

    await expect(bus.publish(createEvent())).resolves.toBeUndefined();

    expect(log).toEqual(["later"]);
    expect(warn).toHaveBeenCalledWith("[Card Workspace] Vault event listener failed.", boom);
  });

  it("V50 isolates a rejected promise so later listeners still run and publish does not reject", async () => {
    const bus = new VaultEventBus();
    const log: string[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const boom = new Error("async boom");

    bus.subscribe(() => Promise.reject(boom));
    bus.subscribe(() => {
      log.push("later");
    });

    await expect(bus.publish(createEvent())).resolves.toBeUndefined();

    expect(log).toEqual(["later"]);
    expect(warn).toHaveBeenCalledWith("[Card Workspace] Vault event listener failed.", boom);
  });

  it("V50 stops delivery after unsubscribe", async () => {
    const bus = new VaultEventBus();
    const log: string[] = [];
    const unsubscribe = bus.subscribe(() => {
      log.push("removed");
    });
    bus.subscribe(() => {
      log.push("kept");
    });

    unsubscribe();
    await bus.publish(createEvent());

    expect(log).toEqual(["kept"]);
  });
});
