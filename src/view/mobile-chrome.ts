import type { App } from "obsidian";

/** Collapsing the chrome resizes the card list; the clamp it causes must not toggle the chrome back. */
export const CHROME_SETTLE_MS = 350;
export const HIDDEN_NAV_CLASS = "is-hidden-nav";

interface HostMobileNavbar {
  onScroll(key: unknown, scrollTop: number): void;
}

/** Host-internal phone navbar that hides the view header and bottom navbar while notes scroll. */
export function resolveHostMobileNavbar(app: App): HostMobileNavbar | null {
  const navbar = (app as App & { mobileNavbar?: Partial<HostMobileNavbar> }).mobileNavbar;
  return typeof navbar?.onScroll === "function" ? (navbar as HostMobileNavbar) : null;
}

export interface ChromeScrollGate {
  /** Returns whether this scroll sample may be forwarded to the host. */
  accept(hidden: boolean, now: number): boolean;
  /** Records the hidden state after the host processed a sample. */
  settle(hidden: boolean, now: number): void;
}

export function createChromeScrollGate(initiallyHidden: boolean): ChromeScrollGate {
  let lastHidden = initiallyHidden;
  let settleUntil = 0;
  const observe = (hidden: boolean, now: number): void => {
    if (hidden === lastHidden) return;
    lastHidden = hidden;
    settleUntil = now + CHROME_SETTLE_MS;
  };
  return {
    accept(hidden, now) { observe(hidden, now); return now >= settleUntil; },
    settle: observe,
  };
}

export interface MobileChromeAutoHide {
  dispose(): void;
}

const TOOLBAR_HEIGHT_PROPERTY = "--fce-toolbar-height";

/** Matches the host header's transform transition. */
export const CHROME_SLIDE_MS = 300;

/**
 * Forwards card-list scrolling to the host navbar, as Markdown views do. The host owns the
 * `autoFullScreen` preference, keyboard suppression and restoring on tap or leaf change;
 * CSS keyed on its body class collapses the toolbar and the header's reserved spacing.
 *
 * That collapse changes layout once, without a transition, so the virtual list measures a
 * single resize. The card pane is then slid from its previous position with a
 * compositor-only transform.
 */
export function installMobileChromeAutoHide(app: App, hostEl: HTMLElement): MobileChromeAutoHide | null {
  const navbar = resolveHostMobileNavbar(app);
  if (!navbar) return null;
  const doc = hostEl.ownerDocument;
  const win = doc.defaultView ?? window;
  const isHidden = (): boolean => doc.body.classList.contains(HIDDEN_NAV_CLASS);
  const gate = createChromeScrollGate(isHidden());
  const listEl = (): HTMLElement | null => hostEl.querySelector<HTMLElement>(".fce-list");
  /** The shell measures its own top for its viewport height, so the slide stays inside it. */
  const slideEl = (): HTMLElement | null => hostEl.querySelector<HTMLElement>(".fce-main-pane");
  let slide: Animation | null = null;
  let layoutListTop: number | null = null;
  /** Hidden leaves measure as zero; they have no position to slide from. */
  const measureListTop = (): number | null => {
    const rect = listEl()?.getBoundingClientRect();
    return rect && rect.height > 0 ? rect.top : null;
  };
  const recordListTop = (): void => {
    if (slide?.playState !== "running") layoutListTop = measureListTop();
  };
  const onScroll = (event: Event): void => {
    const list = event.target as HTMLElement | null;
    if (!list?.classList?.contains("fce-list")) return;
    if (!gate.accept(isHidden(), win.performance.now())) return;
    recordListTop();
    navbar.onScroll(list, list.scrollTop);
    gate.settle(isHidden(), win.performance.now());
  };
  let lastHidden = isHidden();
  const onBodyClassChange = (): void => {
    const hidden = isHidden();
    if (hidden === lastHidden) return;
    lastHidden = hidden;
    const previousTop = layoutListTop;
    slide?.cancel(); slide = null;
    const top = measureListTop();
    layoutListTop = top;
    if (previousTop === null || top === null) return;
    const offset = previousTop - top;
    const target = slideEl();
    if (Math.abs(offset) < 1 || typeof target?.animate !== "function"
      || win.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    slide = target.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0)" }],
      { duration: CHROME_SLIDE_MS, easing: "ease-in-out" },
    );
  };
  const bodyObserver = typeof win.MutationObserver === "function" ? new win.MutationObserver(onBodyClassChange) : null;
  bodyObserver?.observe(doc.body, { attributes: true, attributeFilter: ["class"] });
  const toolbarEl = hostEl.querySelector<HTMLElement>(".fce-header");
  const measureToolbar = (): void => {
    if (toolbarEl) hostEl.style.setProperty(TOOLBAR_HEIGHT_PROPERTY, `${toolbarEl.offsetHeight}px`);
    recordListTop();
  };
  const toolbarObserver = toolbarEl && typeof win.ResizeObserver === "function" ? new win.ResizeObserver(measureToolbar) : null;
  measureToolbar();
  if (toolbarEl) toolbarObserver?.observe(toolbarEl);
  hostEl.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return {
    dispose() {
      hostEl.removeEventListener("scroll", onScroll, { capture: true });
      bodyObserver?.disconnect();
      toolbarObserver?.disconnect();
      slide?.cancel();
      hostEl.style.removeProperty(TOOLBAR_HEIGHT_PROPERTY);
    },
  };
}
