import { Menu, TFile } from "obsidian";
import type { CardBackgroundTint } from "../../card-background";
import { buildCardBackgroundMenu } from "../menus/card-background-menu";
import type { ViewContext } from "../view-context";

export class CardBackgroundActions {
  private disposed = false;
  constructor(private readonly context: ViewContext) {}
  private files(paths: string[]): TFile[] {
    return paths.flatMap(path => {
      const file = this.context.getApp().vault.getAbstractFileByPath(path);
      return file instanceof TFile ? [file] : [];
    });
  }
  private build(menu: Menu, files: TFile[]): void {
    const overrides = this.context.getSettings().cardBackgroundOverrides;
    const colors = files.map(file => overrides[file.path] ?? null);
    const current = colors.every(color => color === colors[0]) ? colors[0] : undefined;
    buildCardBackgroundMenu(menu, this.context.getUiStrings().cardBackground, current, color => { void this.apply(files, color); });
  }
  appendMenu(menu: Menu, path: string): void {
    const files = this.files([path]);
    if (!files.length || this.disposed) return;
    let flat = false;
    menu.addItem(item => {
      item.setTitle(this.context.getUiStrings().cardBackground.title).setIcon("palette");
      const submenu = (item as unknown as { setSubmenu?: () => Menu }).setSubmenu?.();
      if (submenu && typeof submenu.addItem === "function") this.build(submenu.setUseNativeMenu(false), files);
      else { item.setDisabled(true); flat = true; }
    });
    if (flat) this.build(menu, files);
  }
  openBulk(paths: string[], position: { x: number; y: number }): void {
    const files = this.files(paths);
    if (!files.length || this.disposed) return;
    const menu = new Menu().setUseNativeMenu(false);
    this.build(menu, files);
    menu.showAtPosition(position);
  }
  async apply(files: TFile[], color: CardBackgroundTint | null): Promise<void> {
    if (this.disposed) return;
    const current = this.context.getSettings().cardBackgroundOverrides;
    const next = { ...current };
    let changed = false;
    for (const file of files) {
      if (this.context.getApp().vault.getAbstractFileByPath(file.path) !== file) continue;
      if ((next[file.path] ?? null) === color) continue;
      if (color === null) delete next[file.path]; else next[file.path] = color;
      changed = true;
    }
    if (!changed) return;
    try { await this.context.saveSettings({ cardBackgroundOverrides: next }); }
    catch (error) {
      console.warn("Card Workspace: background color save failed", error);
      if (!this.disposed) this.context.notify(this.context.getUiStrings().cardBackground.failed);
    }
  }
  dispose(): void { this.disposed = true; }
}
