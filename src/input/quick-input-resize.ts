import type { QuickInputRectangle, QuickInputWindowHandle } from "./quick-input-desktop";

export type QuickInputResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const QUICK_INPUT_RESIZE_EDGES: readonly QuickInputResizeEdge[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Moves only the dragged edges; the opposite edges stay anchored at the minimum size. */
export function resizeQuickInputBounds(start: QuickInputRectangle, edge: QuickInputResizeEdge, dx: number, dy: number,
  minWidth: number, minHeight: number): QuickInputRectangle {
  let { x, y, width, height } = start;
  if (edge.includes("e")) width = Math.max(minWidth, start.width + dx);
  if (edge.includes("w")) { width = Math.max(minWidth, start.width - dx); x = start.x + start.width - width; }
  if (edge.includes("s")) height = Math.max(minHeight, start.height + dy);
  if (edge.includes("n")) { height = Math.max(minHeight, start.height - dy); y = start.y + start.height - height; }
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

interface ResizeOptions {
  root: HTMLElement;
  handle: QuickInputWindowHandle;
  /** Screen point in DIPs, the same space as native window bounds. */
  cursor: () => { x: number; y: number };
  minWidth: number;
  minHeight: number;
}

/** Transparent Windows windows have no native thick frame, so edges resize through
 * pointer capture. Chromium delivers pointermove at most once per frame. */
export function installQuickInputResize({ root, handle, cursor, minWidth, minHeight }: ResizeOptions): () => void {
  let drag: { edge: QuickInputResizeEdge; pointerId: number; start: QuickInputRectangle; origin: { x: number; y: number } } | null = null;
  const apply = () => {
    if (!drag || handle.isDestroyed()) return;
    const point = cursor();
    handle.setBounds!(resizeQuickInputBounds(drag.start, drag.edge, point.x - drag.origin.x, point.y - drag.origin.y, minWidth, minHeight));
  };
  const guarded = (action: () => void) => {
    try { action(); }
    catch (error) { drag = null; console.warn("[card-workspace] Quick input resize failed", error); }
  };
  const cleanups: Array<() => void> = [];
  for (const edge of QUICK_INPUT_RESIZE_EDGES) {
    const el = root.createDiv({ cls: "fce-quick-input-resize", attr: { "data-edge": edge, "aria-hidden": "true" } });
    const listen = (type: string, handler: (event: PointerEvent) => void) => {
      const listener = (event: Event) => handler(event as PointerEvent);
      el.addEventListener(type, listener);
      cleanups.push(() => el.removeEventListener(type, listener));
    };
    listen("pointerdown", (event) => {
      if (event.button !== 0 || drag || handle.isDestroyed()) return;
      event.preventDefault();
      guarded(() => {
        drag = { edge, pointerId: event.pointerId, start: handle.getBounds(), origin: cursor() };
        el.setPointerCapture?.(event.pointerId);
      });
    });
    listen("pointermove", (event) => { if (drag?.pointerId === event.pointerId) guarded(apply); });
    const finish = (event: PointerEvent) => {
      if (drag?.pointerId !== event.pointerId) return;
      if (event.type === "pointerup") guarded(apply);
      drag = null;
      if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
    };
    listen("pointerup", finish);
    listen("pointercancel", finish);
    listen("lostpointercapture", finish);
    cleanups.push(() => el.remove());
  }
  return () => { drag = null; cleanups.forEach((cleanup) => cleanup()); };
}
