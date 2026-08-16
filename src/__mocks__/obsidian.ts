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


export function addIcon(_name: string, _svgContent: string): void {
}
export function setTooltip(el: Element, tooltip: string, _options?: unknown): void {
  el.setAttribute("data-tooltip", tooltip);
}

export function getAllTags(cache: { tags?: Array<{ tag: string }> } | null): string[] {
  return cache?.tags?.map((entry) => entry.tag) ?? [];
}
