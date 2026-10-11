import type { HoverParent, HoverPopover } from "obsidian";
import type { PluginSettings } from "../../settings";

/** Styles the native preview when Page preview assigns it, including delayed Mod-key activation. */
export class CardHoverPreviewController implements HoverParent {
  private popover: HoverPopover | null = null;
  private active = true;

  constructor(private readonly getSettings: () => PluginSettings) {}

  get hoverPopover(): HoverPopover | null {
    return this.popover;
  }

  set hoverPopover(value: HoverPopover | null) {
    this.popover = value;
    this.applySize();
    // Some hosts assign the parent during construction, before hoverEl exists.
    if (value && !value.hoverEl) {
      queueMicrotask(() => {
        if (this.popover === value) this.applySize();
      });
    }
    if (value && !this.active) {
      queueMicrotask(() => {
        if (this.popover === value && !this.active) this.dispose();
      });
    }
  }

  activate(): void {
    this.active = true;
  }

  applySize(): void {
    const element = this.popover?.hoverEl;
    if (!this.active || !element) return;
    const { hoverPreviewWidth, hoverPreviewHeight } = this.getSettings();
    element.classList.add("fce-card-hover-preview");
    element.style.setProperty("--fce-hover-preview-width", `${hoverPreviewWidth}px`);
    element.style.setProperty("--fce-hover-preview-height", `${hoverPreviewHeight}px`);
  }

  dispose(): void {
    this.active = false;
    const popover = this.popover;
    this.popover = null;
    popover?.unload();
  }
}
