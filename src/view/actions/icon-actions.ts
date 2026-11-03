import { type Menu } from "obsidian";
import { IconPicker, closeIconPickerForAnchor } from "../../icon-picker/IconPicker";
import { iconTargetCategory, iconTargetKey, pushRecentIcon, resolveContentIcon, type IconTarget } from "../../icon-config";
import type { ViewContext } from "../view-context";

/** Per-view intent owner; the picker owns only the transient browsing session. */
export class IconActions {
  private readonly sessions = new Set<IconPicker>();
  private readonly menus = new WeakSet<Menu>();
  private disposed = false;
  constructor(private readonly context: ViewContext, private readonly flush: () => Promise<void>, private readonly getAnchor: () => HTMLElement) {}
  open(target: IconTarget, anchor: HTMLElement = this.getAnchor(), position?: { x: number; y: number }): IconPicker | null {
    if (this.disposed) return null;
    if (!position && closeIconPickerForAnchor(anchor)) return null;
    const vault = this.context.getApp().vault;
    // The vault root is "/" to the host; its icon identity is the empty folder path.
    const resolve = (): unknown => target.kind === "folder" && target.ref === "" ? vault.getRoot() : vault.getAbstractFileByPath(target.ref);
    const file = target.kind === "file" || target.kind === "folder" ? resolve() : null;
    const settings = this.context.getSettings();
    const box = settings.boxes.find(box => box.id === target.ref);
    const template = settings.noteTemplates.find(template => template.id === target.ref);
    const valid = (): boolean => {
      if (this.disposed) return false;
      if (target.kind === "file" || target.kind === "folder") {
        if (file === null || resolve() !== file) return false;
        return target.kind === "folder" && target.ref === "" ? true : (file as { path: string }).path === target.ref;
      }
      const current = this.context.getSettings();
      if (target.kind === "box") return current.boxes.some(entry => entry.id === target.ref && entry.name === box?.name);
      if (target.kind === "template") return current.noteTemplates.some(entry => entry.id === target.ref && entry.name === template?.name && entry.filePath === template?.filePath);
      return true;
    };
    if (!valid()) return null;
    const strings = this.context.getUiStrings().icons;
    const device = this.context.runtimePlatform?.device ?? "desktop";
    const key = iconTargetKey(target);
    const picker = new IconPicker({
      anchor, position, strings, target,
      category: iconTargetCategory(target),
      title: this.targetLabel(target, box?.name, template?.name),
      subtitle: strings.categories[iconTargetCategory(target)],
      layout: device === "phone" ? "sheet" : "popover",
      autoFocusSearch: device === "desktop",
      read: () => resolveContentIcon(this.context.getSettings(), target),
      canReset: () => Boolean(this.context.getSettings().iconOverrides?.[key]),
      recent: () => this.context.getSettings().recentIcons ?? [],
      skinTone: () => this.context.getSettings().emojiSkinTone ?? "",
      setSkinTone: tone => { this.context.saveSettings({ emojiSkinTone: tone }).catch(error => console.warn("Card Workspace: skin tone save failed", error)); },
      isValid: valid,
      apply: async spec => {
        if (!valid()) return;
        const current = this.context.getSettings();
        const next = { ...current.iconOverrides };
        if (spec === null) delete next[key]; else next[key] = spec;
        await this.context.saveSettings({ iconOverrides: next, ...(spec ? { recentIcons: pushRecentIcon(current.recentIcons, spec) } : {}) });
        await this.flush();
      },
      retry: () => this.flush(),
      restoreFocus: () => (anchor.closest<HTMLElement>("[data-nav-row-id]") ?? anchor).focus({ preventScroll: true }),
      onClose: () => this.sessions.delete(picker),
    });
    this.sessions.add(picker); return picker;
  }
  /** Removing an override is a direct command; it never opens the picker. */
  async reset(target: IconTarget): Promise<void> {
    if (this.disposed) return;
    const key = iconTargetKey(target);
    const current = this.context.getSettings().iconOverrides ?? {};
    if (!current[key]) return;
    const next = { ...current };
    delete next[key];
    try {
      await this.context.saveSettings({ iconOverrides: next });
      await this.flush();
    } catch (error) {
      console.warn("Card Workspace: icon save failed", error);
      this.context.notify(this.context.getUiStrings().icons.error);
    }
  }
  /** Appends the icon items wherever the caller's menu groups personalization; returns whether it added them. */
  appendMenu(menu: Menu, target: IconTarget, anchor: HTMLElement = this.getAnchor(), position?: { x: number; y: number }, options: { separatorBefore?: boolean } = {}): boolean {
    if (this.disposed || this.menus.has(menu)) return false;
    this.menus.add(menu);
    const strings = this.context.getUiStrings().icons;
    if (options.separatorBefore) menu.addSeparator();
    menu.addItem(item => item.setTitle(strings.change).setIcon("smile-plus").onClick(() => { this.open(target, anchor, position); }));
    if (this.context.getSettings().iconOverrides?.[iconTargetKey(target)]) {
      menu.addItem(item => item.setTitle(strings.reset).setIcon("rotate-ccw").onClick(() => { void this.reset(target); }));
    }
    return true;
  }
  private targetLabel(target: IconTarget, boxName?: string, templateName?: string): string {
    const strings = this.context.getUiStrings().icons;
    switch (target.kind) {
      case "folder": return target.ref === "" ? this.context.getApp().vault.getName() : target.ref.split("/").pop() ?? target.ref;
      case "file": return (target.ref.split("/").pop() ?? target.ref).replace(/\.md$/i, "");
      case "tag": return `#${target.ref}`;
      case "property": return target.ref;
      case "property-value": return `${target.ref}: ${target.value.kind === "missing" ? "—" : String(target.value.value)}`;
      case "box": return boxName ?? target.ref;
      case "template": return templateName ?? target.ref;
      case "links": return strings.categories[target.ref];
    }
  }
  hasOpenSession(): boolean { return this.sessions.size > 0; }
  close(): void { for (const picker of this.sessions) picker.close(false); }
  dispose(): void { this.disposed = true; this.close(); }
}
