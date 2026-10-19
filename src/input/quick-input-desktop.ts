import { Platform } from "obsidian";
import { prepareQuickInputDocument } from "./quick-input-document";

export const QUICK_INPUT_VIEW = "card-workspace-quick-input";
export interface QuickInputRectangle { x: number; y: number; width: number; height: number }
/** Capability-checked host internals, verified against Obsidian 1.11.4.
 * Never resolve a target through the currently focused Electron window.
 */
export interface QuickInputWindowHandle {
  readonly id: number;
  isDestroyed(): boolean;
  show(): void;
  showInactive(): void;
  focus(): void;
  moveTop(): void;
  setParentWindow(parent: null): void;
  setAlwaysOnTop(value: boolean): void;
  setMinimumSize(width: number, height: number): void;
  setContentSize(width: number, height: number): void;
  getBounds(): QuickInputRectangle;
  getContentBounds(): QuickInputRectangle;
  setBounds(bounds: QuickInputRectangle): void;
  setResizable(value: boolean): void;
  webContents: { getZoomFactor(): number; setZoomFactor(factor: number): void; setBackgroundThrottling(allowed: boolean): void };
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
interface WindowCreationDetails { frameName: string; options: { frame?: boolean; transparent?: boolean; thickFrame?: boolean; roundedCorners?: boolean; hasShadow?: boolean; show?: boolean } }
type WindowCreatedListener = (handle: QuickInputWindowHandle, details: WindowCreationDetails) => void;
interface WindowCreationEvents {
  on(event: "did-create-window", listener: WindowCreatedListener): void;
  removeListener(event: "did-create-window", listener: WindowCreatedListener): void;
}
type DesktopWindow = Window & {
  titlebarStyle?: string;
  electronWindow?: QuickInputWindowHandle;
  electron?: { remote?: { screen?: ScreenBridge; globalShortcut?: QuickInputShortcutBridge; getCurrentWindow?(): QuickInputWindowHandle; getCurrentWebContents?(): WindowCreationEvents } };
  require?: (id: string) => unknown;
  app?: unknown;
};
export class QuickInputDesktopError extends Error {
  constructor(readonly code: "native-frame" | "unavailable") { super(code); }
}
export interface QuickInputPlacement { x: number; y: number; width: number; height: number; displayId?: number }
export interface QuickInputDesktopWindow { win: Window; handle: QuickInputWindowHandle; dispose(): void }
export interface QuickInputDesktop {
  check(): void;
  /** Creates a hidden document, ready for its native editor to be mounted. */
  createWindow(options: { id: string; placement: QuickInputPlacement; signal: AbortSignal }): Promise<QuickInputDesktopWindow>;
  cursor(): { x: number; y: number };
  position(source: Window | undefined, width: number, height: number, ordinal: number): QuickInputPlacement;
  shortcuts(): QuickInputShortcutBridge;
}

function resolveWindowHandle(win: DesktopWindow): QuickInputWindowHandle {
  // Resolve inside the child Node environment. The vault's remote.getCurrentWindow
  // would target the main window even if the draft had focus.
  const electron = win.require?.("electron") as { remote?: { getCurrentWindow(): QuickInputWindowHandle } } | undefined;
  const remote = electron?.remote ?? win.require?.("@electron/remote") as { getCurrentWindow(): QuickInputWindowHandle } | undefined;
  const value = remote?.getCurrentWindow();
  const methods = ["isDestroyed", "show", "showInactive", "focus", "moveTop", "setParentWindow", "setAlwaysOnTop", "setMinimumSize", "setContentSize", "getBounds", "getContentBounds", "setBounds", "setResizable"] as const;
  if (!value || !Number.isInteger(value.id) || methods.some((name) => typeof value[name] !== "function") || value.isDestroyed()
    || !value.webContents?.getZoomFactor || !value.webContents.setZoomFactor || !value.webContents.setBackgroundThrottling) {
    throw new QuickInputDesktopError("unavailable");
  }
  if (electron && !electron.remote) electron.remote = remote;
  win.electron = electron;
  win.electronWindow = value;
  return value;
}

export function createQuickInputDesktop(mainWindow: Window): QuickInputDesktop {
  const host = mainWindow as DesktopWindow;
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
    async createWindow({ id, placement, signal }) {
      this.check();
      if (signal.aborted) throw new QuickInputDesktopError("unavailable");
      // The host's main-process popup handler (1.11.4–1.14.4) creates these hidden.
      // Bypass its renderer popout helper, which adds chrome, style/focus relays
      // and an unconditional show before a draft can finish initializing.
      const features = ["popup", "show=no", "frame=no", "transparent=yes", "background=#00000000", "hasShadow=no", "roundedCorners=no", "thickFrame=no", "backgroundMaterial=none",
        `x=${placement.x}`, `y=${placement.y}`, `width=${placement.width}`, `height=${placement.height}`].join(",");
      const contents = host.electron?.remote?.getCurrentWebContents?.();
      if (!contents?.on || !contents.removeListener) throw new QuickInputDesktopError("unavailable");
      let createdListener: WindowCreatedListener;
      const created = new Promise<number>((resolve, reject) => {
        createdListener = (native, { frameName, options }) => {
          if (frameName !== id) return;
          // A newer installer may ignore unknown window.open features. Verify
          // the actual constructor options instead of treating a request as proof.
          if (options.frame !== false || options.show !== false || options.transparent !== true
            || options.thickFrame !== false || options.roundedCorners !== false || options.hasShadow !== false) {
            reject(new QuickInputDesktopError("unavailable"));
          } else resolve(native.id);
        };
        contents.on("did-create-window", createdListener);
      });
      const stopObserving = () => contents.removeListener("did-create-window", createdListener);
      // Setup can fail before the aggregate readiness promise is installed.
      void created.catch(() => {});
      let win: DesktopWindow | null;
      try { win = host.open("about:blank", id, features); }
      catch (error) { stopObserving(); throw error; }
      if (!win || win === host) { stopObserving(); throw new QuickInputDesktopError("unavailable"); }
      let handle: QuickInputWindowHandle | undefined;
      let documentRuntime: ReturnType<typeof prepareQuickInputDocument> | undefined;
      let disposed = false;
      let rejectClosed: (() => void) | undefined;
      const closed = new Promise<never>((_resolve, reject) => { rejectClosed = () => reject(new QuickInputDesktopError("unavailable")); });
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        stopObserving();
        signal.removeEventListener("abort", dispose);
        win.removeEventListener("unload", dispose);
        host.clearTimeout(timeout);
        rejectClosed?.();
        documentRuntime?.dispose();
        try {
          if (handle && !handle.isDestroyed()) handle.webContents.setBackgroundThrottling(true);
        } catch (error) { console.warn("[card-workspace] Quick input renderer cleanup failed", error); }
        if (!win.closed) win.close();
      };
      const timeout = host.setTimeout(dispose, 10_000);
      signal.addEventListener("abort", dispose, { once: true });
      win.addEventListener("unload", dispose, { once: true });
      try {
        const resolved = resolveWindowHandle(win);
        if (resolved.id === host.electronWindow?.id) throw new QuickInputDesktopError("unavailable");
        handle = resolved;
        handle.setParentWindow(null);
        handle.setAlwaysOnTop(false);
        // Transparent windows have no native resize frame; setBounds remains
        // available to our eight handles even when native resizing is disabled.
        handle.setResizable(false);
        handle.setMinimumSize(320, 200);
        handle.webContents.setBackgroundThrottling(false);
        handle.webContents.setZoomFactor(host.electronWindow?.webContents.getZoomFactor() ?? 1);
        handle.setContentSize(placement.width, placement.height);
        const { x, y, width, height } = placement;
        handle.setBounds({ x, y, width, height });
        if (Platform.isMacOS) {
          if (!handle.setWindowButtonVisibility) throw new QuickInputDesktopError("unavailable");
          handle.setWindowButtonVisibility(false);
        }
        win.app = host.app;
        documentRuntime = prepareQuickInputDocument(host, win);
        const ready = Promise.all([documentRuntime.ready, created]).then(([, nativeId]) => {
          if (nativeId !== resolved.id) throw new QuickInputDesktopError("unavailable");
        });
        await Promise.race([ready, closed]);
        stopObserving();
        host.clearTimeout(timeout);
        if (disposed || signal.aborted || win.closed || handle.isDestroyed()) throw new QuickInputDesktopError("unavailable");
        return { win, handle, dispose };
      } catch (error) {
        // Observe the cancellation promise even when synchronous setup failed.
        void closed.catch(() => {});
        dispose();
        if (!signal.aborted) console.warn("[card-workspace] Quick input document unavailable", error);
        throw new QuickInputDesktopError("unavailable");
      }
    },
    cursor() { return screen().getCursorScreenPoint(); },
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
