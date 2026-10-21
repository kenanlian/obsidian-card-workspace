/** The editor runs in the vault's renderer; this document supplies its DOM realm,
 * theme and host event routing without constructing a workspace popout. */
export function prepareQuickInputDocument(hostWindow: Window, targetWindow: Window): { ready: Promise<void>; dispose(): void } {
  type DomWindow = Window & { MutationObserver: typeof MutationObserver; createFragment: typeof createFragment };
  const host = hostWindow as DomWindow;
  const win = targetWindow as DomWindow;
  const doc = win.document;
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) cleanup();
  };
  const listen = (target: EventTarget, type: string, callback: EventListener, capture = false) => {
    target.addEventListener(type, callback, capture);
    cleanups.push(() => target.removeEventListener(type, callback, capture));
  };
  const load = (element: HTMLScriptElement | HTMLLinkElement): Promise<void> => new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      element.removeEventListener("load", loaded);
      element.removeEventListener("error", failed);
      if (error) reject(error); else resolve();
    };
    const loaded = () => finish();
    const failed = () => finish(new Error("Quick input host resource failed to load"));
    element.addEventListener("load", loaded);
    element.addEventListener("error", failed);
    cleanups.push(() => finish(new Error("Quick input document closed")));
  });
  try {
    // Create the bootstrap nodes with the already enhanced host, then adopt them
    // into the child. Its own DOM helpers do not exist until the script loads.
    const fragment = host.createFragment();
    const base = fragment.createEl("base");
    base.href = host.document.baseURI;
    doc.head.appendChild(base);
    cleanups.push(() => base.remove());
    doc.documentElement.classList.add("fce-quick-input-window");

    // Use the installed host's own realm initializer, as its popouts do. Loading
    // its local resource avoids eval, copied host code and a second app runtime.
    const source = host.document.querySelector<HTMLScriptElement>('script[src="enhance.js"], script[src$="/enhance.js"]');
    if (!source?.src) throw new Error("Missing host DOM initializer");
    const script = fragment.createEl("script");
    script.src = source.src;
    const enhanced = load(script);
    doc.head.appendChild(script);
    cleanups.push(() => script.remove());

    const relayed = new Map<Element, Element>();
    const loads: Promise<void>[] = [];
    const syncStyles = (initial = false) => {
      const sources = new Set<Element>();
      for (const source of Array.from(host.document.head.querySelectorAll<HTMLStyleElement | HTMLLinkElement>('style, link[rel="stylesheet"]'))) {
        // CodeMirror mounts its own StyleModules in each editor document.
        let text = source.textContent ?? "";
        if (source.tagName === "STYLE" && !text && source.sheet) {
          try { text = Array.from(source.sheet.cssRules, (rule) => rule.cssText).join("\n"); }
          catch { /* A cross-origin stylesheet is still relayed by its link. */ }
        }
        if (text.includes("ͼ1")) continue;
        sources.add(source);
        let clone = relayed.get(source);
        if (!clone) {
          clone = doc.importNode(source, true);
          relayed.set(source, clone);
          if (initial && source.tagName === "LINK" && !(source as HTMLLinkElement).disabled) loads.push(load(clone as HTMLLinkElement));
          doc.head.appendChild(clone);
        }
        for (const attribute of Array.from(clone.attributes)) {
          if (!source.hasAttribute(attribute.name)) clone.removeAttribute(attribute.name);
        }
        for (const attribute of Array.from(source.attributes)) {
          if (clone.getAttribute(attribute.name) !== attribute.value) clone.setAttribute(attribute.name, attribute.value);
        }
        if (source.tagName === "STYLE" && clone.textContent !== text) clone.textContent = text;
      }
      for (const [source, clone] of relayed) {
        if (!sources.has(source)) { clone.remove(); relayed.delete(source); }
      }
      // Move only when the host's cascade order changed; never replace the head
      // or disturb editor-owned styles and already loaded stylesheet links.
      let previous: Element | null = script;
      for (const source of sources) {
        const clone = relayed.get(source)!;
        if (previous.nextElementSibling !== clone) previous.after(clone);
        previous = clone;
      }
    };
    syncStyles(true);
    cleanups.push(() => { for (const clone of relayed.values()) clone.remove(); relayed.clear(); });

    let classes = new Set<string>();
    let properties = new Set<string>();
    const windowClasses = new Set(["is-focused", "is-frameless", "is-popout-window", "is-fullscreen"]);
    const syncBody = () => {
      const next = new Set(Array.from(host.document.body.classList).filter((name) => !windowClasses.has(name)));
      for (const name of classes) if (!next.has(name)) doc.body.classList.remove(name);
      for (const name of next) doc.body.classList.add(name);
      classes = next;
      const nextProperties = new Set<string>();
      for (const name of Array.from(host.document.body.style)) {
        if (!name.startsWith("--") || name === "--zoom-factor" || name === "--keyboard-height") continue;
        nextProperties.add(name);
        doc.body.style.setProperty(name, host.document.body.style.getPropertyValue(name));
      }
      for (const name of properties) if (!nextProperties.has(name)) doc.body.style.removeProperty(name);
      properties = nextProperties;
      doc.documentElement.style.fontSize = host.getComputedStyle(host.document.body).fontSize;
      doc.documentElement.lang = host.document.documentElement.lang;
    };
    syncBody();
    const headObserver = new host.MutationObserver(() => syncStyles());
    headObserver.observe(host.document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    const bodyObserver = new host.MutationObserver(syncBody);
    bodyObserver.observe(host.document.body, { attributes: true, attributeFilter: ["class", "style"] });
    bodyObserver.observe(host.document.documentElement, { attributes: true, attributeFilter: ["lang"] });
    cleanups.push(() => { headObserver.disconnect(); bodyObserver.disconnect(); });

    let previousWindow: Window | null = null;
    const focus = () => {
      if (host.activeWindow !== win) previousWindow = host.activeWindow ?? host;
      host.activeWindow = win; host.activeDocument = doc;
      doc.body.classList.add("is-focused");
    };
    const release = () => {
      if (host.activeWindow === win) {
        const previous = previousWindow && !previousWindow.closed ? previousWindow : host;
        host.activeWindow = previous; host.activeDocument = previous.document;
      }
      previousWindow = null;
      doc.body.classList.remove("is-focused");
    };
    listen(win, "focus", focus);
    listen(win, "blur", release);
    cleanups.push(release);

    // Match the host's popout key routing, including cancellation back to the
    // original event. Pointer/clipboard events keep their real target document.
    for (const type of ["keydown", "keyup"]) {
      listen(win, type, (event) => {
        focus();
        const original = event as KeyboardEvent;
        // Send belongs to the draft even when a native property completion
        // menu has its own host scope. Let the child root capture it directly.
        if ((original.ctrlKey || original.metaKey) && !original.altKey && original.key === "Enter") return;
        // Construct in the source realm, just as the host's popout relay does.
        // Do not override native Event.target across DOM realms; the active
        // editor's Scope owns keyboard routing in the receiving window.
        const Constructor = original.constructor as typeof KeyboardEvent;
        const relay = new Constructor(type, original);
        Object.defineProperty(relay, "isRelayed", { value: true });
        const preventDefault = relay.preventDefault.bind(relay);
        relay.preventDefault = () => { preventDefault(); original.preventDefault(); };
        const stopPropagation = relay.stopPropagation.bind(relay);
        relay.stopPropagation = () => { stopPropagation(); original.stopPropagation(); };
        const stopImmediatePropagation = relay.stopImmediatePropagation.bind(relay);
        relay.stopImmediatePropagation = () => { stopImmediatePropagation(); original.stopImmediatePropagation(); };
        host.dispatchEvent(relay);
      }, true);
    }
    listen(win, "unload", dispose);
    const ready = Promise.all([enhanced, ...loads]).then(() => {
      if (disposed || win.closed || typeof win.createFragment !== "function" || typeof doc.body.createDiv !== "function") {
        throw new Error("Missing quick input DOM capabilities");
      }
    }).catch((error: unknown) => { dispose(); throw error; });
    return { ready, dispose };
  } catch (error) { dispose(); throw error; }
}
