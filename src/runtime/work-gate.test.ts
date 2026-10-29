import { describe, expect, it, vi } from "vitest";
import { RuntimeWorkGate } from "./work-gate";
import { RuntimeActivity } from "./activity";

function documentFixture() {
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible", defaultView: { getComputedStyle: () => ({ display: "flex", visibility: "visible" }) } });
  return { doc: doc as unknown as Document, visibility(value: string) { doc.visibilityState = value; doc.dispatchEvent(new Event("visibilitychange")); } };
}
function regionFixture(doc: Document) {
  const element = { ownerDocument: doc, isConnected: true, getBoundingClientRect: () => ({ width: 300, height: 600 }) };
  return element;
}

describe("cooperative work gate", () => {
  it("resumes, cancels, and closes every waiter without retaining abort listeners", async () => {
    const gate = new RuntimeWorkGate(); gate.setActive(false);
    const abort = new AbortController(), remove = vi.spyOn(abort.signal, "removeEventListener");
    const cancelled = gate.wait(abort.signal), resumed = gate.wait();
    expect(gate.getDiagnostics().waiters).toBe(2);
    abort.abort(); expect(await cancelled).toBe(false); expect(remove).toHaveBeenCalledOnce();
    gate.setActive(true); expect(await resumed).toBe(true);
    gate.setActive(false); const closing = [gate.wait(), gate.wait()]; gate.close();
    expect(await Promise.all(closing)).toEqual([false, false]);
    expect(await gate.wait()).toBe(false); expect(gate.getDiagnostics().waiters).toBe(0);
    gate.setActive(true); expect(gate.isActive).toBe(false);
  });
});

describe("workspace visibility", () => {
  it("pauses background only when main and popout are both hidden", () => {
    const activity = new RuntimeActivity(), main = documentFixture(), popout = documentFixture();
    const stopMain = activity.trackDocument(main.doc), stopPopout = activity.trackDocument(popout.doc);
    main.visibility("hidden"); expect(activity.background.isActive).toBe(true);
    popout.visibility("hidden"); expect(activity.background.isPaused).toBe(true);
    popout.visibility("visible"); expect(activity.background.isActive).toBe(true);
    stopPopout(); expect(activity.background.isPaused).toBe(true);
    stopMain(); activity.dispose(); expect(activity.background.isClosed).toBe(true);
  });

  it("uses geometry without observers, retains other views, and releases on disposal", () => {
    const activity = new RuntimeActivity(), main = documentFixture(), popout = documentFixture();
    const first = regionFixture(main.doc), second = regionFixture(popout.doc);
    const a = new RuntimeWorkGate(), b = new RuntimeWorkGate();
    activity.observeRegion(first as unknown as HTMLElement, a);
    const stop = activity.observeRegion(second as unknown as HTMLElement, b);
    first.getBoundingClientRect = () => ({ width: 0, height: 0 }); activity.refresh();
    expect(a.isPaused).toBe(true); expect(b.isActive).toBe(true); expect(activity.background.isActive).toBe(true);
    // Moving a mounted view to another document must not leave its old lease behind.
    second.ownerDocument = main.doc; activity.refresh();
    expect(activity.getDiagnostics().documents).toBe(1);
    main.visibility("hidden"); expect(b.isPaused).toBe(true);
    stop(); activity.dispose(); expect(a.isClosed).toBe(true); expect(b.isClosed).toBe(true);
    expect(activity.getDiagnostics()).toMatchObject({ documents: 0, regions: 0 });
  });

  it("falls back to viewport bounds for translated or offscreen regions", () => {
    const activity = new RuntimeActivity(), main = documentFixture();
    Object.assign(main.doc.defaultView!, { innerWidth: 800, innerHeight: 600 });
    const element = { ownerDocument: main.doc, isConnected: true, getBoundingClientRect: () => ({ width: 300, height: 500, top: 900, bottom: 1400, left: 0, right: 300 }) };
    const gate = new RuntimeWorkGate(); activity.observeRegion(element as unknown as HTMLElement, gate);
    expect(gate.isPaused).toBe(true);
    element.getBoundingClientRect = () => ({ width: 300, height: 500, top: 0, bottom: 500, left: 0, right: 300 });
    activity.refresh(); expect(gate.isActive).toBe(true); activity.dispose();
  });

  it("uses intersection observations and ignores focus/blur", () => {
    const activity = new RuntimeActivity(), main = documentFixture();
    let changed!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    Object.assign(main.doc.defaultView!, { IntersectionObserver: class { constructor(callback: IntersectionObserverCallback) { changed = callback; } observe() {} disconnect = disconnect; } });
    const element = regionFixture(main.doc), gate = new RuntimeWorkGate();
    const stop = activity.observeRegion(element as unknown as HTMLElement, gate);
    main.doc.dispatchEvent(new Event("blur")); expect(gate.isActive).toBe(true);
    changed([{ target: element, isIntersecting: false }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(gate.isPaused).toBe(true);
    changed([{ target: element, isIntersecting: true }] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);
    expect(gate.isActive).toBe(true); stop(); expect(disconnect).toHaveBeenCalledOnce(); activity.dispose();
  });
});
