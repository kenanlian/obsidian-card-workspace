/** Install the host's DOM helpers in test/benchmark windows, including pop-outs. */
export function installObsidianDomHelpers(doc: Document): void {
  const host = doc.defaultView;
  if (!host) return;
  if (typeof host.createFragment !== "function") {
    host.createFragment = (callback) => {
      const fragment = doc.createDocumentFragment();
      callback?.(fragment);
      return fragment;
    };
  }
  const nodePrototype = host.Node.prototype;
  if (typeof nodePrototype.createSpan !== "function") {
    nodePrototype.createSpan = function (options, callback) {
      return this.createEl("span", options, callback);
    };
  }
  if (typeof nodePrototype.createDiv !== "function") {
    nodePrototype.createDiv = function (options, callback) {
      return this.createEl("div", options, callback);
    };
  }
  if (!nodePrototype || typeof nodePrototype.createEl === "function") return;
  Object.defineProperty(nodePrototype, "createEl", {
    configurable: true,
    value: function <K extends keyof HTMLElementTagNameMap>(
      this: Node, tag: K, options: { cls?: string; text?: string; attr?: Record<string, string> } = {},
    ): HTMLElementTagNameMap[K] {
      const el = (this.ownerDocument ?? doc).createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text !== undefined) el.textContent = options.text;
      for (const [name, value] of Object.entries(options.attr ?? {})) el.setAttribute(name, value);
      this.appendChild(el);
      return el;
    },
  });
}
