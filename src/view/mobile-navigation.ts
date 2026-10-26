import { Modal, type App } from "obsidian";
interface Options { app?: App; enabled: boolean; visible: boolean; onClose?: () => void }
/** Moves the existing navigation DOM into a host Modal; its component and model stay mounted. */
export function mobileNavigation(node: HTMLElement, options: Options) {
  const marker = node.ownerDocument.createComment("navigation home");
  node.before(marker);
  let modal: Modal | null = null;
  const programmaticClose = new WeakSet<Modal>();
  const restore = () => { marker.after(node); };
  const close = () => {
    if (!modal) return;
    const current = modal; modal = null;
    programmaticClose.add(current); restore(); current.close();
  };
  const update = (next: Options) => {
    options = next;
    if (!next.enabled || !next.visible || !next.app) { close(); return; }
    if (modal) return;
    modal = new Modal(next.app);
    modal.modalEl.addClass("folder-card-view", "fce-mobile-navigation");
    const current = modal;
    modal.onClose = () => {
      if (modal === current) { restore(); modal = null; if (!programmaticClose.has(current)) options.onClose?.(); }
    };
    modal.contentEl.append(node);
    modal.open();
  };
  update(options);
  return { update, destroy() { close(); marker.remove(); } };
}
