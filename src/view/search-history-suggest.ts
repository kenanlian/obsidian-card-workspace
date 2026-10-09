import { AbstractInputSuggest, Scope, setIcon, type App } from "obsidian";
import type { ToolbarStrings } from "../i18n";
import { SEARCH_SUGGESTION_LIMIT, suggestSearchHistory } from "../search-history";
import type { SearchHistoryCommand } from "./types";

export interface SearchHistorySuggestOptions {
  history: readonly string[];
  strings: ToolbarStrings["search"];
  onCommand: (command: SearchHistoryCommand) => void;
}

export interface SearchHistorySuggestHandle {
  update: (options: SearchHistorySuggestOptions) => void;
  close: () => void;
  isOpen: () => boolean;
  contains: (node: Node) => boolean;
  dispose: () => void;
}

export type AttachSearchHistorySuggest = (
  input: HTMLInputElement,
  options: SearchHistorySuggestOptions,
) => SearchHistorySuggestHandle;

type HistorySuggestion = { kind: "query"; query: string } | { kind: "clear" };

/** DOM-only adapter: the host still owns history, query state and persistence. */
export function attachSearchHistorySuggest(
  app: App,
  input: HTMLInputElement,
  initialOptions: SearchHistorySuggestOptions,
): SearchHistorySuggestHandle {
  let options = initialOptions;
  let disposed = false;
  let composing = false;
  let opened = false;
  let dismissed = false;
  let hasSuggestions = false;
  let list: HTMLElement | null = null;
  // Include the clear-query button and border, not just the text input's box.
  const anchor = input.closest<HTMLElement>(".fce-toolbar-search") ?? input;
  const historyId = `${input.id}-history`;
  function syncPopupSize(): void {
    const popup = list?.closest<HTMLElement>(".suggestion-container");
    if (!popup) return;
    const anchorRect = anchor.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const rtl = input.ownerDocument.defaultView?.getComputedStyle(input).direction === "rtl";
    popup.classList.add("fce-search-history-popover");
    popup.style.setProperty("--fce-search-history-width", `${anchorRect.width}px`);
    popup.style.setProperty("--fce-search-history-offset-x", `${rtl ? anchorRect.right - inputRect.right : anchorRect.left - inputRect.left}px`);
  }
  const observer = new MutationObserver(() => {
    const selected = list?.querySelector<HTMLElement>(".is-selected");
    if (opened && selected) input.setAttribute("aria-activedescendant", selected.id);
    else input.removeAttribute("aria-activedescendant");
  });

  // Each binding owns only transient DOM state and reads the host's snapshot.
  class HistorySuggest extends AbstractInputSuggest<HistorySuggestion> {
    constructor() {
      super(app, input);
      this.limit = SEARCH_SUGGESTION_LIMIT + 1;
      // Public child scope preserves native navigation while allowing focus on
      // row actions. IME keys must reach the input without choosing a history.
      this.scope = new Scope(this.scope);
      this.scope.register(null, null, (event) => {
        if (composing || event.isComposing || event.keyCode === 229) return true;
        const target = event.target;
        if (target instanceof HTMLElement && list?.contains(target) && target.tagName === "BUTTON") {
          if (event.key === "Escape") {
            input.focus();
            this.close();
            return false;
          }
          if (event.key === "Enter" || event.key === " ") {
            target.click();
            return false;
          }
        }
        return undefined;
      });
    }

    protected getSuggestions(inputQuery: string): HistorySuggestion[] {
      if (disposed || composing) return [];
      dismissed = false;
      const queries = suggestSearchHistory(options.history, inputQuery);
      hasSuggestions = queries.length > 0;
      return hasSuggestions ? [...queries.map((query): HistorySuggestion => ({ kind: "query", query })), { kind: "clear" }] : [];
    }

    renderSuggestion(value: HistorySuggestion, el: HTMLElement): void {
      if (disposed) return;
      const parent = el.parentElement;
      if (parent && parent !== list) {
        observer.disconnect();
        list = parent;
        list.id = historyId;
        list.setAttribute("role", "grid");
        observer.observe(list, { attributes: true, attributeFilter: ["class"], childList: true, subtree: true });
      }
      list?.setAttribute("aria-label", options.strings.history);
      el.id = `${historyId}-${el.parentElement?.children.length ?? 0}`;
      el.setAttribute("role", "row");
      el.classList.add("mod-complex", "fce-search-history-row");
      const content = input.ownerDocument.createElement("div");
      content.className = "suggestion-content";
      content.setAttribute("role", "gridcell");
      el.appendChild(content);
      if (value.kind === "clear") {
        el.classList.add("fce-search-history-clear");
        content.textContent = options.strings.clearHistory;
        return;
      }
      const title = input.ownerDocument.createElement("div");
      title.className = "suggestion-title fce-search-suggestion";
      title.textContent = value.query;
      title.title = value.query;
      content.appendChild(title);
      const aux = input.ownerDocument.createElement("div");
      aux.className = "suggestion-aux";
      aux.setAttribute("role", "gridcell");
      el.appendChild(aux);
      const remove = input.ownerDocument.createElement("button");
      remove.className = "clickable-icon fce-search-history-delete";
      remove.type = "button";
      remove.setAttribute("aria-label", options.strings.deleteHistory(value.query));
      aux.appendChild(remove);
      setIcon(remove, "x");
      remove.addEventListener("mousedown", (event) => event.preventDefault());
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (disposed) return;
        options.onCommand({ command: "delete", query: value.query });
        input.focus();
        refresh();
      });
      remove.addEventListener("focusout", (event) => {
        if (disposed) return;
        const next = event.relatedTarget as Node | null;
        if (next === input || (next && list?.contains(next))) return;
        this.close();
        options.onCommand({ command: "record", source: "blur" });
      });
    }

    selectSuggestion(value: HistorySuggestion, event: MouseEvent | KeyboardEvent): void {
      if (disposed || composing || (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229))) return;
      this.close();
      options.onCommand(value.kind === "query" ? { command: "select", query: value.query } : { command: "clear" });
      input.focus();
      this.close();
    }

    open(): void {
      if (disposed || composing || !hasSuggestions) return;
      opened = true;
      // Size before native positioning measures the popup for viewport bounds.
      syncPopupSize();
      super.open();
      input.setAttribute("aria-expanded", "true");
      input.setAttribute("aria-controls", historyId);
    }

    close(event?: FocusEvent): void {
      const next = event?.relatedTarget as Node | null;
      if (!disposed && next && list?.contains(next)) return;
      dismissed = hasSuggestions;
      opened = false;
      super.close();
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-controls");
      input.removeAttribute("aria-activedescendant");
    }
  }

  const suggest = new HistorySuggest();
  const resizeObserver = new ResizeObserver(() => {
    // Reposition in place; don't regenerate rows or reset native selection.
    if (!disposed && opened) suggest.open();
  });
  resizeObserver.observe(anchor);
  function refresh(): void {
    if (!disposed && !composing && input.ownerDocument.activeElement === input) {
      // The public API has no refresh method. A focus notification asks the
      // native input binding to recompute suggestions without emitting input.
      input.dispatchEvent(new FocusEvent("focus"));
    }
  }
  const startComposition = (): void => { composing = true; suggest.close(); };
  const endComposition = (): void => { composing = false; refresh(); };
  input.addEventListener("compositionstart", startComposition);
  input.addEventListener("compositionend", endComposition);
  input.setAttribute("aria-expanded", "false");
  if (input.ownerDocument.activeElement === input) refresh();

  return {
    update(next) {
      // Settings reads normalize into fresh arrays even when history is unchanged.
      // Query/status publications must not reset the native highlighted row.
      const changed = options.strings !== next.strings
        || options.history.length !== next.history.length
        || options.history.some((query, index) => query !== next.history[index]);
      options = next;
      if (changed && !dismissed) refresh();
    },
    close: () => suggest.close(),
    isOpen: () => opened,
    contains: (node) => !!list?.contains(node),
    dispose() {
      disposed = true;
      suggest.close();
      observer.disconnect();
      resizeObserver.disconnect();
      list = null;
      input.removeEventListener("compositionstart", startComposition);
      input.removeEventListener("compositionend", endComposition);
      // Native input listeners live with this DOM node; don't retain host callbacks.
      options = { ...options, history: [], onCommand: () => undefined };
    },
  };
}
