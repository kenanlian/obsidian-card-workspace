/** Touch intent only. Listeners never prevent a pointer down or move, so native scrolling wins. */
export function touchMenu(node: HTMLElement, open: (event: MouseEvent) => void) {
  const win = node.ownerDocument.defaultView!;
  let timer: number | null = null;
  let pointer: { id: number; x: number; y: number } | null = null;
  const pointers = new Set<number>();
  let suppressUntil = 0;
  let touchInteraction = false;
  const cancel = () => { if (timer !== null) win.clearTimeout(timer); timer = null; pointer = null; };
  const trackPointer = (event: PointerEvent) => {
    if (event.pointerType === "mouse") return;
    pointers.add(event.pointerId);
    if (pointer && event.pointerId !== pointer.id) cancel();
  };
  const down = (event: PointerEvent) => {
    suppressUntil = 0; touchInteraction = event.pointerType !== "mouse";
    cancel();
    if (!touchInteraction) return;
    pointers.add(event.pointerId);
    if (pointers.size !== 1 || event.pointerType === "mouse" || (event.target as HTMLElement).closest("button,input,textarea,a")) return;
    suppressUntil = 0;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = win.setTimeout(() => {
      const origin = pointer; cancel();
      if (!origin) return;
      suppressUntil = Date.now() + 1200;
      open(new win.MouseEvent("contextmenu", { clientX: origin.x, clientY: origin.y, bubbles: true, cancelable: true }));
    }, 500);
  };
  const move = (event: PointerEvent) => {
    if (pointer && event.pointerId === pointer.id && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) cancel();
  };
  const up = (event: PointerEvent) => { pointers.delete(event.pointerId); cancel(); };
  const suppress = (event: Event) => {
    if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    else if (event.type === "contextmenu") {
      cancel();
      // Some hosts deliver their native long-press menu before our 500ms timer.
      if (touchInteraction) suppressUntil = Date.now() + 1200;
    }
  };
  win.addEventListener("pointerdown", trackPointer, true);
  node.addEventListener("pointerdown", down);
  win.addEventListener("pointermove", move, { passive: true });
  win.addEventListener("pointerup", up); win.addEventListener("pointercancel", up);
  win.addEventListener("scroll", cancel, true); win.addEventListener("blur", cancel);
  node.addEventListener("click", suppress, true); node.addEventListener("contextmenu", suppress, true);
  return { update(next: typeof open) { open = next; }, destroy() {
    cancel(); pointers.clear(); win.removeEventListener("pointerdown", trackPointer, true); node.removeEventListener("pointerdown", down);
    win.removeEventListener("pointermove", move); win.removeEventListener("pointerup", up); win.removeEventListener("pointercancel", up);
    win.removeEventListener("scroll", cancel, true); win.removeEventListener("blur", cancel);
    node.removeEventListener("click", suppress, true); node.removeEventListener("contextmenu", suppress, true);
  } };
}
