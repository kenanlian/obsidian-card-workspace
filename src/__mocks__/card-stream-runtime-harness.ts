import { ItemView, type WorkspaceLeaf } from "obsidian";
import type CardWorkspacePlugin from "../main";
import { CardStreamRuntime } from "../view/CardStreamRuntime";

class StreamTestHost extends ItemView {
  getViewType(): string { return "stream-test-host"; }
  getDisplayText(): string { return "Card stream"; }
}

/** Retains the single-stream fixtures while leaf composition is tested separately. */
export class TestCardStreamRuntime extends CardStreamRuntime {
  constructor(leaf: WorkspaceLeaf, plugin: CardWorkspacePlugin) {
    super(new StreamTestHost(leaf), plugin);
  }
}
