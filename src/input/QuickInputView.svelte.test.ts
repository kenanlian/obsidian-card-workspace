import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", () => ({ ItemView: class { constructor(readonly leaf: WorkspaceLeaf) {} } }));
import { QuickInputView, QUICK_INPUT_VIEW } from "./QuickInputView";

describe("legacy quick input layout cleanup", () => {
  it.each([{}, { sessionId: "old-token", text: "must not persist", pinned: true }, { sessionId: 42 }])("discards restored state without reviving an editor or saving a token", async (state) => {
    const host = { discard: vi.fn(), getTitle: () => "快速输入" };
    const leaf = {} as WorkspaceLeaf;
    const view = new QuickInputView(leaf, host);
    await view.setState(state, { history: false });
    expect(view.getState()).toEqual({});
    expect(view.getViewType()).toBe(QUICK_INPUT_VIEW); expect(view.getDisplayText()).toBe("快速输入");
    expect(host.discard).toHaveBeenCalledExactlyOnceWith(view);
  });
});
