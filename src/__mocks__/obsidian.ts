export function debounce<T extends unknown[]>(
  callback: (...args: T) => void,
  timeout = 0,
  resetTimer = false,
): ((...args: T) => void) & { cancel: () => void; run: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queuedArgs: T | null = null;

  const invoke = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (queuedArgs === null) {
      return;
    }
    const args = queuedArgs;
    queuedArgs = null;
    callback(...args);
  };

  const debounced = ((...args: T) => {
    queuedArgs = args;
    if (timer !== null) {
      if (!resetTimer) {
        return;
      }
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      invoke();
    }, timeout);
  }) as ((...args: T) => void) & { cancel: () => void; run: () => void };

  debounced.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    queuedArgs = null;
  };
  debounced.run = invoke;
  return debounced;
}

export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

// Mock Obsidian module for testing
export class FuzzySuggestModal<T> {
  protected app: any;

  constructor(app: any) {
    this.app = app;
  }

  setTitle(_title: string): void {}

  getItems(): T[] {
    return [];
  }

  getItemText(_item: T): string {
    return "";
  }

  onChooseItem(_item: T): void {}
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

export const Platform = {
  isDesktopApp: true,
};

export function setIcon(el: Element, icon: string): void {
  el.setAttribute("data-icon", icon);
}

export interface ObsidianMockMenuItem {
  title: string | DocumentFragment;
  icon: string | null;
  disabled: boolean;
  checked: boolean;
  onClick: ((event: MouseEvent | KeyboardEvent) => unknown) | null;
  classNames: Set<string>;
}

export interface ObsidianMockMenuPosition {
  x: number;
  y: number;
  overlap?: boolean;
}

interface ObsidianMockMenuDom {
  classList: { add: (token: string) => void };
  querySelectorAll: (selectors: string) => Array<{
    classList: { add: (token: string) => void };
    querySelector: (selectors: string) => { textContent: string } | null;
  }>;
}

const obsidianMenuInstances: ObsidianMockMenu[] = [];

/** Menu items built by code under test; mirrors the chainable MenuItem API the builder uses. */
class ObsidianMockMenuItemApi {
  constructor(private readonly record: ObsidianMockMenuItem) {}

  setTitle(title: string | DocumentFragment): this {
    this.record.title = title;
    return this;
  }

  setIcon(icon: string | null): this {
    this.record.icon = icon;
    return this;
  }

  setChecked(checked: boolean): this {
    this.record.checked = checked;
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.record.disabled = disabled;
    return this;
  }

  onClick(callback: (event: MouseEvent | KeyboardEvent) => unknown): this {
    this.record.onClick = callback;
    return this;
  }
}

/** Minimal Menu stand-in: records items, separators, and shown positions for assertions. */
export class ObsidianMockMenu {
  readonly items: ObsidianMockMenuItem[] = [];
  separators = 0;
  readonly positions: ObsidianMockMenuPosition[] = [];
  readonly classNames = new Set<string>(["menu"]);
  readonly dom: ObsidianMockMenuDom;

  constructor() {
    obsidianMenuInstances.push(this);
    this.dom = {
      classList: {
        add: (token: string) => {
          this.classNames.add(token);
        },
      },
      querySelectorAll: (selectors: string) => {
        if (selectors !== ".menu-item") {
          return [];
        }
        return this.items.map((item) => ({
          classList: {
            add: (token: string) => {
              item.classNames.add(token);
            },
          },
          querySelector: (itemSelectors: string) => itemSelectors === ".menu-item-title"
            ? { textContent: typeof item.title === "string" ? item.title : item.title.textContent ?? "" }
            : null,
        }));
      },
    };
  }

  addItem(configure: (item: ObsidianMockMenuItemApi) => unknown): this {
    const record: ObsidianMockMenuItem = {
      title: "",
      icon: null,
      disabled: false,
      checked: false,
      onClick: null,
      classNames: new Set<string>(["menu-item"]),
    };
    this.items.push(record);
    configure(new ObsidianMockMenuItemApi(record));
    return this;
  }

  addSeparator(): this {
    this.separators += 1;
    return this;
  }

  showAtPosition(position: ObsidianMockMenuPosition): this {
    this.positions.push(position);
    return this;
  }

  showAtMouseEvent(event: { clientX: number; clientY: number }): this {
    this.positions.push({ x: event.clientX, y: event.clientY });
    return this;
  }

  hide(): this {
    return this;
  }

  onHide(_callback: () => unknown): this {
    return this;
  }
}

// The shared mock exports Menu under the runtime name plugins import.
export { ObsidianMockMenu as Menu };

export function getObsidianMenuInstances(): ObsidianMockMenu[] {
  return [...obsidianMenuInstances];
}

export function resetObsidianMenuInstances(): void {
  obsidianMenuInstances.length = 0;
}


export function addIcon(_name: string, _svgContent: string): void {
}
export function setTooltip(el: Element, tooltip: string, _options?: unknown): void {
  el.setAttribute("data-tooltip", tooltip);
}

export function getAllTags(cache: { tags?: Array<{ tag: string }> } | null): string[] {
  return cache?.tags?.map((entry) => entry.tag) ?? [];
}
