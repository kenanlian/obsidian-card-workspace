import type { QuickInputRectangle, QuickInputWindowHandle } from "./quick-input-desktop";

interface DragOptions {
  grip: HTMLElement;
  handle: QuickInputWindowHandle;
  /** Screen point in DIPs, independent of editor zoom and window movement. */
  cursor: () => { x: number; y: number };
}

/** Native app-region dragging suppresses CSS cursors. Use pointer capture so
 * the grip can show grab/grabbing while moving only its own native window. */
export function installQuickInputDrag({ grip, handle, cursor }: DragOptions): () => void {
  let drag: { pointerId: number; start: QuickInputRectangle; origin: { x: number; y: number } } | null = null;
  const stop = () => {
    const previous = drag;
    drag = null;
    grip.classList.remove("is-dragging");
    if (previous && grip.hasPointerCapture?.(previous.pointerId)) grip.releasePointerCapture(previous.pointerId);
  };
  const guarded = (action: () => void) => {
    try { action(); }
    catch (error) { stop(); console.warn("[card-workspace] Quick input drag failed", error); }
  };
  const apply = () => {
    if (!drag) return;
    if (handle.isDestroyed()) { stop(); return; }
    const point = cursor();
    handle.setBounds({ ...drag.start,
      x: Math.round(drag.start.x + point.x - drag.origin.x),
      y: Math.round(drag.start.y + point.y - drag.origin.y),
    });
  };
  const cleanups: Array<() => void> = [];
  const listen = (type: string, handler: (event: PointerEvent) => void) => {
    const listener = (event: Event) => handler(event as PointerEvent);
    grip.addEventListener(type, listener);
    cleanups.push(() => grip.removeEventListener(type, listener));
  };
  listen("pointerdown", (event) => {
    if (event.button !== 0 || event.isPrimary === false || drag || handle.isDestroyed()) return;
    event.preventDefault();
    guarded(() => {
      drag = { pointerId: event.pointerId, start: handle.getBounds(), origin: cursor() };
      grip.setPointerCapture(event.pointerId);
      grip.classList.add("is-dragging");
    });
  });
  listen("pointermove", (event) => { if (drag?.pointerId === event.pointerId) guarded(apply); });
  const finish = (event: PointerEvent) => {
    if (drag?.pointerId !== event.pointerId) return;
    if (event.type === "pointerup") guarded(apply);
    stop();
  };
  listen("pointerup", finish);
  listen("pointercancel", finish);
  listen("lostpointercapture", finish);
  const win = grip.ownerDocument.defaultView!;
  win.addEventListener("blur", stop);
  cleanups.push(() => win.removeEventListener("blur", stop));
  return () => { stop(); cleanups.forEach((cleanup) => cleanup()); };
}
