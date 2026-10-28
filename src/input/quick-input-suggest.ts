import { setIcon } from "obsidian";

export interface QuickInputChoice { id: string; name: string }

const LIMIT = 20;
const MAX_HEIGHT = 240;
const GAP = 6;
const MARGIN = 8;

/** A short-lived popover in the draft document, opening upward from its footer anchor; candidates are snapshotted on open. */
export function openQuickInputSuggest(options: {
  anchor: HTMLButtonElement;
  candidates: QuickInputChoice[];
  emptyText: string;
  noMatchText: string;
  selected(id: string): boolean;
  multiple: boolean;
  select(id: string): void;
  restoreFocus(): void;
}): { dispose(): void } {
  const { anchor } = options;
  const doc = anchor.ownerDocument;
  const win = doc.defaultView!;
  const popover = doc.body.createDiv({ cls: "suggestion-container fce-quick-input-choice-popover" });
  const input = popover.createEl("input", { cls: "fce-quick-input-choice-search", attr: {
    type: "search", role: "combobox", "aria-expanded": "true", "aria-label": anchor.getAttribute("aria-label") ?? "",
  } });
  const list = popover.createDiv({ cls: "suggestion", attr: { role: "listbox" } });
  if (options.multiple) list.setAttribute("aria-multiselectable", "true");
  let items: QuickInputChoice[] = [];
  let active = -1;
  let disposed = false;
  let composing = false;

  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(320, win.innerWidth - MARGIN * 2);
    popover.style.width = `${width}px`;
    popover.style.left = `${Math.max(MARGIN, Math.min(rect.left, win.innerWidth - width - MARGIN))}px`;
    popover.style.bottom = `${win.innerHeight - rect.top + GAP}px`;
    popover.style.maxHeight = `${Math.max(0, Math.min(MAX_HEIGHT, rect.top - GAP - MARGIN))}px`;
  };
  const highlight = (index: number) => {
    active = index;
    list.querySelectorAll<HTMLElement>(".suggestion-item").forEach((row, rowIndex) => row.classList.toggle("is-selected", rowIndex === index));
    list.children[index]?.scrollIntoView?.({ block: "nearest" });
  };
  const render = () => {
    const query = input.value.toLocaleLowerCase();
    items = options.candidates.filter((item) => item.name.toLocaleLowerCase().includes(query)).slice(0, LIMIT);
    if (active < 0) active = Math.max(0, items.findIndex((item) => options.selected(item.id)));
    active = Math.min(active, items.length - 1);
    list.replaceChildren();
    if (!items.length) {
      list.createDiv({ cls: "suggestion-empty", text: options.candidates.length ? options.noMatchText : options.emptyText });
      return;
    }
    items.forEach((item, index) => {
      const selected = options.selected(item.id);
      const row = list.createDiv({ cls: "suggestion-item mod-complex fce-quick-input-choice-row", attr: { role: "option", "aria-selected": String(selected), title: item.name } });
      const check = row.createSpan({ cls: "fce-quick-input-choice-check" });
      if (selected) setIcon(check, "check");
      row.createSpan({ cls: "fce-quick-input-choice-name", text: item.name });
      row.addEventListener("mousemove", () => { if (active !== index) highlight(index); });
      row.addEventListener("click", () => choose(index));
    });
    highlight(active);
  };
  const choose = (index: number) => {
    const item = items[index];
    if (!item || disposed || composing) return;
    options.select(item.id);
    if (!options.multiple) { dispose(); options.restoreFocus(); return; }
    active = index;
    render();
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing || composing || event.key === "Process") return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      dispose(); options.restoreFocus();
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && items.length) {
      event.preventDefault();
      highlight((active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  };
  const query = () => { if (composing) return; active = 0; render(); };
  // Rows must not take focus, or the search input blur would dismiss the popover first.
  const keepFocus = (event: MouseEvent) => { if (event.target !== input) event.preventDefault(); };
  const outside = (event: Event) => {
    const node = event.target as Node | null;
    if (node && (popover.contains(node) || anchor.contains(node))) return;
    dispose();
  };
  const blur = () => { queueMicrotask(() => { if (doc.activeElement !== input) dispose(); }); };
  const startComposition = () => { composing = true; };
  const endComposition = () => { composing = false; query(); };
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    popover.remove();
    doc.removeEventListener("pointerdown", outside, true);
    win.removeEventListener("resize", dispose);
  }

  input.addEventListener("keydown", keydown);
  input.addEventListener("input", query);
  input.addEventListener("blur", blur);
  input.addEventListener("compositionstart", startComposition);
  input.addEventListener("compositionend", endComposition);
  popover.addEventListener("mousedown", keepFocus);
  doc.addEventListener("pointerdown", outside, true);
  win.addEventListener("resize", dispose);
  render();
  place();
  input.focus();
  return { dispose };
}
