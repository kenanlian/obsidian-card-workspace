/** Install the host's Node.createEl seam in test/benchmark windows, including pop-outs. */
export function installObsidianDomHelpers(doc: Document): void {
  const nodePrototype = doc.defaultView?.Node.prototype;
  if (!nodePrototype || typeof nodePrototype.createEl === "function") return;
  Object.defineProperty(nodePrototype, "createEl", {
    configurable: true,
    value: function <K extends keyof HTMLElementTagNameMap>(
      this: Node, tag: K, options: { cls?: string; text?: string } = {},
    ): HTMLElementTagNameMap[K] {
      const el = (this.ownerDocument ?? doc).createElement(tag);
      if (options.cls) el.className = options.cls;
      if (options.text !== undefined) el.textContent = options.text;
      this.appendChild(el);
      return el;
    },
  });
}
