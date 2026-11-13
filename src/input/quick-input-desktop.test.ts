import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import * as obsidian from "obsidian";
import { Platform } from "obsidian";
import { createQuickInputDesktop, QuickInputDesktopError, type QuickInputWindowHandle } from "./quick-input-desktop";

const runtime = vi.hoisted(() => ({ ready: Promise.resolve(), dispose: vi.fn() }));
vi.mock("./quick-input-document", () => ({ prepareQuickInputDocument: vi.fn(() => ({ ready: runtime.ready, dispose: runtime.dispose })) }));

function handle() {
  return { id: 2, isDestroyed: vi.fn(() => false), show: vi.fn(), showInactive: vi.fn(), focus: vi.fn(),
    setParentWindow: vi.fn(), setAlwaysOnTop: vi.fn(), setMinimumSize: vi.fn(), setContentSize: vi.fn(),
    getBounds: vi.fn(() => ({ x: 100, y: 100, width: 480, height: 270 })),
    getContentBounds: vi.fn(() => ({ x: 100, y: 100, width: 480, height: 270 })), setBounds: vi.fn(), setResizable: vi.fn(),
    setWindowButtonVisibility: vi.fn(), webContents: { getZoomFactor: vi.fn(() => 1.25), setZoomFactor: vi.fn(), setBackgroundThrottling: vi.fn() } };
}
function fixture(style: string | undefined = "custom") {
  const mainHandle = handle(), native = handle();
  mainHandle.id = 1;
  const contents = new EventEmitter();
  const creationOptions = { frame: false, show: false, transparent: true, thickFrame: false, roundedCorners: false, hasShadow: false };
  const child = Object.assign(new EventTarget(), { closed: false, app: undefined as unknown, require: vi.fn(() => ({ remote: { getCurrentWindow: () => native } })), close: vi.fn() });
  child.close.mockImplementation(() => { child.closed = true; child.dispatchEvent(new Event("unload")); });
  const nearest = vi.fn(() => ({ id: 1, workArea: { x: -1920, y: -200, width: 1920, height: 1080 } }));
  const shortcuts = { register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn() };
  const win = { titlebarStyle: style, electronWindow: mainHandle, app: { marker: "vault" },
    open: vi.fn((_url: string, id: string, _features: string) => {
      queueMicrotask(() => contents.emit("did-create-window", native, { frameName: id, options: creationOptions }));
      return child;
    }), setTimeout, clearTimeout,
    electron: { remote: { screen: { getCursorScreenPoint: () => ({ x: -800, y: 20 }), getDisplayNearestPoint: nearest }, globalShortcut: shortcuts, getCurrentWebContents: () => contents } } };
  const desktop = createQuickInputDesktop(win as unknown as Window);
  const abort = new AbortController();
  const create = () => desktop.createWindow({ id: "session-1", placement: { x: -1200, y: 205, width: 480, height: 270, displayId: 1 }, signal: abort.signal });
  return { win, child, native, mainHandle, nearest, desktop, create, abort, contents, creationOptions };
}
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(obsidian, "requireApiVersion").mockReturnValue(false);
});
afterEach(() => {
  Object.assign(Platform, { isWin: false, isMacOS: false });
  runtime.ready = Promise.resolve(); runtime.dispose.mockClear();
  vi.restoreAllMocks(); vi.useRealTimers();
});

describe("quick input desktop adapter", () => {
  it.each(["custom", "hidden"])("accepts the running %s frame style", (style) => { expect(() => fixture(style).desktop.check()).not.toThrow(); });
  it("blocks native and unknown frames before opening", async () => {
    for (const style of ["native", "future"]) {
      const f = fixture(style);
      await expect(f.create()).rejects.toThrow(new QuickInputDesktopError(style === "native" ? "native-frame" : "unavailable"));
      expect(f.win.open).not.toHaveBeenCalled();
    }
  });
  it("locates ordinary opens on the source display and global opens on the mouse display", () => {
    const f = fixture();
    f.desktop.position({ screenX: 200, screenY: 100, outerWidth: 800, outerHeight: 600 } as Window, 480, 270, 0);
    expect(f.nearest).toHaveBeenLastCalledWith({ x: 600, y: 400 });
    f.desktop.position(undefined, 480, 270, 0);
    expect(f.nearest).toHaveBeenLastCalledWith({ x: -800, y: 20 });
  });
  it("cascades and clamps to work areas including negative coordinates", () => {
    const f = fixture();
    expect(f.desktop.position(undefined, 480, 270, 0)).toEqual({ x: -1200, y: 205, width: 480, height: 270, displayId: 1 });
    expect(f.desktop.position(undefined, 480, 270, 1)).toEqual({ x: -1176, y: 229, width: 480, height: 270, displayId: 1 });
    expect(f.desktop.position(undefined, 4000, 4000, 3)).toEqual({ x: -1920, y: -200, width: 1920, height: 1080, displayId: 1 });
  });
  it("requires screen and shortcut capabilities explicitly", () => {
    const f = fixture(); expect(f.desktop.shortcuts()).toBe(f.win.electron.remote.globalShortcut);
    expect(f.desktop.cursor()).toEqual({ x: -800, y: 20 });
    const missing = createQuickInputDesktop({ titlebarStyle: "hidden" } as unknown as Window);
    expect(() => missing.check()).toThrow(); expect(() => missing.shortcuts()).toThrow();
  });
  it("creates a hidden unframed transparent document without replacing the host opener", async () => {
    const f = fixture(), open = f.win.open;
    const opened = await f.create();
    expect(f.win.open).toBe(open);
    const [url, name, features] = open.mock.calls[0] as unknown as [string, string, string];
    expect(url).toBe("about:blank"); expect(name).toBe("session-1");
    for (const value of ["popup", "show=no", "frame=no", "transparent=yes", "background=#00000000", "thickFrame=no", "roundedCorners=no", "hasShadow=no"]) expect(features.split(",")).toContain(value);
    expect(opened.win).toBe(f.child); expect(opened.handle).toBe(f.native);
    expect(f.native.setBounds).toHaveBeenCalledExactlyOnceWith({ x: -1200, y: 205, width: 480, height: 270 });
    expect(f.native.setContentSize).toHaveBeenCalledExactlyOnceWith(480, 270);
    expect(f.native.setMinimumSize).toHaveBeenCalledExactlyOnceWith(320, 200);
    expect(f.native.setParentWindow).toHaveBeenCalledExactlyOnceWith(null);
    expect(f.native.setAlwaysOnTop).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.native.setResizable).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.native.webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(1.25);
    expect(f.native.webContents.setBackgroundThrottling).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.child.app).toBe(f.win.app);
    expect(f.mainHandle.setBounds).not.toHaveBeenCalled(); expect(f.mainHandle.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(f.native.show).not.toHaveBeenCalled(); expect(f.native.focus).not.toHaveBeenCalled();
    opened.dispose(); opened.dispose();
    expect(f.child.close).toHaveBeenCalledOnce(); expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(f.native.webContents.setBackgroundThrottling).toHaveBeenLastCalledWith(true);
    expect(f.contents.listenerCount("did-create-window")).toBe(0);
  });
  it("keeps the legacy popup prefix without requesting an unsupported IPC channel", async () => {
    const f = fixture();
    const sendSync = vi.fn(() => { throw new Error("No popup-token handler"); });
    Object.assign(f.win.electron, { ipcRenderer: { sendSync } });
    const opened = await f.create();
    expect(f.win.open.mock.calls[0][2].split(",")[0]).toBe("popup");
    expect(sendSync).not.toHaveBeenCalled();
    opened.dispose();
  });
  it("uses the host popup token first on 1.15.1 while preserving hidden transparent window options", async () => {
    vi.mocked(obsidian.requireApiVersion).mockReturnValue(true);
    const f = fixture(), token = "0123456789abcdef0123456789abcdef";
    const sendSync = vi.fn(() => token);
    Object.assign(f.win.electron, { ipcRenderer: { sendSync } });
    f.win.open.mockImplementation((_url, id, features) => {
      // Match 1.15.1's main-process gate: "popup" alone is rejected.
      if (features.split(",")[0] !== `token=${token}`) return null as never;
      queueMicrotask(() => f.contents.emit("did-create-window", f.native, { frameName: id, options: f.creationOptions }));
      return f.child;
    });
    const opened = await f.create();
    expect(obsidian.requireApiVersion).toHaveBeenCalledWith("1.15.1");
    expect(sendSync).toHaveBeenCalledExactlyOnceWith("popup-token");
    const features = f.win.open.mock.calls[0][2].split(",");
    for (const feature of ["popup", "show=no", "frame=no", "transparent=yes", "thickFrame=no", "roundedCorners=no", "hasShadow=no"]) {
      expect(features).toContain(feature);
    }
    expect(opened.handle).toBe(f.native);
    expect(f.native.show).not.toHaveBeenCalled();
    expect(f.native.focus).not.toHaveBeenCalled();
    opened.dispose();
    expect(f.child.close).toHaveBeenCalledOnce();
    expect(f.contents.listenerCount("did-create-window")).toBe(0);
  });
  it.each([undefined, null, false, 42, "", "token,frame=yes", "with whitespace"])("rejects an unavailable or malformed modern popup token (%s) before opening", async (token) => {
    vi.mocked(obsidian.requireApiVersion).mockReturnValue(true);
    const f = fixture();
    Object.assign(f.win.electron, { ipcRenderer: { sendSync: () => token } });
    await expect(f.create()).rejects.toThrow(new QuickInputDesktopError("unavailable"));
    expect(f.win.open).not.toHaveBeenCalled();
    expect(f.contents.listenerCount("did-create-window")).toBe(0);
  });
  it("reports a missing or throwing modern IPC bridge without attempting the legacy protocol", async () => {
    vi.mocked(obsidian.requireApiVersion).mockReturnValue(true);
    for (const ipcRenderer of [undefined, { sendSync: () => { throw new Error("IPC unavailable"); } }]) {
      const f = fixture();
      Object.assign(f.win.electron, { ipcRenderer });
      await expect(f.create()).rejects.toThrow(new QuickInputDesktopError("unavailable"));
      expect(f.win.open).not.toHaveBeenCalled();
      expect(f.contents.listenerCount("did-create-window")).toBe(0);
    }
  });
  it("closes a pending document immediately on cancellation and ignores its late readiness", async () => {
    let finish!: () => void;
    runtime.ready = new Promise((resolve) => { finish = resolve; });
    const f = fixture(); const pending = f.create();
    f.abort.abort();
    expect(f.child.close).toHaveBeenCalledOnce();
    await expect(pending).rejects.toThrow(QuickInputDesktopError);
    finish(); await Promise.resolve();
    expect(f.native.show).not.toHaveBeenCalled();
  });
  it("rejects system close during initialization and closes failed resource loads", async () => {
    runtime.ready = new Promise(() => {});
    const f = fixture(); const pending = f.create();
    f.child.dispatchEvent(new Event("unload"));
    await expect(pending).rejects.toThrow(QuickInputDesktopError);
    expect(runtime.dispose).toHaveBeenCalledOnce();
    runtime.ready = Promise.reject(new Error("missing host initializer"));
    const second = fixture();
    await expect(second.create()).rejects.toThrow(QuickInputDesktopError);
    expect(second.child.close).toHaveBeenCalledOnce();
  });
  it("times out an unresponsive hidden document without leaving a native window", async () => {
    vi.useFakeTimers(); runtime.ready = new Promise(() => {});
    const f = fixture(); const pending = f.create();
    const rejection = expect(pending).rejects.toThrow(QuickInputDesktopError);
    await vi.advanceTimersByTimeAsync(10_000); await rejection;
    expect(f.child.close).toHaveBeenCalledOnce();
  });
  it("does not open an already canceled request and never accepts the main native handle", async () => {
    const f = fixture(); f.abort.abort();
    await expect(f.create()).rejects.toThrow(QuickInputDesktopError);
    expect(f.win.open).not.toHaveBeenCalled();
    const second = fixture(); second.child.require.mockReturnValue({ remote: { getCurrentWindow: () => second.mainHandle } });
    await expect(second.create()).rejects.toThrow(QuickInputDesktopError);
    expect(second.mainHandle.webContents.setBackgroundThrottling).not.toHaveBeenCalled();
    expect(second.mainHandle.setParentWindow).not.toHaveBeenCalled();
  });
  it("rejects missing native capabilities and supports the child's remote module fallback", async () => {
    const f = fixture();
    f.child.require.mockImplementation((...args: unknown[]) => args[0] === "electron" ? {} as never : { getCurrentWindow: () => f.native } as never);
    const opened = await f.create(); expect(opened.handle).toBe(f.native); opened.dispose();
    const missing = fixture(); Reflect.deleteProperty(missing.native, "setBounds");
    await expect(missing.create()).rejects.toThrow(QuickInputDesktopError);
    expect(missing.child.close).toHaveBeenCalledOnce();
  });

  it.each([false, true])("rejects ignored constructor options before revealing an opaque or system-decorated window (token protocol: %s)", async (modern) => {
    vi.mocked(obsidian.requireApiVersion).mockReturnValue(modern);
    const f = fixture(); f.creationOptions.transparent = false;
    Object.assign(f.win.electron, { ipcRenderer: { sendSync: () => "0123456789abcdef0123456789abcdef" } });
    await expect(f.create()).rejects.toThrow(QuickInputDesktopError);
    expect(f.native.show).not.toHaveBeenCalled(); expect(f.child.close).toHaveBeenCalledOnce();
    expect(f.contents.listenerCount("did-create-window")).toBe(0);
  });
});
