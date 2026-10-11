import { AbstractInputSuggest, Scope, type App } from "obsidian";
import { filterMetadataCandidates, type MetadataCandidate } from "./bulk-metadata";

/** Native positioning/keyboard navigation, with an IME guard and explicit lifetime. */
export function attachMetadataInputSuggest(app: App, input: HTMLInputElement, candidates: () => readonly MetadataCandidate[], onSelect: (name: string) => void) {
  let disposed = false;
  let composing = false;
  let opened = false;
  class MetadataSuggest extends AbstractInputSuggest<MetadataCandidate> {
    constructor() {
      super(app, input);
      this.limit = 20;
      this.scope = new Scope(this.scope);
      this.scope.register(null, null, (event) => {
        if (composing || event.isComposing || event.keyCode === 229) return true;
        return undefined;
      });
    }
    protected getSuggestions(query: string): MetadataCandidate[] {
      return disposed || composing || input.disabled ? [] : filterMetadataCandidates(candidates(), query);
    }
    renderSuggestion(value: MetadataCandidate, el: HTMLElement): void {
      el.setText(value.count === undefined ? value.name : `${value.name} (${value.count})`);
    }
    selectSuggestion(value: MetadataCandidate, event: MouseEvent | KeyboardEvent): void {
      if (disposed || composing || input.disabled || (event instanceof KeyboardEvent && (event.isComposing || event.keyCode === 229))) return;
      this.close();
      onSelect(value.name);
      if (input.isConnected) { input.focus(); this.close(); }
    }
    open(): void { if (!disposed && !composing && !input.disabled) { opened = true; super.open(); } }
    close(): void { opened = false; super.close(); }
  }
  let select = onSelect;
  // Disposal drops the modal callback as well as its candidate snapshot.
  onSelect = (name) => select(name);
  const suggest = new MetadataSuggest();
  const compositionStart = () => { composing = true; suggest.close(); };
  const compositionEnd = () => { composing = false; if (!disposed) input.dispatchEvent(new FocusEvent("focus")); };
  input.addEventListener("compositionstart", compositionStart);
  input.addEventListener("compositionend", compositionEnd);
  return {
    isOpen: () => opened,
    close: () => suggest.close(),
    dispose() {
      disposed = true;
      suggest.close();
      input.removeEventListener("compositionstart", compositionStart);
      input.removeEventListener("compositionend", compositionEnd);
      select = () => undefined;
      candidates = () => [];
    },
  };
}
