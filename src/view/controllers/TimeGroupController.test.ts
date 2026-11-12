import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupSpec } from "../../card-grouping-settings";
import { RuntimeWorkGate } from "../../runtime/work-gate";
import type { ViewContext } from "../view-context";
import { TimeGroupController } from "./TimeGroupController";

function harness() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 12, 23, 59, 59));
  const gate = new RuntimeWorkGate();
  let group: GroupSpec = { dimension: "mtime", timeGranularity: "relative", orderBy: "default", orderDirection: "asc" };
  let settled = true, searching = false;
  const refresh = vi.fn();
  const context = { workGate: gate, getViewWindow: () => ({ setTimeout, clearTimeout }) } as unknown as ViewContext;
  const controller = new TimeGroupController(context, { getGroup: () => group,
    isSearchActive: () => searching, isSettled: () => settled, refresh });
  controller.sync();
  return { controller, gate, refresh, setSettled(value: boolean) { settled = value; },
    setSearch(value: boolean) { searching = value; controller.sync(); },
    setGroup(value: GroupSpec) { group = value; controller.sync(); } };
}
afterEach(() => { vi.useRealTimers(); });
describe("TimeGroupController", () => {
  it("refreshes at local midnight and releases the timer on disposal", () => {
    const h = harness();
    vi.advanceTimersByTime(999); expect(h.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(h.refresh).toHaveBeenCalledOnce();
    h.controller.dispose(); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(86_400_000); expect(h.refresh).toHaveBeenCalledOnce();
  });
  it("pauses while hidden and catches up once on wake", () => {
    const h = harness(); h.gate.setActive(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000); expect(h.refresh).not.toHaveBeenCalled();
    h.gate.setActive(true); expect(h.refresh).toHaveBeenCalledOnce();
    h.controller.sync(); expect(h.refresh).toHaveBeenCalledOnce(); h.controller.dispose();
  });
  it("catches up when relative grouping was first enabled while hidden", () => {
    const h = harness(); h.setSearch(true); h.gate.setActive(false); h.setSearch(false);
    vi.advanceTimersByTime(10_000); expect(h.refresh).not.toHaveBeenCalled();
    h.gate.setActive(true); expect(h.refresh).toHaveBeenCalledOnce(); h.controller.dispose();
  });
  it("waits for the scope commit when midnight lands during a load", () => {
    const h = harness(); h.setSettled(false); vi.advanceTimersByTime(1000);
    expect(h.refresh).not.toHaveBeenCalled();
    h.setSettled(true); h.controller.sync(); expect(h.refresh).toHaveBeenCalledOnce();
    h.controller.dispose();
  });
  it("does not schedule calendar or search-paused grouping", () => {
    const h = harness(); h.setSearch(true); expect(vi.getTimerCount()).toBe(0);
    h.setSearch(false); expect(vi.getTimerCount()).toBe(1);
    h.setGroup({ dimension: "ctime", timeGranularity: "month", orderBy: "default", orderDirection: "asc" });
    expect(vi.getTimerCount()).toBe(0); h.controller.dispose();
  });
});
