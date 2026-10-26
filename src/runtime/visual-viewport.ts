/** Use the owning window, coalesce keyboard/rotation updates, and release every listener/frame. */
export function installVisualViewport(root: HTMLElement): () => void {
  const win = root.ownerDocument.defaultView!;
  const viewport = win.visualViewport;
  let frame = 0;
  const update = () => {
    frame = 0;
    root.style.setProperty("--fce-viewport-height", `${viewport?.height ?? win.innerHeight}px`);
    root.style.setProperty("--fce-viewport-top", `${viewport?.offsetTop ?? 0}px`);
    root.style.setProperty("--fce-region-height", `${Math.max(0, (viewport?.height ?? win.innerHeight) + (viewport?.offsetTop ?? 0) - Math.max(root.getBoundingClientRect().top, viewport?.offsetTop ?? 0))}px`);
  };
  const schedule = () => { if (!frame) frame = win.requestAnimationFrame(update); };
  update();
  win.addEventListener("resize", schedule);
  viewport?.addEventListener("resize", schedule); viewport?.addEventListener("scroll", schedule);
  return () => {
    win.removeEventListener("resize", schedule); viewport?.removeEventListener("resize", schedule); viewport?.removeEventListener("scroll", schedule);
    if (frame) win.cancelAnimationFrame(frame);
    root.style.removeProperty("--fce-region-height"); root.style.removeProperty("--fce-viewport-height"); root.style.removeProperty("--fce-viewport-top");
  };
}
