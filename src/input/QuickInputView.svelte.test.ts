import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLeaf } from "obsidian";
vi.mock("obsidian", () => ({ ItemView: class { constructor(readonly leaf: WorkspaceLeaf) {} } }));
import { QuickInputView, QUICK_INPUT_VIEW } from "./QuickInputView";

describe("quick input transient view", () => {
  it("serializes only its session token and delegates mounting and closing to the vault owner", async () => {
    const host = { attach: vi.fn(), close: vi.fn(), getTitle: () => "快速输入" };
    const leaf = {} as WorkspaceLeaf;
    const view = new QuickInputView(leaf, host);
    await view.setState({ sessionId: "live-token", text: "must not persist", pinned: true } as { sessionId: string }, { history: false });
    expect(view.getState()).toEqual({ sessionId: "live-token" });
    expect(view.getViewType()).toBe(QUICK_INPUT_VIEW); expect(view.getDisplayText()).toBe("快速输入");
    expect(host.attach).toHaveBeenCalledExactlyOnceWith("live-token", view);
    await view.onClose(); expect(host.close).toHaveBeenCalledExactlyOnceWith(view);
  });
  it("passes missing or malformed restored tokens to cleanup without inventing a draft", async () => {
    const host = { attach: vi.fn(), close: vi.fn(), getTitle: () => "Quick input" };
    const view = new QuickInputView({} as WorkspaceLeaf, host);
    await view.setState({}, { history: false }); await view.setState({ sessionId: 42 }, { history: false });
    expect(view.getState()).toEqual({ sessionId: "" });
    expect(host.attach.mock.calls.map(([id]) => id)).toEqual(["", ""]);
  });
});
