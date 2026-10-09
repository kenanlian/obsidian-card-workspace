import { installObsidianDomHelpers } from "../../src/__mocks__/obsidian-dom";

installObsidianDomHelpers(document);

export class TFile { path = ""; basename = ""; stat = { mtime: 1, ctime: 1, size: 1 }; }
export class TFolder {}
export class Menu { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
export function setIcon(el: HTMLElement, icon: string) { el.dataset.icon = icon; }
export function setTooltip() {}
export function getAllTags() { return []; }
export function normalizePath(path: string) { return path; }
export function debounce(fn: (...args: any[]) => void) { return fn; }
export function resolveSubpath() { return null; }
export function getLanguage() { return "en"; }
