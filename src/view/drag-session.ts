/** One view's document-owned gesture; source identity never depends on a mounted component. */
export type DragSource =
  | { kind: "cards"; paths: readonly string[]; label?: string }
  | { kind: "navigation-item" | "navigation-section"; rowId: string; label?: string };
export interface DragSnapshot { source: DragSource; mode: "native" | "touch"; x: number; y: number }
export const INTERNAL_CARD_DRAG_MIME = "application/x-card-workspace-cards";
export class DragSession {
  private snapshot: DragSnapshot | null = null;
  private listeners = new Set<(snapshot: DragSnapshot | null) => void>();
  private cleanup: (() => void) | null = null;
  private commit: (() => void) | null = null;
  private pendingCancel: (() => void) | null = null;
  private suppressUntil = 0;
  private suppressionCleanups = new Set<() => void>();
  private ghost: HTMLElement | null = null;
  get current(): DragSnapshot | null { return this.snapshot; }
  subscribe(listener: (snapshot: DragSnapshot | null) => void): () => void {
    this.listeners.add(listener); listener(this.snapshot); return () => this.listeners.delete(listener);
  }
  private publish(): void { for (const listener of this.listeners) listener(this.snapshot); }
  setTarget(commit: (() => void) | null): void { this.commit = commit; }
  move(x: number, y: number): void {
    if (!this.snapshot) return;
    this.snapshot = { ...this.snapshot, x, y };
    this.moveGhost(x, y); this.publish();
  }
  begin(source: DragSource, doc: Document, mode: "native" | "touch", x: number, y: number, origin?: HTMLElement): void {
    this.cancel();
    this.snapshot = { source: source.kind === "cards" ? { ...source, paths: Object.freeze([...source.paths]) } : { ...source }, mode, x, y };
    if (mode === "touch") {
      // Use the owning document in browser stages and secondary windows.
      this.ghost = doc.createElement("div");
      this.ghost.className = "fce-card-drag-ghost fce-touch-drag-ghost";
      this.ghost.textContent = source.label ?? (source.kind === "cards" ? source.paths[0]?.split("/").pop() ?? "" : "");
      if (source.kind === "cards" && source.paths.length > 1) {
        const count = doc.createElement("span"); count.className = "fce-card-drag-count"; count.textContent = String(source.paths.length); this.ghost.append(count);
      }
      this.ghost.setAttribute("aria-hidden", "true"); doc.body.append(this.ghost); this.moveGhost(x, y);
    }
    const win = doc.defaultView;
    const cancel = (): void => this.cancel();
    const key = (event: KeyboardEvent): void => { if (event.key === "Escape") { event.preventDefault(); this.cancel(); } };
    const click = (event: Event): void => { if (this.snapshot?.mode === "touch" || Date.now() < this.suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } };
    const move = (event: TouchEvent): void => {
      if (event.touches.length !== 1) { this.cancel(); return; }
      event.preventDefault(); const touch = event.touches[0]; this.move(touch.clientX, touch.clientY);
    };
    const touchStart = (event: TouchEvent): void => { if (event.touches.length !== 1) this.cancel(); };
    const end = (event: TouchEvent): void => { event.preventDefault(); this.drop(); };
    // TouchEvents can remain targeted at their original node after virtual unmount.
    const detachedMove = (event: TouchEvent): void => { if (!origin?.isConnected) move(event); };
    const detachedEnd = (event: TouchEvent): void => { if (!origin?.isConnected) end(event); };
    const detachedCancel = (): void => { if (!origin?.isConnected) cancel(); };
    const nativeMove = (event: DragEvent): void => this.move(event.clientX, event.clientY);
    doc.addEventListener("keydown", key, true); win?.addEventListener("blur", cancel);
    doc.addEventListener("click", click, true); doc.addEventListener("contextmenu", click, true);
    if (mode === "touch") {
      doc.addEventListener("touchmove", move, { passive: false }); doc.addEventListener("touchstart", touchStart, true);
      doc.addEventListener("touchend", end, { passive: false }); doc.addEventListener("touchcancel", cancel);
      origin?.addEventListener("touchmove", detachedMove, { passive: false }); origin?.addEventListener("touchend", detachedEnd, { passive: false }); origin?.addEventListener("touchcancel", detachedCancel);
    } else {
      doc.addEventListener("dragover", nativeMove); doc.addEventListener("dragend", cancel); doc.addEventListener("drop", cancel);
    }
    this.cleanup = () => {
      doc.removeEventListener("keydown", key, true); win?.removeEventListener("blur", cancel);
      doc.removeEventListener("touchmove", move); doc.removeEventListener("touchstart", touchStart, true);
      doc.removeEventListener("touchend", end); doc.removeEventListener("touchcancel", cancel);
      origin?.removeEventListener("touchmove", detachedMove); origin?.removeEventListener("touchend", detachedEnd); origin?.removeEventListener("touchcancel", detachedCancel);
      doc.removeEventListener("dragover", nativeMove); doc.removeEventListener("dragend", cancel); doc.removeEventListener("drop", cancel);
      // Keep click suppression through the synthetic click following touchend.
      const remove = (): void => { doc.removeEventListener("click", click, true); doc.removeEventListener("contextmenu", click, true); };
      if (mode === "touch" && win) {
        const finish = (): void => { win.clearTimeout(timer); remove(); this.suppressionCleanups.delete(finish); };
        const timer = win.setTimeout(finish, 650); this.suppressionCleanups.add(finish);
      } else remove();
    };
    this.publish();
  }
  private moveGhost(x: number, y: number): void {
    if (this.ghost) { this.ghost.style.left = `${x + 16}px`; this.ghost.style.top = `${y - 48}px`; }
  }
  drop(): void { const commit = this.commit; try { commit?.(); } finally { this.cancel(); } }
  cancel(): void {
    this.pendingCancel?.(); this.pendingCancel = null;
    this.commit = null;
    if (this.snapshot?.mode === "touch") this.suppressUntil = Date.now() + 600;
    this.cleanup?.(); this.cleanup = null;
    this.ghost?.remove(); this.ghost = null;
    if (this.snapshot) { this.snapshot = null; this.publish(); }
  }
  dispose(): void { this.cancel(); for (const cleanup of this.suppressionCleanups) cleanup(); this.listeners.clear(); }
  /** Pending gestures yield to scrolling. Active listeners belong to the document, not this action. */
  bindTouch(node: HTMLElement, source: () => DragSource | null): { destroy: () => void } {
    const doc = node.ownerDocument, win = doc.defaultView;
    if (!win) return { destroy() {} };
    let pending: (() => void) | null = null;
    const start = (event: TouchEvent): void => {
      pending?.();
      if (event.touches.length !== 1 || (event.target as Element).closest("button,input,textarea,select,a,[contenteditable=true],.fce-content-icon-button")) return;
      this.cancel();
      const touch = event.touches[0];
      const { clientX: x, clientY: y, identifier } = touch;
      const cancel = (): void => {
        win.clearTimeout(timer); doc.removeEventListener("touchmove", move); doc.removeEventListener("touchend", cancel);
        doc.removeEventListener("touchcancel", cancel); doc.removeEventListener("touchstart", second, true);
        doc.removeEventListener("scroll", cancel, true); doc.removeEventListener("keydown", key, true); win.removeEventListener("blur", cancel);
        pending = null; if (this.pendingCancel === cancel) this.pendingCancel = null;
      };
      const move = (moveEvent: TouchEvent): void => {
        const current = Array.from(moveEvent.touches).find((entry) => entry.identifier === identifier);
        if (!current || moveEvent.touches.length !== 1 || Math.hypot(current.clientX - x, current.clientY - y) > 8) cancel();
      };
      const key = (event: KeyboardEvent): void => { if (event.key === "Escape") cancel(); };
      const second = (next: TouchEvent): void => { if (next.touches.length !== 1) cancel(); };
      const timer = win.setTimeout(() => { cancel(); const value = source(); if (value) this.begin(value, doc, "touch", x, y, node); }, 500);
      pending = cancel; this.pendingCancel = cancel;
      doc.addEventListener("touchmove", move, { passive: false }); doc.addEventListener("touchend", cancel);
      doc.addEventListener("touchcancel", cancel); doc.addEventListener("touchstart", second, true);
      doc.addEventListener("scroll", cancel, true); doc.addEventListener("keydown", key, true); win.addEventListener("blur", cancel);
    };
    const contextmenu = (event: Event): void => {
      if (pending) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    node.addEventListener("touchstart", start, { passive: false });
    node.addEventListener("contextmenu", contextmenu, true);
    return { destroy: () => { pending?.(); node.removeEventListener("touchstart", start); node.removeEventListener("contextmenu", contextmenu, true); } };
  }
}
