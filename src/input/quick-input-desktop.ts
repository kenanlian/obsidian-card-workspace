import { Platform } from "obsidian";

export const QUICK_INPUT_VIEW = "card-workspace-quick-input";
export interface QuickInputRectangle { x: number; y: number; width: number; height: number }
/** Capability-checked host internals, verified against Obsidian 1.11.4.
 * Never resolve a target through the currently focused Electron window.
 */
export interface QuickInputWindowHandle {
  isDestroyed(): boolean;
  hide(): void;
  show(): void;
  focus(): void;
  moveTop(): void;
  setParentWindow(parent: null): void;
  setAlwaysOnTop(value: boolean): void;
  setMinimumSize(width: number, height: number): void;
  setContentSize(width: number, height: number): void;
  getBounds(): QuickInputRectangle;
  getContentBounds(): QuickInputRectangle;
  setPosition(x: number, y: number): void;
  setBounds?(bounds: QuickInputRectangle): void;
  setOpacity?(opacity: number): void;
  setShape?(rectangles: QuickInputRectangle[]): void;
  webContents?: { getZoomFactor(): number; setBackgroundThrottling?(allowed: boolean): void };
  setWindowButtonVisibility?(visible: boolean): void;
}
export interface QuickInputShortcutBridge {
  register(accelerator: string, callback: () => void): boolean;
  isRegistered(accelerator: string): boolean;
  unregister(accelerator: string): void;
}
interface ScreenBridge {
  getCursorScreenPoint(): { x: number; y: number };
  getDisplayNearestPoint(point: { x: number; y: number }): { id: number; workArea: { x: number; y: number; width: number; height: number } };
}
type DesktopWindow = Window & {
  titlebarStyle?: string;
  electronWindow?: QuickInputWindowHandle;
  electron?: { remote?: { screen?: ScreenBridge; globalShortcut?: QuickInputShortcutBridge } };
};
export class QuickInputDesktopError extends Error {
  constructor(readonly code: "native-frame" | "unavailable") { super(code); }
}
export interface QuickInputPlacement { x: number; y: number; width: number; height: number; displayId?: number }
export interface QuickInputDesktop {
  check(): void;
  /** Runs the host's synchronous popout creation, requesting a transparent native window where supported. */
  openPopout<T>(open: () => T): { value: T; transparent: boolean };
  cursor(): { x: number; y: number };
  handle(win: Window): QuickInputWindowHandle;
  position(source: Window | undefined, width: number, height: number, ordinal: number): QuickInputPlacement;
  setCornerRadius(win: Window, cssRadius: number | null): void;
  shortcuts(): QuickInputShortcutBridge;
}

/** Electron window regions use DIP rectangles, including the transparent corners'
 * hit-test region. Merge adjacent scanlines to keep each update small. */
export function buildRoundedWindowShape(width: number, height: number, radius: number): QuickInputRectangle[] {
  radius = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (!radius) return [{ x: 0, y: 0, width, height }];
  const rectangles: QuickInputRectangle[] = [];
  const rows = Math.ceil(radius);
  for (let y = 0; y < rows; y++) {
    const dy = Math.max(0, radius - y - 0.5);
    const inset = Math.ceil(radius - Math.sqrt(radius * radius - dy * dy));
    const previous = rectangles[rectangles.length - 1];
    if (previous?.x === inset) previous.height++;
    else rectangles.push({ x: inset, y, width: width - inset * 2, height: 1 });
  }
  const bottom = rectangles.map((rect) => ({ ...rect, y: height - rect.y - rect.height })).reverse();
  if (height > rows * 2) rectangles.push({ x: 0, y: rows, width, height: height - rows * 2 });
  return [...rectangles, ...bottom];
}

export function createQuickInputDesktop(mainWindow: Window): QuickInputDesktop {
  const host = mainWindow as DesktopWindow;
  const shapes = new WeakMap<Window, string>();
  function screen(): ScreenBridge {
    const value = host.electron?.remote?.screen;
    if (!value?.getCursorScreenPoint || !value.getDisplayNearestPoint) throw new QuickInputDesktopError("unavailable");
    return value;
  }
  return {
    check() {
      if (host.titlebarStyle === "native") throw new QuickInputDesktopError("native-frame");
      if (host.titlebarStyle !== "hidden" && host.titlebarStyle !== "custom") throw new QuickInputDesktopError("unavailable");
      screen();
    },
    openPopout(open) {
      if (!Platform.isWin) return { value: open(), transparent: false };
      // Obsidian 1.11.4–1.14.4 open popouts via window.open("about:blank", "_blank", "popup,...").
      // Its main process overrides only position, size and background, and Electron
      // merges the remaining features, so transparency must be requested at creation.
      const own = Object.getOwnPropertyDescriptor(host, "open");
      const original = host.open.bind(host);
      let transparent = false;
      host.open = (url?: string | URL, target?: string, features?: string) => {
        if (url === "about:blank" && typeof features === "string" && features.split(",")[0] === "popup") {
          transparent = true;
          features = [...features.split(",").filter((part) => !/^(background|transparent)=/.test(part)), "background=#00000000", "transparent=yes"].join(",");
        }
        return original(url, target, features);
      };
      try {
        const value = open();
        return { value, transparent };
      } finally {
        if (own) Object.defineProperty(host, "open", own);
        else Reflect.deleteProperty(host, "open");
      }
    },
    cursor() { return screen().getCursorScreenPoint(); },
    handle(win) {
      const value = (win as DesktopWindow).electronWindow;
      const methods = ["isDestroyed", "hide", "show", "focus", "moveTop", "setParentWindow", "setAlwaysOnTop", "setMinimumSize", "setContentSize", "getBounds", "getContentBounds", "setPosition"] as const;
      if (!value || methods.some((name) => typeof value[name] !== "function") || value.isDestroyed()
        || ((Platform.isWin || Platform.isMacOS) && typeof value.setOpacity !== "function")
        || (Platform.isWin && (typeof value.setShape !== "function" || typeof value.setBounds !== "function"))) throw new QuickInputDesktopError("unavailable");
      return value;
    },
    setCornerRadius(win, cssRadius) {
      if (!Platform.isWin) return;
      const handle = this.handle(win);
      if (cssRadius === null) {
        if (shapes.delete(win)) handle.setShape!([]);
        return;
      }
      const { width, height } = handle.getBounds();
      // Native sizing can complete before the renderer receives its resize event.
      // Prefer the target's zoom factor so the first region uses the final radius.
      const zoom = handle.webContents?.getZoomFactor()
        ?? (win.innerWidth > 0 ? handle.getContentBounds().width / win.innerWidth : 1);
      const radius = cssRadius * zoom;
      const key = `${width}/${height}/${radius}`;
      if (shapes.get(win) === key) return;
      handle.setShape!(buildRoundedWindowShape(width, height, radius));
      shapes.set(win, key);
    },
    position(source, width, height, ordinal) {
      const display = screen().getDisplayNearestPoint(source
        ? { x: source.screenX + source.outerWidth / 2, y: source.screenY + source.outerHeight / 2 }
        : screen().getCursorScreenPoint());
      const area = display.workArea;
      width = Math.min(area.width, Math.max(320, width)); height = Math.min(area.height, Math.max(200, height));
      const offset = (ordinal % 8) * 24;
      return { width, height, displayId: display.id,
        x: Math.round(Math.max(area.x, Math.min(area.x + area.width - width, area.x + (area.width - width) / 2 + offset))),
        y: Math.round(Math.max(area.y, Math.min(area.y + area.height - height, area.y + (area.height - height) / 2 + offset))),
      };
    },
    shortcuts() {
      const value = host.electron?.remote?.globalShortcut;
      if (!value?.register || !value.unregister || !value.isRegistered) throw new QuickInputDesktopError("unavailable");
      return value;
    },
  };
}
