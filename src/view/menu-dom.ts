import type { Menu } from "obsidian";

export interface MenuDomLike {
  classList: {
    add: (token: string) => void;
  };
  querySelectorAll?: (selectors: string) => Iterable<Element>;
}

export function isMenuDomLike(value: unknown): value is MenuDomLike {
  if (typeof value !== "object" || value === null || !("classList" in value)) {
    return false;
  }

  const { classList } = value;
  return typeof classList === "object" && classList !== null && "add" in classList && typeof classList.add === "function";
}

export function getMenuDom(menu: Menu): MenuDomLike | null {
  const candidate = menu as unknown as { dom?: unknown };
  return isMenuDomLike(candidate.dom) ? candidate.dom : null;
}
