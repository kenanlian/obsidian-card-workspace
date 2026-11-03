import { getIcon, setIcon } from "obsidian";
import type { IconSpec } from "./icon-config";

export interface ContentIconRender { spec: IconSpec; fallback: string }
/** Every surface uses the same fallback; unknown Lucide IDs remain persisted. */
export function renderContentIcon(node: HTMLElement, { spec, fallback }: ContentIconRender): void {
  node.replaceChildren();
  node.classList.toggle("fce-emoji-icon", spec.kind === "emoji");
  node.classList.toggle("fce-icon-none", spec.kind === "none");
  if (spec.kind === "none") return;
  if (spec.kind === "emoji") node.textContent = spec.value;
  else setIcon(node, getIcon(spec.value) ? spec.value : fallback);
}
export function contentIcon(node: HTMLElement, value: ContentIconRender): { update: (next: ContentIconRender) => void } {
  renderContentIcon(node, value);
  return { update: next => renderContentIcon(node, next) };
}
