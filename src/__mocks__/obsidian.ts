// Mock Obsidian module for testing
export class FuzzySuggestModal<T> {
  protected app: any;

  constructor(app: any) {
    this.app = app;
  }

  setTitle(title: string): void {}

  getItems(): T[] {
    return [];
  }

  getItemText(item: T): string {
    return "";
  }

  onChooseItem(item: T): void {}
}

export class TFolder {
  path: string = "";
  name: string = "";
  children: any[] = [];
}

export class App {
  vault: any = null;
}

export class Vault {
  getRoot(): TFolder {
    return new TFolder();
  }
}

export function setIcon(el: Element, icon: string): void {
  el.setAttribute("data-icon", icon);
}

export function setTooltip(el: Element, tooltip: string, _options?: unknown): void {
  el.setAttribute("data-tooltip", tooltip);
}
