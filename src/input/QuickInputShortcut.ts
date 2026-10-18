import type { QuickInputShortcutBridge } from "./quick-input-desktop";

export type QuickInputShortcutError = "invalid" | "conflict" | "unavailable" | "save-failed" | null;
export interface QuickInputShortcutState {
  active: string[];
  error: QuickInputShortcutError;
  pending: boolean;
}
/** Canonicalize aliases before comparing ownership; Electron does final validation. */
export function normalizeQuickInputAccelerator(value: string): string | null {
  const parts = value.trim().split("+").map((part) => part.trim());
  const aliases: Record<string, string> = { ctrl: "Control", control: "Control", cmd: "Command", command: "Command", cmdorctrl: "CommandOrControl", commandorcontrol: "CommandOrControl", alt: "Alt", option: "Alt", shift: "Shift", super: "Super", meta: "Super" };
  const key = parts.pop() ?? "";
  const modifiers = parts.map((part) => aliases[part.toLowerCase()]);
  if (!modifiers.length || modifiers.some((part) => !part) || new Set(modifiers).size !== modifiers.length) return null;
  if (!/^(?:[a-z0-9]|F(?:[1-9]|1\d|2[0-4])|Space|Tab|Enter|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Plus|Minus)$/i.test(key)) return null;
  const keys = ["Space", "Tab", "Enter", "Escape", "Backspace", "Delete", "Insert", "Home", "End", "PageUp", "PageDown", "Up", "Down", "Left", "Right", "Plus", "Minus"];
  const canonicalKey = keys.find((candidate) => candidate.toLowerCase() === key.toLowerCase()) ?? key.toUpperCase();
  const order = ["CommandOrControl", "Command", "Control", "Alt", "Shift", "Super"];
  return [...modifiers.sort((a, b) => order.indexOf(a) - order.indexOf(b)), canonicalKey].join("+");
}
export function captureQuickInputAccelerator(event: KeyboardEvent): string | null {
  if (event.isComposing || ["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  const key = /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5)
    : ({ " ": "Space", "+": "Plus", "-": "Minus", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" } as Record<string, string>)[event.key] ?? event.key;
  return normalizeQuickInputAccelerator([
    ...(event.metaKey ? ["Command"] : []), ...(event.ctrlKey ? ["Control"] : []),
    ...(event.altKey ? ["Alt"] : []), ...(event.shiftKey ? ["Shift"] : []), key,
  ].join("+"));
}

/** Owns only successful registrations of this vault/plugin instance. */
export class QuickInputShortcut {
  private readonly owned = new Set<string>();
  private bridge: QuickInputShortcutBridge | null = null;
  private error: QuickInputShortcutError = null;
  private pending = false;
  private disposed = false;
  private readonly listeners = new Set<(state: QuickInputShortcutState) => void>();
  constructor(private readonly options: {
    bridge: () => QuickInputShortcutBridge;
    save: (accelerator: string) => Promise<void>;
    open: () => void;
  }) {}
  getState(): QuickInputShortcutState { return { active: [...this.owned], error: this.error, pending: this.pending }; }
  subscribe(listener: (state: QuickInputShortcutState) => void): () => void {
    this.listeners.add(listener); listener(this.getState());
    return () => this.listeners.delete(listener);
  }
  private publish(): void { for (const listener of this.listeners) listener(this.getState()); }
  async start(saved: string): Promise<void> { if (saved) await this.apply(saved, false); }
  async apply(value: string, persist = true): Promise<void> {
    if (this.disposed || this.pending) return;
    const accelerator = value.trim() === "" ? "" : normalizeQuickInputAccelerator(value);
    if (accelerator === null) { this.error = "invalid"; this.publish(); return; }
    this.pending = true; this.error = null; this.publish();
    try {
      if (accelerator && !this.owned.has(accelerator)) {
        try { this.bridge ??= this.options.bridge(); }
        catch { this.error = "unavailable"; return; }
        try {
          if (this.bridge.isRegistered(accelerator) || !this.bridge.register(accelerator, () => { if (!this.disposed) this.options.open(); })) {
            this.error = "conflict"; return;
          }
        } catch { this.error = "invalid"; return; }
        this.owned.add(accelerator);
      }
      // Clearing takes effect immediately, including if persistence later fails.
      if (!accelerator) this.releaseExcept("");
      if (persist) {
        try { await this.options.save(accelerator); }
        catch { this.error = "save-failed"; return; }
      }
      if (!this.disposed) this.releaseExcept(accelerator);
    } finally { this.pending = false; if (!this.disposed) this.publish(); }
  }
  private releaseExcept(keep: string): void {
    for (const accelerator of this.owned) {
      if (accelerator === keep) continue;
      this.bridge?.unregister(accelerator); this.owned.delete(accelerator);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.releaseExcept(""); this.listeners.clear();
  }
}
