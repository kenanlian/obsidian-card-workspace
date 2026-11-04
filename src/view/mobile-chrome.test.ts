import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import {
  CHROME_SETTLE_MS, CHROME_SLIDE_MS, HIDDEN_NAV_CLASS,
  createChromeScrollGate, installMobileChromeAutoHide, resolveHostMobileNavbar,
} from "./mobile-chrome";

describe("createChromeScrollGate", () => {
  it("forwards samples until the host toggles the chrome, then waits for the layout to settle", () => {
    const gate = createChromeScrollGate(false);
    expect(gate.accept(false, 1000)).toBe(true);
    gate.settle(true, 1000);
    expect(gate.accept(true, 1000 + CHROME_SETTLE_MS - 1)).toBe(false);
    expect(gate.accept(true, 1000 + CHROME_SETTLE_MS)).toBe(true);
  });

  it("also settles after toggles made outside scrolling, such as a tap restoring the chrome", () => {
    const gate = createChromeScrollGate(true);
    expect(gate.accept(false, 5000)).toBe(false);
    expect(gate.accept(false, 5000 + CHROME_SETTLE_MS)).toBe(true);
  });
});

describe("installMobileChromeAutoHide", () => {
  function setup() {
    const classes = new Set<string>();
    let mutationCallback: (() => void) | null = null;
    let now = 1000;
    let listTop = 120;
    const list = { classList: { contains: (name: string) => name === "fce-list" }, scrollTop: 0, getBoundingClientRect: () => ({ top: listTop, height: 600 }) };
    const animate = vi.fn(() => ({ playState: "running", cancel: vi.fn() }));
    const listeners = new Map<string, (event: Event) => void>();
    const win = {
      performance: { now: () => now },
      matchMedia: () => ({ matches: false }),
      MutationObserver: class { constructor(callback: () => void) { mutationCallback = callback; } observe() {} disconnect() {} },
    };
    const pane = { animate };
    const hostEl = {
      ownerDocument: { body: { classList: { contains: (name: string) => classes.has(name) } }, defaultView: win },
      querySelector: (selector: string) => (selector === ".fce-list" ? list : selector === ".fce-main-pane" ? pane : null),
      addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
      removeEventListener: vi.fn(), animate: vi.fn(), style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    };
    const onScroll = vi.fn((_key: unknown, top: number) => {
      if (top > 0) classes.add(HIDDEN_NAV_CLASS); else classes.delete(HIDDEN_NAV_CLASS);
      listTop = classes.has(HIDDEN_NAV_CLASS) ? 24 : 120;
    });
    const chrome = installMobileChromeAutoHide({ mobileNavbar: { onScroll } } as unknown as App, hostEl as unknown as HTMLElement);
    const scroll = (top: number): void => {
      list.scrollTop = top;
      listeners.get("scroll")?.({ target: list } as unknown as Event);
      mutationCallback?.();
    };
    return { chrome, scroll, onScroll, animate, advance: (ms: number) => { now += ms; } };
  }

  it("forwards list scrolling to the host and slides the cards from their previous position", () => {
    const { chrome, scroll, onScroll, animate, advance } = setup();
    scroll(200);
    expect(onScroll).toHaveBeenCalledTimes(1);
    expect(animate).toHaveBeenLastCalledWith([{ transform: "translateY(96px)" }, { transform: "translateY(0)" }], expect.objectContaining({ duration: CHROME_SLIDE_MS }));
    scroll(150);
    expect(onScroll).toHaveBeenCalledTimes(1);
    advance(CHROME_SETTLE_MS);
    scroll(0);
    expect(onScroll).toHaveBeenCalledTimes(2);
    expect(animate).toHaveBeenLastCalledWith([{ transform: "translateY(-96px)" }, { transform: "translateY(0)" }], expect.anything());
    chrome?.dispose();
  });

  it("is unavailable without the host navbar", () => {
    expect(installMobileChromeAutoHide({} as App, {} as HTMLElement)).toBeNull();
  });
});

describe("resolveHostMobileNavbar", () => {
  it("returns the host navbar only when it can receive scroll samples", () => {
    const onScroll = vi.fn();
    expect(resolveHostMobileNavbar({ mobileNavbar: { onScroll } } as unknown as App)?.onScroll).toBe(onScroll);
    expect(resolveHostMobileNavbar({ mobileNavbar: {} } as unknown as App)).toBeNull();
    expect(resolveHostMobileNavbar({} as App)).toBeNull();
  });
});
