import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("cooperative search task scheduling", () => {
  it("shares one 8ms budget and one scheduled pause across concurrent tasks", async () => {
    const { runSearchTask } = await import("./cooperative-task");
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const queue: (() => void)[] = [];
    const scheduler = (resume: () => void) => { queue.push(resume); };
    const visited: string[] = [];
    function* work(name: string) {
      for (let index = 0; index < 3; index += 1) {
        visited.push(name); clock += 4; yield;
      }
      return name;
    }
    const first = runSearchTask(work("a"), undefined, undefined, scheduler);
    const second = runSearchTask(work("b"), undefined, undefined, scheduler);
    expect(visited).toEqual(["a", "a"]);
    expect(queue).toHaveLength(1);
    while (queue.length) { queue.shift()!(); await Promise.resolve(); }
    expect(await first).toBe("a");
    expect(await second).toBe("b");
    expect(visited).toEqual(["a", "a", "a", "b", "b", "b"]);
  });

  it("defers even a synchronous injected callback and respects cancellation", async () => {
    vi.useFakeTimers();
    const { runSearchTask } = await import("./cooperative-task");
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    let current = true;
    let visited = 0;
    let cleaned = false;
    function* work() {
      try { visited += 1; clock += 8; yield; visited += 1; return "stale"; }
      finally { cleaned = true; }
    }
    const result = runSearchTask(work(), () => current, undefined, (resume) => resume());
    expect(visited).toBe(1);
    expect(cleaned).toBe(false);
    current = false;
    await vi.runAllTimersAsync();
    expect(await result).toBeUndefined();
    expect(visited).toBe(1);
    expect(cleaned).toBe(true);
  });

  it("uses a MessageChannel task and closes both ports after delivery", async () => {
    const { scheduleSearchTask } = await import("./cooperative-task");
    const close = vi.fn();
    let receive: (() => void) | undefined;
    const postMessage = vi.fn(() => {});
    vi.stubGlobal("MessageChannel", class {
      port1 = { set onmessage(callback: () => void) { receive = callback; }, close };
      port2 = { postMessage, close };
    });
    try {
      const resume = vi.fn();
      scheduleSearchTask(resume);
      expect(postMessage).toHaveBeenCalledOnce();
      expect(resume).not.toHaveBeenCalled();
      receive!();
      expect(resume).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); }
  });

  it("falls back to a controllable timer when MessageChannel is unavailable", async () => {
    vi.useFakeTimers();
    const { scheduleSearchTask } = await import("./cooperative-task");
    vi.stubGlobal("MessageChannel", undefined);
    try {
      const resume = vi.fn();
      scheduleSearchTask(resume);
      expect(resume).not.toHaveBeenCalled();
      await vi.runAllTimersAsync();
      expect(resume).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
