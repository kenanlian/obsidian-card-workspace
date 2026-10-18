import { ItemView, type WorkspaceLeaf, type ViewStateResult } from "obsidian";

import { QUICK_INPUT_VIEW } from "./quick-input-desktop";
export { QUICK_INPUT_VIEW } from "./quick-input-desktop";
export interface QuickInputViewHost {
  getTitle(): string;
  attach(sessionId: string, view: QuickInputView): void;
  close(view: QuickInputView): void;
}
/** Layout contains only a transient token; a restored token never creates a draft. */
export class QuickInputView extends ItemView {
  private sessionId = "";
  constructor(leaf: WorkspaceLeaf, private readonly host: QuickInputViewHost) { super(leaf); }
  getViewType(): string { return QUICK_INPUT_VIEW; }
  getDisplayText(): string { return this.host.getTitle(); }
  getIcon(): string { return "send"; }
  getState(): Record<string, unknown> { return { sessionId: this.sessionId }; }
  async setState(state: { sessionId?: unknown }, _result: ViewStateResult): Promise<void> {
    this.sessionId = typeof state?.sessionId === "string" ? state.sessionId : "";
    this.host.attach(this.sessionId, this);
  }
  async onClose(): Promise<void> { this.host.close(this); }
}
