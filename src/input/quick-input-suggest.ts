import { AbstractInputSuggest, Scope, setIcon, type App } from "obsidian";

export interface QuickInputChoice { id: string; name: string }
/** A short-lived, draft-document native suggestion binding; candidates are snapshotted on open. */
export function openQuickInputSuggest(options: {
  app: App;
  anchor: HTMLButtonElement;
  candidates: QuickInputChoice[];
  selected(id: string): boolean;
  multiple: boolean;
  select(id: string): void;
  restoreFocus(): void;
}): { dispose(): void } {
  const { anchor, app } = options;
  const doc = anchor.ownerDocument;
  const win = doc.defaultView!;
  window.activeWindow = win;
  window.activeDocument = doc;
  const input = doc.body.createEl("input");
  input.type = "search";
  input.className = "fce-quick-input-choice-search";
  input.setAttribute("aria-label", anchor.getAttribute("aria-label") ?? "");
  input.setAttribute("role", "combobox");
  doc.body.appendChild(input);
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(320, Math.max(200, win.innerWidth - 16));
  input.style.width = `${width}px`;
  input.style.left = `${Math.max(8, Math.min(rect.left, win.innerWidth - width - 8))}px`;
  input.style.top = `${Math.max(8, rect.top - Math.min(240, rect.top - 8))}px`;
  let list: HTMLElement | null = null;
  let disposed = false;
  let composing = false;
  const restore = () => { options.restoreFocus(); };
  class ChoiceSuggest extends AbstractInputSuggest<QuickInputChoice> {
    constructor() {
      super(app, input);
      this.limit = 20;
      this.scope = new Scope(this.scope);
      this.scope.register(null, null, (event) => {
        if (event.isComposing || composing || event.key === "Process") return true;
        if (event.key === "Escape") { dispose(); restore(); return false; }
        return undefined;
      });
    }
    protected getSuggestions(query: string): QuickInputChoice[] {
      return disposed || composing ? [] : options.candidates.filter((item) => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 20);
    }
    renderSuggestion(value: QuickInputChoice, element: HTMLElement): void {
      list = element.closest<HTMLElement>(".suggestion-container");
      element.setAttribute("aria-selected", String(options.selected(value.id)));
      element.classList.add("fce-quick-input-choice-row");
      element.title = value.name;
      const check = element.createSpan();
      if (options.selected(value.id)) setIcon(check, "check");
      element.createSpan({ text: value.name, cls: "fce-quick-input-choice-name" });
    }
    open(): void {
      if (disposed || composing) return;
      window.activeWindow = win; window.activeDocument = doc;
      super.open();
      if (list) {
        if (list.ownerDocument !== doc || !doc.body.contains(list)) doc.body.appendChild(list);
        list.classList.add("fce-quick-input-choice-popover");
        const inputRect = input.getBoundingClientRect();
        list.style.maxHeight = `${Math.max(0, Math.min(240 - inputRect.height - 4, rect.top - inputRect.bottom - 4, win.innerHeight - inputRect.bottom - 8))}px`;
        list.style.width = `${width}px`;
        list.style.left = `${inputRect.left}px`;
        list.style.top = `${inputRect.bottom + 4}px`;
      }
      input.setAttribute("aria-expanded", "true");
    }
    close(): void { super.close(); }
    selectSuggestion(value: QuickInputChoice, event: MouseEvent | KeyboardEvent): void {
      if (!value || disposed || composing || ("isComposing" in event && event.isComposing)) return;
      options.select(value.id);
      if (!options.multiple) { dispose(); restore(); }
      else input.dispatchEvent(new win.FocusEvent("focus"));
    }
  }
  const suggest = new ChoiceSuggest();
  const outside = (event: Event) => {
    const node = event.target as Node | null;
    if (node && (node === input || list?.contains(node) || anchor.contains(node))) return;
    dispose();
  };
  const startComposition = () => { composing = true; };
  const endComposition = () => { composing = false; input.dispatchEvent(new win.FocusEvent("focus")); };
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    suggest.close();
    list?.remove();
    input.remove();
    doc.removeEventListener("pointerdown", outside, true);
    win.removeEventListener("resize", dispose);
    input.removeEventListener("keydown", keydown);
    input.removeEventListener("blur", blur);
    input.removeEventListener("compositionstart", startComposition);
    input.removeEventListener("compositionend", endComposition);
  }
  doc.addEventListener("pointerdown", outside, true);
  win.addEventListener("resize", dispose);
  const blur = () => { queueMicrotask(() => { if (doc.activeElement !== input && !list?.contains(doc.activeElement)) dispose(); }); };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || composing) return;
    event.preventDefault(); event.stopPropagation();
    dispose(); restore();
  };
  input.addEventListener("keydown", keydown);
  input.addEventListener("blur", blur);
  input.addEventListener("compositionstart", startComposition);
  input.addEventListener("compositionend", endComposition);
  input.focus();
  return { dispose };
}
