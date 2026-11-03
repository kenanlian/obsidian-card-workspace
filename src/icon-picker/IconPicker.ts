import { setIcon } from "obsidian";
import { EMOJI_SKIN_TONES, NO_ICON, iconSpecEquals, lucideBaseName, type EmojiSkinTone, type IconCategory, type IconSpec, type IconTarget } from "../icon-config";
import { renderContentIcon } from "../icon-render";
import type { IconStrings } from "../i18n/icons";
import { emojiVariant, EMOJI_GROUP_ICONS, EMOJI_GROUPS, getEmojiCatalog, looksLikeEmoji, normalizeEmojiInput, type EmojiEntry } from "./emoji-catalog";
import { createLucideCatalog, type LucideCatalog } from "./lucide-catalog";

export interface IconPickerOptions {
  anchor: HTMLElement;
  target?: IconTarget;
  /** Drives Lucide suggestions. */
  category?: IconCategory;
  title?: string;
  subtitle?: string;
  /** Phones use a bottom sheet; other devices anchor a popover. */
  layout?: "popover" | "sheet";
  /** Touch devices skip focusing search so the on-screen keyboard stays closed. */
  autoFocusSearch?: boolean;
  position?: { x: number; y: number };
  strings: IconStrings;
  read: () => IconSpec;
  canReset: () => boolean;
  resetLabel?: string;
  recent?: () => readonly IconSpec[];
  skinTone?: () => EmojiSkinTone;
  setSkinTone?: (tone: EmojiSkinTone) => void;
  apply: (spec: IconSpec | null) => Promise<void>;
  retry: () => Promise<void>;
  isValid: () => boolean;
  onClose?: () => void;
  restoreFocus?: () => void;
}
const byDocument = new WeakMap<Document, IconPicker>();
const sessions = new Set<IconPicker>();
/** Called at explicit identity/lifecycle boundaries, including mutations without settings changes. */
export function validateIconPickers(): void { for (const picker of sessions) picker.validate(); }
export function closeIconPickersForTarget(predicate: (target: IconTarget) => boolean): void { for (const picker of sessions) if (picker.target && predicate(picker.target)) picker.close(false); }
export function closeAllIconPickers(): void { for (const picker of sessions) picker.close(false); }
/** Clicking the anchor of an open picker closes it instead of reopening. */
export function closeIconPickerForAnchor(anchor: HTMLElement): boolean {
  for (const picker of sessions) if (picker.anchor === anchor) { picker.close(); return true; }
  return false;
}

interface Candidate { spec: IconSpec; label: string; name: string }
interface Section { label?: string; group?: number; items: Candidate[] }
type Row = { type: "header"; top: number; label: string; group?: number } | { type: "items"; top: number; start: number; count: number };
const CELL = 38;
const HEADER = 28;
const FALLBACK_COLUMNS = 8;
const FALLBACK_HEIGHT = 280;
const DESKTOP_WIDTH = 344;

/** Plugin-owned, document-local, nonmodal picker. A successful choice closes it; a failed save keeps it open with retry. */
export class IconPicker {
  private readonly doc: Document;
  readonly element: HTMLDivElement;
  private readonly currentIcon: HTMLSpanElement;
  private readonly viewport: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly emojiBar: HTMLDivElement;
  private readonly groupButtons = new Map<number, HTMLButtonElement>();
  private readonly toneButton: HTMLButtonElement;
  private readonly tonePanel: HTMLDivElement;
  private readonly previewIcon: HTMLSpanElement;
  private readonly previewName: HTMLSpanElement;
  private readonly noneButton: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly error: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly cleanup: Array<() => void> = [];
  private readonly lucide: LucideCatalog;
  private readonly rendered = new Map<number, HTMLElement>();
  private candidates: Candidate[] = [];
  private rows: Row[] = [];
  private itemRows: number[] = [];
  private rowOfIndex: number[] = [];
  private columns = FALLBACK_COLUMNS;
  private tab: "lucide" | "emoji" = "lucide";
  private tone: EmojiSkinTone;
  private active = 0;
  private revision = 0;
  private frame = 0;
  private closed = false;

  constructor(private readonly options: IconPickerOptions) {
    this.doc = options.anchor.ownerDocument;
    byDocument.get(this.doc)?.close(false);
    byDocument.set(this.doc, this);
    sessions.add(this);
    this.lucide = createLucideCatalog();
    this.tone = options.skinTone?.() ?? "";
    const s = options.strings;
    this.element = this.create("div", "fce-icon-picker");
    this.element.classList.toggle("is-sheet", options.layout === "sheet");
    this.element.tabIndex = -1;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", options.title ? `${s.change}: ${options.title}` : s.change);

    const header = this.create("div", "fce-icon-picker-header", this.element);
    this.currentIcon = this.create("span", "fce-icon-picker-current", header);
    this.currentIcon.setAttribute("aria-hidden", "true");
    const heading = this.create("div", "fce-icon-picker-heading", header);
    this.create("div", "fce-icon-picker-title", heading).textContent = options.title ?? s.change;
    if (options.subtitle) this.create("div", "fce-icon-picker-subtitle", heading).textContent = options.subtitle;
    const close = this.button("", header, () => this.close());
    close.className = "clickable-icon fce-icon-picker-close"; close.setAttribute("aria-label", s.close); setIcon(close, "x");

    const toolbar = this.create("div", "fce-icon-picker-toolbar", this.element);
    const tablist = this.create("div", "fce-icon-picker-tabs", toolbar);
    tablist.setAttribute("role", "tablist");
    for (const name of ["lucide", "emoji"] as const) {
      const tab = this.button(name === "lucide" ? s.tabIcons : s.tabEmoji, tablist, () => this.switchTab(name));
      tab.className = "fce-icon-picker-tab"; tab.setAttribute("role", "tab");
      this.tabs.push(tab);
      this.listen(tab, "keydown", event => {
        const key = (event as KeyboardEvent).key;
        if (key !== "ArrowLeft" && key !== "ArrowRight") return;
        event.preventDefault(); this.switchTab(name === "lucide" ? "emoji" : "lucide");
        this.tabs[name === "lucide" ? 1 : 0].focus();
      });
    }
    this.search = this.create("input", "fce-icon-picker-search", toolbar);
    this.search.type = "search"; this.search.spellcheck = false;
    this.listen(this.search, "input", () => this.filter());
    this.listen(this.search, "keydown", event => {
      const key = (event as KeyboardEvent).key;
      if (key === "ArrowDown") { event.preventDefault(); this.focusCandidate(this.active); }
      if (key === "Enter" && !(event as KeyboardEvent).isComposing && this.candidates[0]) { event.preventDefault(); void this.choose(this.candidates[0].spec); }
    });

    this.emojiBar = this.create("div", "fce-icon-picker-emoji-bar", this.element);
    const groups = this.create("div", "fce-icon-picker-groups", this.emojiBar);
    groups.setAttribute("role", "toolbar"); groups.setAttribute("aria-label", s.emojiCategories);
    EMOJI_GROUP_ICONS.forEach((glyph, group) => {
      if (!glyph) return;
      const label = s.groups[group] ?? EMOJI_GROUPS[group];
      const button = this.button(glyph, groups, () => this.jumpToGroup(group));
      button.className = "fce-icon-picker-group fce-emoji-icon"; button.title = label; button.setAttribute("aria-label", label);
      this.groupButtons.set(group, button);
    });
    this.toneButton = this.button("", this.emojiBar, () => this.toggleTonePanel());
    this.toneButton.className = "fce-icon-picker-tone fce-emoji-icon"; this.toneButton.title = s.tone;
    this.toneButton.setAttribute("aria-label", s.tone); this.toneButton.setAttribute("aria-expanded", "false");
    this.tonePanel = this.create("div", "fce-icon-picker-tones", this.element);
    this.tonePanel.setAttribute("role", "radiogroup"); this.tonePanel.setAttribute("aria-label", s.tone); this.tonePanel.hidden = true;
    EMOJI_SKIN_TONES.forEach((tone, index) => {
      const option = this.button(`✋${tone}`, this.tonePanel, () => this.setTone(tone));
      option.className = "fce-icon-picker-tone-option fce-emoji-icon"; option.dataset.tone = tone;
      option.setAttribute("role", "radio"); option.setAttribute("aria-label", s.tones[index] ?? tone); option.title = s.tones[index] ?? tone;
    });
    this.renderTone();

    this.viewport = this.create("div", "fce-icon-picker-viewport", this.element);
    this.grid = this.create("div", "fce-icon-picker-grid", this.viewport);
    this.grid.setAttribute("role", "grid"); this.grid.setAttribute("aria-label", s.change);
    this.empty = this.create("div", "fce-icon-picker-empty", this.viewport);
    this.listen(this.viewport, "scroll", () => this.scheduleRender());
    this.listen(this.grid, "pointerover", event => this.preview(this.candidateFrom(event.target)));
    this.listen(this.grid, "pointerleave", () => this.preview(this.candidateFrom(this.doc.activeElement)));
    this.listen(this.grid, "focusin", event => this.preview(this.candidateFrom(event.target)));
    this.status = this.create("div", "fce-icon-picker-status", this.element);
    this.status.setAttribute("role", "status"); this.status.setAttribute("aria-live", "polite");

    const footer = this.create("div", "fce-icon-picker-footer", this.element);
    const preview = this.create("div", "fce-icon-picker-preview", footer);
    this.previewIcon = this.create("span", "fce-icon-picker-preview-icon", preview);
    this.previewIcon.setAttribute("aria-hidden", "true");
    this.previewName = this.create("span", "fce-icon-picker-preview-name", preview);
    this.noneButton = this.button(s.noIcon, footer, () => { void this.choose({ ...NO_ICON }); });
    this.noneButton.className = "fce-icon-picker-none";
    this.resetButton = this.button(options.resetLabel ?? s.reset, footer, () => { void this.choose(null); });
    this.resetButton.className = "fce-icon-picker-reset";
    this.error = this.create("div", "fce-icon-picker-error", this.element); this.error.setAttribute("role", "alert");
    this.create("span", "", this.error).textContent = s.error;
    this.button(s.retry, this.error, () => { void this.persist(() => options.retry()).then(ok => { if (ok) this.close(); }); });
    this.error.hidden = true;

    this.doc.body.append(this.element);
    this.listen(this.doc, "pointerdown", event => {
      const path = event.composedPath();
      if (!path.includes(this.element) && !path.includes(options.anchor)) this.close(false);
    }, true);
    this.listen(this.doc, "scroll", event => { if (!event.composedPath().includes(this.element)) this.position(); }, true);
    this.listen(this.doc, "keydown", event => {
      if ((event as KeyboardEvent).key !== "Escape") return;
      event.preventDefault(); event.stopPropagation();
      if (!this.tonePanel.hidden) { this.toggleTonePanel(false); this.toneButton.focus(); } else this.close();
    }, true);
    const win = this.doc.defaultView;
    if (win) {
      this.listen(win, "resize", () => { this.position(); this.relayout(); });
      if (win.visualViewport) { this.listen(win.visualViewport, "resize", () => this.position()); this.listen(win.visualViewport, "scroll", () => this.position()); }
      this.listen(win, "pagehide", () => this.close(false));
      const observer = new win.MutationObserver(records => { if (records.some(record => !this.element.contains(record.target))) this.validate(); });
      observer.observe(this.doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-hidden"] });
      this.cleanup.push(() => observer.disconnect());
      this.cleanup.push(() => { if (this.frame) win.cancelAnimationFrame?.(this.frame); });
    }
    this.switchTab(options.read().kind === "emoji" ? "emoji" : "lucide");
    this.position();
    if (options.autoFocusSearch === false) this.element.focus({ preventScroll: true }); else this.search.focus();
  }
  get anchor(): HTMLElement { return this.options.anchor; }
  get target(): IconTarget | undefined { return this.options.target; }
  private create<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
    // A document-local fragment keeps root elements detached until mounting.
    return (parent ?? this.doc.defaultView!.createFragment()).createEl(tag, { cls });
  }
  private listen(target: EventTarget, type: string, fn: (event: Event) => void, capture = false): void {
    target.addEventListener(type, fn, capture); this.cleanup.push(() => target.removeEventListener(type, fn, capture));
  }
  private button(label: string, parent: HTMLElement, click: () => void): HTMLButtonElement {
    const button = this.create("button", "", parent); button.type = "button"; button.textContent = label;
    this.listen(button, "click", click); return button;
  }
  private switchTab(tab: "lucide" | "emoji"): void {
    this.tab = tab;
    this.tabs.forEach((button, i) => { const selected = (i === 0) === (tab === "lucide"); button.setAttribute("aria-selected", String(selected)); button.tabIndex = selected ? 0 : -1; });
    this.emojiBar.hidden = tab !== "emoji";
    this.toggleTonePanel(false);
    const placeholder = tab === "emoji" ? this.options.strings.searchEmoji : this.options.strings.searchIcons;
    this.search.placeholder = placeholder; this.search.setAttribute("aria-label", placeholder);
    this.filter(); this.position();
  }

  private filter(): void {
    const raw = this.search.value.trim();
    if (this.tab === "lucide" && looksLikeEmoji(raw)) { this.switchTab("emoji"); return; }
    const s = this.options.strings;
    const sections = this.tab === "lucide" ? this.lucideSections(raw) : this.emojiSections(raw);
    this.empty.textContent = this.tab === "emoji" && looksLikeEmoji(raw) ? s.invalid : s.empty;
    this.layout(sections);
    this.viewport.scrollTop = 0;
    this.renderWindow();
    this.updateActiveGroup();
    this.status.textContent = s.resultCount(new Set(this.candidates.map(candidate => `${candidate.spec.kind}:${candidate.spec.value}`)).size);
  }
  private recent(kind: IconSpec["kind"]): IconSpec[] { return (this.options.recent?.() ?? []).filter(spec => spec.kind === kind); }
  private lucideSections(query: string): Section[] {
    const s = this.options.strings;
    const toCandidate = (entry: { id: string; name: string }): Candidate => ({ spec: { kind: "lucide", value: entry.id }, label: entry.name, name: entry.name });
    if (query) return [{ items: this.lucide.search(query).map(toCandidate) }];
    const available = new Map(this.lucide.entries.map(entry => [entry.name, entry]));
    const recent = this.recent("lucide").flatMap(spec => { const entry = available.get(lucideBaseName(spec.value)); return entry ? [toCandidate(entry)] : []; });
    return [
      { label: s.recent, items: recent },
      { label: s.suggested, items: this.lucide.suggested(this.options.category).map(toCandidate) },
      { label: s.allIcons, items: this.lucide.entries.map(toCandidate) },
    ];
  }
  private emojiSections(query: string): Section[] {
    const s = this.options.strings;
    const catalog = getEmojiCatalog();
    const toCandidate = (value: string, entry?: EmojiEntry): Candidate => ({
      spec: { kind: "emoji", value },
      label: entry ? `${entry.en} · ${entry.zh}` : value,
      name: entry ? (s.locale === "zh" ? entry.zh : entry.en) : value,
    });
    if (query) {
      const needle = query.toLowerCase();
      const items = catalog.entries.filter(entry => entry.search.includes(needle) || entry.variants.some(value => value.includes(query)))
        .map(entry => toCandidate(emojiVariant(entry, this.tone), entry));
      const exact = normalizeEmojiInput(query);
      if (exact) return [{ items: [toCandidate(exact, catalog.byVariant.get(exact)), ...items.filter(item => item.spec.value !== exact)] }];
      return [{ items }];
    }
    const sections: Section[] = [{ label: s.recent, items: this.recent("emoji").map(spec => toCandidate(spec.value, catalog.byVariant.get(spec.value))) }];
    EMOJI_GROUP_ICONS.forEach((glyph, group) => {
      if (!glyph) return;
      sections.push({ label: s.groups[group] ?? EMOJI_GROUPS[group], group,
        items: catalog.entries.filter(entry => entry.group === group).map(entry => toCandidate(emojiVariant(entry, this.tone), entry)) });
    });
    return sections;
  }
  private layout(sections: Section[]): void {
    this.columns = this.viewport.clientWidth ? Math.max(5, Math.floor(this.viewport.clientWidth / CELL)) : FALLBACK_COLUMNS;
    this.candidates = []; this.rows = []; this.itemRows = []; this.rowOfIndex = [];
    let top = 0;
    for (const section of sections) {
      if (!section.items.length) continue;
      if (section.label) { this.rows.push({ type: "header", top, label: section.label, group: section.group }); top += HEADER; }
      for (let offset = 0; offset < section.items.length; offset += this.columns) {
        const start = this.candidates.length;
        const chunk = section.items.slice(offset, offset + this.columns);
        this.candidates.push(...chunk);
        this.itemRows.push(this.rows.length);
        for (let i = 0; i < chunk.length; i++) this.rowOfIndex.push(this.itemRows.length - 1);
        this.rows.push({ type: "items", top, start, count: chunk.length }); top += CELL;
      }
    }
    this.active = 0;
    this.grid.style.height = `${top}px`;
    this.grid.setAttribute("aria-rowcount", String(this.rows.length));
    this.grid.setAttribute("aria-colcount", String(this.columns));
    this.grid.style.setProperty("--fce-picker-columns", String(this.columns));
    this.rendered.clear(); this.grid.replaceChildren();
    this.empty.hidden = this.candidates.length > 0;
    this.preview(null);
  }
  /** Width changes (rotation, resize) alter the column count; rebuild without losing the query. */
  private relayout(): void {
    const columns = this.viewport.clientWidth ? Math.max(5, Math.floor(this.viewport.clientWidth / CELL)) : FALLBACK_COLUMNS;
    if (columns !== this.columns) this.filter();
  }
  private scheduleRender(): void {
    const win = this.doc.defaultView;
    if (!win?.requestAnimationFrame) { this.renderWindow(); this.updateActiveGroup(); return; }
    if (this.frame) return;
    this.frame = win.requestAnimationFrame(() => { this.frame = 0; if (!this.closed) { this.renderWindow(); this.updateActiveGroup(); } });
  }
  private rowHeight(row: Row): number { return row.type === "header" ? HEADER : CELL; }
  private renderWindow(): void {
    const height = this.viewport.clientHeight || FALLBACK_HEIGHT;
    const from = this.viewport.scrollTop - CELL * 2, to = this.viewport.scrollTop + height + CELL * 2;
    let low = 0, high = this.rows.length;
    while (low < high) { const mid = (low + high) >> 1; const row = this.rows[mid]; if (row.top + this.rowHeight(row) <= from) low = mid + 1; else high = mid; }
    const visible = new Set<number>();
    for (let index = low; index < this.rows.length && this.rows[index].top < to; index++) visible.add(index);
    for (const [index, element] of this.rendered) if (!visible.has(index)) { element.remove(); this.rendered.delete(index); }
    // Candidate listeners belong to their nodes and are collected with the bounded window.
    for (const index of visible) if (!this.rendered.has(index)) this.rendered.set(index, this.renderRow(index));
    this.refreshSelection();
  }
  private renderRow(index: number): HTMLElement {
    const row = this.rows[index];
    const rowEl = this.create("div", row.type === "header" ? "fce-icon-picker-section" : "fce-icon-picker-grid-row", this.grid);
    rowEl.style.top = `${row.top}px`;
    rowEl.setAttribute("role", "row"); rowEl.setAttribute("aria-rowindex", String(index + 1));
    if (row.type === "header") {
      const cell = this.create("div", "", rowEl); cell.setAttribute("role", "columnheader"); cell.textContent = row.label;
      return rowEl;
    }
    for (let column = 0; column < row.count; column++) {
      const candidateIndex = row.start + column; const candidate = this.candidates[candidateIndex];
      const cell = this.create("div", "", rowEl); cell.setAttribute("role", "gridcell"); cell.setAttribute("aria-colindex", String(column + 1));
      const button = this.create("button", "fce-icon-picker-candidate", cell); button.type = "button"; button.dataset.index = String(candidateIndex);
      button.setAttribute("aria-label", candidate.label);
      renderContentIcon(button, { spec: candidate.spec, fallback: "file" });
      button.addEventListener("click", () => { this.active = candidateIndex; void this.choose(candidate.spec); });
      button.addEventListener("keydown", event => this.gridKey(event, candidateIndex));
    }
    return rowEl;
  }
  refreshSelection(): void {
    if (this.closed) return;
    const current = this.options.read();
    renderContentIcon(this.currentIcon, { spec: current, fallback: "file" });
    this.resetButton.disabled = !this.options.canReset();
    this.noneButton.setAttribute("aria-pressed", String(current.kind === "none"));
    this.noneButton.classList.toggle("is-selected", current.kind === "none");
    for (const button of Array.from(this.grid.querySelectorAll<HTMLButtonElement>("button[data-index]"))) {
      const index = Number(button.dataset.index);
      const selected = iconSpecEquals(current, this.candidates[index].spec);
      button.tabIndex = index === this.active ? 0 : -1;
      button.setAttribute("aria-pressed", String(selected)); button.classList.toggle("is-selected", selected);
    }
  }
  private candidateFrom(node: EventTarget | null): Candidate | null {
    const view = this.doc.defaultView;
    const button = view && node instanceof view.HTMLElement ? node.closest<HTMLElement>("button[data-index]") : null;
    return button && this.grid.contains(button) ? this.candidates[Number(button.dataset.index)] ?? null : null;
  }
  private preview(candidate: Candidate | null): void {
    this.previewIcon.hidden = !candidate;
    if (candidate) renderContentIcon(this.previewIcon, { spec: candidate.spec, fallback: "file" });
    this.previewName.textContent = candidate?.name ?? "";
  }
  private gridKey(event: KeyboardEvent, index: number): void {
    const rowOrdinal = this.rowOfIndex[index];
    const column = index - (this.rows[this.itemRows[rowOrdinal]] as Extract<Row, { type: "items" }>).start;
    const vertical = (delta: number): number => {
      const target = Math.max(0, Math.min(this.itemRows.length - 1, rowOrdinal + delta));
      const row = this.rows[this.itemRows[target]] as Extract<Row, { type: "items" }>;
      return row.start + Math.min(column, row.count - 1);
    };
    const moves: Record<string, () => number> = {
      ArrowRight: () => index + 1, ArrowLeft: () => index - 1, ArrowDown: () => vertical(1), ArrowUp: () => vertical(-1),
      PageDown: () => vertical(5), PageUp: () => vertical(-5), Home: () => 0, End: () => this.candidates.length - 1,
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    if (event.key === "ArrowUp" && rowOrdinal === 0) { this.search.focus(); return; }
    this.focusCandidate(move());
  }
  private focusCandidate(index: number): void {
    if (!this.candidates.length) return;
    this.active = Math.max(0, Math.min(this.candidates.length - 1, index));
    const row = this.rows[this.itemRows[this.rowOfIndex[this.active]]];
    const height = this.viewport.clientHeight || FALLBACK_HEIGHT;
    const previous = this.rows[this.itemRows[this.rowOfIndex[this.active]] - 1];
    const top = previous?.type === "header" ? previous.top : row.top;
    if (top < this.viewport.scrollTop) this.viewport.scrollTop = top;
    else if (row.top + CELL > this.viewport.scrollTop + height) this.viewport.scrollTop = row.top + CELL - height;
    this.renderWindow(); this.grid.querySelector<HTMLButtonElement>(`button[data-index="${this.active}"]`)?.focus({ preventScroll: true });
  }
  private jumpToGroup(group: number): void {
    if (this.search.value) { this.search.value = ""; this.filter(); }
    const header = this.rows.find(row => row.type === "header" && row.group === group);
    if (!header) return;
    this.viewport.scrollTop = header.top;
    this.renderWindow(); this.updateActiveGroup(group);
  }
  private updateActiveGroup(force?: number): void {
    let group = force;
    if (group === undefined && !this.search.value) {
      for (const row of this.rows) { if (row.top > this.viewport.scrollTop + 1) break; if (row.type === "header" && row.group !== undefined) group = row.group; }
      if (group === undefined) for (const row of this.rows) if (row.type === "header" && row.group !== undefined) { group = row.group; break; }
    }
    for (const [index, button] of this.groupButtons) { button.classList.toggle("is-active", index === group); button.setAttribute("aria-pressed", String(index === group)); }
  }
  private toggleTonePanel(open = this.tonePanel.hidden): void {
    this.tonePanel.hidden = !open;
    this.emojiBar.classList.toggle("is-choosing-tone", open);
    this.toneButton.setAttribute("aria-expanded", String(open));
    if (open) this.tonePanel.querySelector<HTMLButtonElement>(`[data-tone="${this.tone}"]`)?.focus();
  }
  private setTone(tone: EmojiSkinTone): void {
    this.tone = tone; this.renderTone(); this.toggleTonePanel(false);
    this.options.setSkinTone?.(tone);
    this.filter(); this.toneButton.focus();
  }
  private renderTone(): void {
    this.toneButton.textContent = `✋${this.tone}`;
    for (const option of Array.from(this.tonePanel.querySelectorAll<HTMLButtonElement>("[data-tone]"))) {
      const selected = option.dataset.tone === this.tone;
      option.setAttribute("aria-checked", String(selected)); option.classList.toggle("is-selected", selected);
    }
  }

  select(spec: IconSpec | null): Promise<void> { return this.choose(spec); }
  private async choose(spec: IconSpec | null): Promise<void> {
    if (!this.validate()) return;
    if (await this.persist(() => this.options.apply(spec))) this.close();
  }
  /** Resolves true only when this is still the latest save and it succeeded. */
  private async persist(work: () => Promise<void>): Promise<boolean> {
    if (!this.validate()) return false;
    const revision = ++this.revision;
    this.error.hidden = true;
    try { const pending = work(); this.refreshSelection(); await pending; return !this.closed && revision === this.revision; }
    catch (error) {
      console.warn("Card Workspace: icon save failed", error);
      if (!this.closed && revision === this.revision) { this.error.hidden = false; this.position(); }
      return false;
    }
  }
  validate(): boolean {
    if (this.closed) return false;
    if (!this.element.isConnected || !this.options.anchor.isConnected || this.options.anchor.ownerDocument !== this.doc
      || this.options.anchor.checkVisibility?.() === false || !this.options.isValid()) { this.close(false); return false; }
    this.refreshSelection(); return true;
  }
  private position(): void {
    const win = this.doc.defaultView; if (!win) return;
    const viewport = win.visualViewport;
    const safe = win.getComputedStyle(this.element);
    const inset = (side: string): number => Number.parseFloat(safe.getPropertyValue(`--fce-picker-safe-${side}`)) || 0;
    const left = (viewport?.offsetLeft ?? 0) + inset("left"), top = (viewport?.offsetTop ?? 0) + inset("top");
    const width = (viewport?.width ?? win.innerWidth) - inset("left") - inset("right");
    const height = (viewport?.height ?? win.innerHeight) - inset("top") - inset("bottom");
    if (this.options.layout === "sheet") {
      this.element.style.width = `${Math.max(0, width)}px`;
      this.element.style.maxHeight = `${Math.max(0, Math.round(height * 0.75))}px`;
      this.element.style.left = `${left}px`;
      this.element.style.top = `${top + height - this.element.getBoundingClientRect().height}px`;
      return;
    }
    const rect = this.options.anchor.getBoundingClientRect();
    const point = this.options.position ?? { x: rect.left, y: rect.bottom + 6 };
    this.element.style.width = `${Math.max(0, Math.min(DESKTOP_WIDTH, width - 24))}px`;
    this.element.style.maxHeight = `${Math.max(0, height - 24)}px`;
    const pickerHeight = this.element.getBoundingClientRect().height;
    // Flip above the anchor rather than covering it when there is no room below.
    const y = point.y + pickerHeight > top + height - 12 && !this.options.position && rect.top - pickerHeight - 6 >= top + 12 ? rect.top - pickerHeight - 6 : point.y;
    this.element.style.left = `${Math.max(left + 12, Math.min(point.x, left + width - this.element.offsetWidth - 12))}px`;
    this.element.style.top = `${Math.max(top + 12, Math.min(y, top + height - pickerHeight - 12))}px`;
  }
  close(restoreFocus = true): void {
    if (this.closed) return; this.closed = true; this.revision++;
    this.cleanup.splice(0).forEach(cleanup => cleanup()); this.element.remove(); sessions.delete(this);
    if (byDocument.get(this.doc) === this) byDocument.delete(this.doc);
    if (restoreFocus && this.options.anchor.isConnected) {
      if (this.options.restoreFocus) this.options.restoreFocus();
      else this.options.anchor.focus({ preventScroll: true });
    }
    this.options.onClose?.();
  }
}
