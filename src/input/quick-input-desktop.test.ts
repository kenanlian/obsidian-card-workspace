import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { buildRoundedWindowShape, createQuickInputDesktop, QuickInputDesktopError } from "./quick-input-desktop";

function fixture(style: string | undefined = "custom") {
  const nearest = vi.fn(() => ({ id: 1, workArea: { x: -1920, y: -200, width: 1920, height: 1080 } }));
  const win = { innerWidth: 480, open: vi.fn((..._args: unknown[]) => null as Window | null), titlebarStyle: style as string | undefined, electronWindow: handle(), electron: { remote: {
    screen: { getCursorScreenPoint: () => ({ x: -800, y: 20 }), getDisplayNearestPoint: nearest },
    globalShortcut: { register: vi.fn(), unregister: vi.fn(), isRegistered: vi.fn() },
  } } };
  return { win, nearest, desktop: createQuickInputDesktop(win as unknown as Window) };
}
function handle() { return { isDestroyed: () => false, hide: vi.fn(), show: vi.fn(), focus: vi.fn(), moveTop: vi.fn(), setParentWindow: vi.fn(),
  setAlwaysOnTop: vi.fn(), setMinimumSize: vi.fn(), setContentSize: vi.fn(), getBounds: vi.fn(() => ({ x: 0, y: 0, width: 480, height: 270 })),
  getContentBounds: vi.fn(() => ({ x: 0, y: 0, width: 480, height: 270 })), setPosition: vi.fn(), setBounds: vi.fn(), setOpacity: vi.fn(), setShape: vi.fn() }; }
afterEach(() => { Object.assign(Platform, { isWin: false, isMacOS: false }); });
describe("Obsidian desktop quick-input adapter", () => {
  it.each(["custom", "hidden"])("accepts the captured %s frame style", (style) => { expect(() => fixture(style).desktop.check()).not.toThrow(); });
  it("blocks native or unknown frame styles without reading the editable preference", () => {
    expect(() => fixture("native").desktop.check()).toThrow(new QuickInputDesktopError("native-frame"));
    expect(() => fixture("future").desktop.check()).toThrow(new QuickInputDesktopError("unavailable"));
    const f = fixture(); f.win.titlebarStyle = undefined; expect(() => f.desktop.check()).toThrow();
  });
  it("returns the supplied window's own handle even while another window has focus", () => {
    const f = fixture(), target = handle();
    expect(f.desktop.handle({ electronWindow: target } as unknown as Window)).toBe(target);
    expect(f.win.electronWindow.hide).not.toHaveBeenCalled();
    expect(() => f.desktop.handle({} as Window)).toThrow();
    target.isDestroyed = () => true; expect(() => f.desktop.handle({ electronWindow: target } as unknown as Window)).toThrow();
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
  it("requires explicit capabilities for screen and shortcut operations", () => {
    const f = fixture(); expect(f.desktop.shortcuts()).toBe(f.win.electron.remote.globalShortcut);
    const missing = createQuickInputDesktop({ titlebarStyle: "hidden" } as unknown as Window);
    expect(() => missing.check()).toThrow(); expect(() => missing.shortcuts()).toThrow();
  });

  it("clips Windows corners to the CSS radius with zoom, caches identical updates and clears only applied shapes", () => {
    Object.assign(Platform, { isWin: true });
    const f = fixture(), win = f.win as unknown as Window, native = f.win.electronWindow;
    f.desktop.setCornerRadius(win, null); expect(native.setShape).not.toHaveBeenCalled();
    f.desktop.setCornerRadius(win, 24);
    expect(native.setShape).toHaveBeenCalledExactlyOnceWith(buildRoundedWindowShape(480, 270, 24));
    f.desktop.setCornerRadius(win, 24); expect(native.setShape).toHaveBeenCalledOnce();
    native.getBounds.mockReturnValue({ x: 0, y: 0, width: 960, height: 540 });
    native.getContentBounds.mockReturnValue({ x: 0, y: 0, width: 960, height: 540 });
    f.desktop.setCornerRadius(win, 24);
    expect(native.setShape).toHaveBeenLastCalledWith(buildRoundedWindowShape(960, 540, 48));
    f.desktop.setCornerRadius(win, null); expect(native.setShape).toHaveBeenLastCalledWith([]);
    f.desktop.setCornerRadius(win, null); expect(native.setShape).toHaveBeenCalledTimes(3);
  });

  it("does not shape macOS/Linux windows, and requires opacity/shape only on supported platforms", () => {
    const f = fixture(), win = f.win as unknown as Window;
    Reflect.deleteProperty(f.win.electronWindow, "setShape");
    f.desktop.setCornerRadius(win, 24); expect(() => f.desktop.handle(win)).not.toThrow();
    Object.assign(Platform, { isMacOS: true });
    f.desktop.setCornerRadius(win, 24); expect(() => f.desktop.handle(win)).not.toThrow();
    Object.assign(Platform, { isMacOS: false, isWin: true });
    expect(() => f.desktop.handle(win)).toThrow(new QuickInputDesktopError("unavailable"));
    Object.assign(Platform, { isMacOS: true, isWin: false });
    Reflect.deleteProperty(f.win.electronWindow, "setOpacity");
    expect(() => f.desktop.handle(win)).toThrow(new QuickInputDesktopError("unavailable"));
  });

  it("requests a transparent Windows popout only for the host's synchronous popup creation", () => {
    Object.assign(Platform, { isWin: true });
    const f = fixture(), open = f.win.open;
    const result = f.desktop.openPopout(() => { f.win.open("about:blank", "_blank", "popup,width=480,height=270,background=#ffffff"); return "leaf"; });
    expect(result).toEqual({ value: "leaf", transparent: true });
    expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank", "popup,width=480,height=270,background=#00000000,transparent=yes");
    expect(f.win.open).toBe(open);
    expect(f.desktop.openPopout(() => { f.win.open("about:blank", "_blank", "popupish"); f.win.open("https://obsidian.md", "_blank", "popup"); return 1; }))
      .toEqual({ value: 1, transparent: false });
    expect(open).toHaveBeenNthCalledWith(2, "about:blank", "_blank", "popupish");
    expect(open).toHaveBeenNthCalledWith(3, "https://obsidian.md", "_blank", "popup");
    expect(() => f.desktop.openPopout(() => { throw new Error("host failed"); })).toThrow("host failed");
    expect(f.win.open).toBe(open);
  });

  it("leaves popout creation untouched outside Windows and reads the DIP cursor", () => {
    const f = fixture(), open = f.win.open;
    expect(f.desktop.openPopout(() => { f.win.open("about:blank", "_blank", "popup,background=#ffffff"); return "leaf"; })).toEqual({ value: "leaf", transparent: false });
    expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank", "popup,background=#ffffff");
    expect(f.desktop.cursor()).toEqual({ x: -800, y: 20 });
  });

  it("requires native bounds on Windows for edge resizing", () => {
    Object.assign(Platform, { isWin: true });
    const f = fixture(), win = f.win as unknown as Window;
    expect(() => f.desktop.handle(win)).not.toThrow();
    Reflect.deleteProperty(f.win.electronWindow, "setBounds");
    expect(() => f.desktop.handle(win)).toThrow(new QuickInputDesktopError("unavailable"));
  });

  it("uses the target zoom while its renderer still reports the host's initial popout width", () => {
    Object.assign(Platform, { isWin: true });
    const f = fixture();
    f.win.innerWidth = 600;
    const zoom = vi.fn(() => 1.25);
    Object.assign(f.win.electronWindow, { webContents: { getZoomFactor: zoom } });
    f.desktop.setCornerRadius(f.win as unknown as Window, 24);
    expect(f.win.electronWindow.setShape).toHaveBeenCalledExactlyOnceWith(buildRoundedWindowShape(480, 270, 30));
    expect(zoom).toHaveBeenCalledOnce();
  });
});

describe("rounded native window regions", () => {
  it("excludes the four corners while preserving the edges, center and symmetric native resize region", () => {
    const shape = buildRoundedWindowShape(480, 270, 24);
    const contains = (x: number, y: number) => shape.some((rect) => x >= rect.x && y >= rect.y && x < rect.x + rect.width && y < rect.y + rect.height);
    for (const [x, y] of [[0, 0], [479, 0], [0, 269], [479, 269]]) expect(contains(x, y)).toBe(false);
    for (const [x, y] of [[240, 0], [240, 269], [0, 135], [479, 135], [240, 135]]) expect(contains(x, y)).toBe(true);
    for (let y = 0; y < 270; y++) expect(contains(10, y)).toBe(contains(469, 269 - y));
    expect(shape.length).toBeLessThan(49);
  });
  it("handles square corners and clamps an oversized radius to the shorter side", () => {
    expect(buildRoundedWindowShape(320, 200, 0)).toEqual([{ x: 0, y: 0, width: 320, height: 200 }]);
    expect(buildRoundedWindowShape(320, 200, 1000)).toEqual(buildRoundedWindowShape(320, 200, 100));
    expect(buildRoundedWindowShape(320, 200, 24).every((rect) => rect.width > 0 && rect.height > 0)).toBe(true);
  });
});
