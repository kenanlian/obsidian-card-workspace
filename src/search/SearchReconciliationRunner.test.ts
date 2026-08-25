import { describe, expect, it, vi } from "vitest";
import { SearchMutationGate, SearchReconciliationRunner } from "./SearchReconciliationRunner";

describe("SearchReconciliationRunner", () => {
  it("serializes source-wide operations", async () => {
    const runner = new SearchReconciliationRunner();
    const order: string[] = [];
    let release!: () => void;
    const first = runner.run(async () => {
      order.push("first:start");
      await new Promise<void>((resolve) => { release = resolve; });
      order.push("first:end");
    });
    const second = runner.run(async () => { order.push("second"); });
    await vi.waitFor(() => expect(order).toEqual(["first:start"]));
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("aborts active work and drops queued work on final disposal", async () => {
    const runner = new SearchReconciliationRunner();
    const queued = vi.fn();
    const active = runner.run(async (signal) => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    const later = runner.run(async () => { queued(); });
    runner.dispose();
    runner.dispose();
    await Promise.all([active, later]);
    expect(queued).not.toHaveBeenCalled();
  });

  it("runs mutation critical sections in FIFO order", async () => {
    const gate = new SearchMutationGate();
    const order: number[] = [];
    await Promise.all([1, 2, 3].map((value) => gate.run(async () => { order.push(value); })));
    expect(order).toEqual([1, 2, 3]);
  });
});
