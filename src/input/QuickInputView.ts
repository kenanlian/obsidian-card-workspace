import { ItemView, type WorkspaceLeaf, type ViewStateResult } from "obsidian";

import { QUICK_INPUT_VIEW } from "./quick-input-desktop";
export { QUICK_INPUT_VIEW } from "./quick-input-desktop";
export interface QuickInputViewHost {
  getTitle(): string;
  discard(view: QuickInputView): void;
}
/** Compatibility tombstone for layouts saved by the former popout implementation.
 * New quick-input windows never construct or serialize a workspace view. */
export class QuickInputView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly host: QuickInputViewHost) { super(leaf); }
  getViewType(): string { return QUICK_INPUT_VIEW; }
  getDisplayText(): string { return this.host.getTitle(); }
  getIcon(): string { return "send"; }
  getState(): Record<string, unknown> { return {}; }
  async setState(_state: Record<string, unknown>, _result: ViewStateResult): Promise<void> {
    this.host.discard(this);
  }
}
