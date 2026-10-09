/** Public input-suggest seam. Mirrors native first-row selection and body portal. */
export class Scope {
  private handlers: Array<{ key: string | null; callback: (event: KeyboardEvent) => boolean | void }> = [];
  constructor(private parent?: Scope) {}
  register(_modifiers: string[] | null, key: string | null, callback: (event: KeyboardEvent) => boolean | void) {
    const handler = { key, callback };
    this.handlers.push(handler);
    return handler;
  }
  handle(event: KeyboardEvent): boolean | void {
    for (const handler of this.handlers) {
      if (handler.key !== null && handler.key !== event.key) continue;
      const result = handler.callback(event);
      if (result !== undefined) return result;
    }
    return this.parent?.handle(event);
  }
}

export abstract class AbstractInputSuggest<T> {
  limit = 100;
  scope = new Scope();
  private container: HTMLElement;
  private list: HTMLElement;
  private values: T[] = [];
  private selected = 0;
  private opened = false;
  constructor(_app: unknown, private input: HTMLInputElement) {
    this.container = input.ownerDocument.createElement("div");
    this.container.className = "suggestion-container";
    this.list = input.ownerDocument.createElement("div");
    this.list.className = "suggestion";
    this.container.appendChild(this.list);
    input.addEventListener("focus", this.refresh);
    input.addEventListener("input", this.refresh);
    input.addEventListener("blur", this.close.bind(this));
    this.container.addEventListener("mousedown", (event) => event.preventDefault());
    for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "Enter", "Escape"]) {
      this.scope.register([], key, (event) => {
        if (event.isComposing) return;
        if (key === "Escape") this.close();
        else if (key === "Enter") this.selectSuggestion(this.values[this.selected], event);
        else {
          const length = this.values.length;
          this.selected = key === "Home" ? 0 : key === "End" ? length - 1 : (this.selected + (key === "ArrowDown" ? 1 : -1) + length) % length;
          this.highlight();
        }
        return false;
      });
    }
  }
  protected abstract getSuggestions(query: string): T[] | Promise<T[]>;
  abstract renderSuggestion(value: T, el: HTMLElement): void;
  abstract selectSuggestion(value: T, event: MouseEvent | KeyboardEvent): void;
  private refresh = (): void => {
    if (this.input.ownerDocument.activeElement !== this.input || !this.input.isConnected) return;
    const values = this.getSuggestions(this.input.value);
    if (!Array.isArray(values)) throw new Error("Async suggestions are outside this mock's contract");
    this.values = this.limit > 0 ? values.slice(0, this.limit) : values;
    this.list.replaceChildren();
    if (!this.values.length) { this.close(); return; }
    this.values.forEach((value, index) => {
      const el = this.input.ownerDocument.createElement("div");
      el.className = "suggestion-item";
      this.list.appendChild(el);
      this.renderSuggestion(value, el);
      el.addEventListener("click", (event) => { if (!event.defaultPrevented) this.selectSuggestion(value, event); });
      el.addEventListener("mousemove", () => { this.selected = index; this.highlight(); });
    });
    this.selected = 0;
    this.highlight();
    this.open();
  };
  private highlight(): void {
    Array.from(this.list.children).forEach((el, index) => el.classList.toggle("is-selected", index === this.selected));
  }
  private keydown = (event: KeyboardEvent): void => {
    if (this.scope.handle(event) === false) { event.preventDefault(); event.stopPropagation(); }
  };
  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.input.ownerDocument.body.appendChild(this.container);
    this.input.ownerDocument.defaultView!.addEventListener("keydown", this.keydown, true);
  }
  close(): void {
    this.opened = false;
    this.values = [];
    this.list.replaceChildren();
    this.container.remove();
    this.input.ownerDocument.defaultView!.removeEventListener("keydown", this.keydown, true);
  }
}
