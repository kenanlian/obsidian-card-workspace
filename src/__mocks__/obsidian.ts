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

export class Modal {
  protected app: any;
  contentEl: HTMLDivElement;

  constructor(app: any) {
    this.app = app;
    this.contentEl = document.createElement("div");
  }

  setTitle(_title: string): this {
    return this;
  }

  open(): void {
    return;
  }

  close(): void {
    return;
  }
}

export class Vault {
  getRoot(): TFolder {
    return new TFolder();
  }
}

export function setIcon(el: Element, icon: string): void {
  el.setAttribute("data-icon", icon);
}


export function addIcon(_name: string, _svgContent: string): void {
}
export function setTooltip(el: Element, tooltip: string, _options?: unknown): void {
  el.setAttribute("data-tooltip", tooltip);
}

export function getAllTags(cache: { tags?: Array<{ tag: string }> } | null): string[] {
  return cache?.tags?.map((entry) => entry.tag) ?? [];
}
