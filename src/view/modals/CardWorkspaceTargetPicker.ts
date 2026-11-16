import { FuzzySuggestModal, type App, type WorkspaceLeaf } from "obsidian";

export interface CardWorkspaceTarget {
  leaf: WorkspaceLeaf;
  label: string;
}

/** Native searchable, keyboard-accessible choice; dismissal leaves the workspace untouched. */
export class CardWorkspaceTargetPicker extends FuzzySuggestModal<CardWorkspaceTarget> {
  private settled = false;

  constructor(
    app: App,
    private readonly targets: CardWorkspaceTarget[],
    title: string,
    private readonly choose: (leaf: WorkspaceLeaf | null) => void,
  ) {
    super(app);
    this.setTitle(title);
    this.setPlaceholder(title);
  }

  getItems(): CardWorkspaceTarget[] { return this.targets; }
  getItemText(item: CardWorkspaceTarget): string { return item.label; }
  onChooseItem(item: CardWorkspaceTarget): void { this.finish(item.leaf); }

  onClose(): void {
    super.onClose();
    // The host can close its suggestion UI before invoking onChooseItem.
    queueMicrotask(() => this.finish(null));
  }

  private finish(leaf: WorkspaceLeaf | null): void {
    if (this.settled) return;
    this.settled = true;
    this.choose(leaf);
  }
}
