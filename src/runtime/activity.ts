import { RuntimeWorkGate } from "./work-gate";

interface DocumentLease { count: number; stop: () => void }
interface Region { refresh: () => void; stop: () => void }

/** Plugin lifetime. Workspace documents count; independent quick input does not. */
export class RuntimeActivity {
  readonly background = new RuntimeWorkGate();
  private readonly documents = new Map<Document, DocumentLease>();
  private readonly regions = new Set<Region>();
  private disposed = false;

  trackDocument(doc: Document): () => void {
    if (this.disposed) return () => {};
    let lease = this.documents.get(doc);
    if (!lease) {
      const changed = () => this.refresh();
      doc.addEventListener("visibilitychange", changed);
      doc.defaultView?.addEventListener?.("resize", changed);
      lease = { count: 0, stop: () => { doc.removeEventListener("visibilitychange", changed); doc.defaultView?.removeEventListener?.("resize", changed); } };
      this.documents.set(doc, lease);
    }
    lease.count++;
    this.refresh();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--lease.count === 0) { lease.stop(); this.documents.delete(doc); }
      this.refresh();
    };
  }

  /** Geometry is also the fallback for hosts without IntersectionObserver.
   * Refresh on existing layout events, never infer visibility from active leaf. */
  observeRegion(element: HTMLElement, gate: RuntimeWorkGate): () => void {
    if (this.disposed) { gate.close(); return () => {}; }
    let doc = element.ownerDocument;
    let releaseDocument = this.trackDocument(doc);
    let intersection: boolean | null = null;
    let observer: IntersectionObserver | null = null;
    let observerGeneration = 0;
    const observe = () => {
      const generation = ++observerGeneration;
      observer?.disconnect();
      const Observer = (doc.defaultView as (Window & { IntersectionObserver?: typeof IntersectionObserver }) | null)?.IntersectionObserver;
      if (Observer) {
        observer = new Observer((entries) => {
          if (generation !== observerGeneration || this.disposed) return;
          const entry = entries.find(item => item.target === element);
          if (entry) intersection = entry.isIntersecting;
          region.refresh();
        });
        observer.observe(element);
      }
    };
    const region: Region = {
      refresh: () => {
        if (element.ownerDocument !== doc) {
          const releasePrevious = releaseDocument;
          doc = element.ownerDocument; releaseDocument = this.trackDocument(doc); releasePrevious();
          intersection = null; observe();
        }
        const rect = element.getBoundingClientRect();
        const style = doc.defaultView?.getComputedStyle(element);
        const win = doc.defaultView;
        const overlapsViewport = !win || !(win.innerWidth > 0 && win.innerHeight > 0)
          || (rect.bottom > 0 && rect.right > 0 && rect.top < win.innerHeight && rect.left < win.innerWidth);
        const visible = element.isConnected && doc.defaultView?.closed !== true && doc.visibilityState !== "hidden"
          && style?.display !== "none" && style?.visibility !== "hidden"
          && rect.width > 0 && rect.height > 0 && overlapsViewport && intersection !== false;
        gate.setActive(visible);
      },
      stop: () => { observerGeneration++; observer?.disconnect(); releaseDocument(); gate.close(); },
    };
    this.regions.add(region); observe(); region.refresh();
    return () => { if (this.regions.delete(region)) region.stop(); };
  }

  refresh(): void {
    if (this.disposed) return;
    // No registered document is a conservative fallback for non-DOM harnesses.
    this.background.setActive(this.documents.size === 0 || [...this.documents.keys()].some(doc => doc.defaultView?.closed !== true && doc.visibilityState !== "hidden"));
    for (const region of this.regions) region.refresh();
  }

  getDiagnostics() {
    return { documents: this.documents.size, visibleDocuments: [...this.documents.keys()].filter(doc => doc.visibilityState !== "hidden").length,
      regions: this.regions.size, background: this.background.getDiagnostics() };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const region of this.regions) region.stop();
    this.regions.clear();
    for (const lease of this.documents.values()) lease.stop();
    this.documents.clear();
    this.background.close();
  }
}
