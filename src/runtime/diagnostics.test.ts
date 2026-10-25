import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimePhaseTimings } from "./diagnostics";
import { scheduleIdleTask } from "../search/idle-task";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded runtime diagnostics and scheduling fallback", () => {
  it("retains aggregate phase values and returns independent snapshots", () => {
    const timings = new RuntimePhaseTimings();
    for (let i = 0; i < 100; i++) { const finish = timings.start("preview"); finish(); finish(); }
    const snapshot = timings.snapshot(); expect(Object.keys(snapshot)).toEqual(["preview"]);
    expect(snapshot.preview?.completed).toBe(100);
    snapshot.preview!.completed = 0;
    expect(timings.snapshot().preview?.completed).toBe(100);
  });

  it("uses a cancellable timer when idle callbacks are absent", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined); vi.stubGlobal("cancelIdleCallback", undefined);
    const task = vi.fn(), cancel = scheduleIdleTask(task, 10);
    cancel(); await vi.advanceTimersByTimeAsync(10); expect(task).not.toHaveBeenCalled();
    scheduleIdleTask(task, 10); await vi.advanceTimersByTimeAsync(9); expect(task).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(task).toHaveBeenCalledOnce();
  });
});
