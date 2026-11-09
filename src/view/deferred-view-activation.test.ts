import { describe, expect, it, vi } from "vitest";
import { activateDeferredView } from "./deferred-view-activation";

function setup() {
  const leftSplit = {}, rootSplit = {};
  const makeLeaf = (root: object) => ({
    view: { card: true }, getRoot: () => root,
    setViewState: vi.fn(async () => {}), loadIfDeferred: vi.fn(async () => {}), detach: vi.fn(),
  });
  const target = makeLeaf(leftSplit), source = makeLeaf(rootSplit);
  const workspace = {
    leftSplit, getLeavesOfType: vi.fn(() => [source]), getLeftLeaf: vi.fn(() => target),
    revealLeaf: vi.fn(async () => {}), setActiveLeaf: vi.fn(),
  };
  const activate = (transfer = vi.fn(async () => {}), current = () => true, allowCreate = true) =>
    activateDeferredView(workspace as never, "cards", (value): value is typeof target.view => !!value && typeof value === "object" && "card" in value,
      current, allowCreate, true, transfer);
  return { workspace, source, target, activate };
}

describe("sidebar activation", () => {
  it("restores the target before detaching the old main-workspace view", async () => {
    const h = setup();
    const transfer = vi.fn(async () => { expect(h.source.detach).not.toHaveBeenCalled(); });
    expect(await h.activate(transfer)).toBe(h.target.view);
    expect(transfer).toHaveBeenCalledWith(h.source.view, h.target.view);
    expect(h.source.detach).toHaveBeenCalledOnce();
    expect(h.target.detach).not.toHaveBeenCalled();
    expect(h.workspace.getLeftLeaf).toHaveBeenCalledWith(false);
  });
  it("prefers an existing left leaf and leaves unrelated views alone", async () => {
    const h = setup(); h.workspace.getLeavesOfType.mockReturnValue([h.source, h.target]);
    expect(await h.activate()).toBe(h.target.view);
    expect(h.workspace.getLeftLeaf).not.toHaveBeenCalled();
    expect(h.source.detach).not.toHaveBeenCalled();
  });
  it("retains the source and removes the incomplete target on transfer failure", async () => {
    const h = setup();
    await expect(h.activate(vi.fn(async () => { throw new Error("failed"); }))).rejects.toThrow("failed");
    expect(h.source.detach).not.toHaveBeenCalled(); expect(h.target.detach).toHaveBeenCalledOnce();
  });
  it("retains the source when a newer selection rejects the transfer", async () => {
    const h = setup();
    const transfer = vi.fn(async () => false);
    expect(await activateDeferredView(h.workspace as never, "cards", (value): value is object => !!value,
      () => true, true, true, transfer)).toBeNull();
    expect(h.source.detach).not.toHaveBeenCalled(); expect(h.target.detach).toHaveBeenCalledOnce();
  });
  it("drops activation after unloading without closing the original view", async () => {
    const h = setup(); let current = true;
    h.workspace.revealLeaf.mockImplementation(async () => { current = false; });
    expect(await h.activate(undefined, () => current)).toBeNull();
    expect(h.source.detach).not.toHaveBeenCalled(); expect(h.target.detach).toHaveBeenCalledOnce();
    expect(h.workspace.setActiveLeaf).not.toHaveBeenCalled();
  });
  it("creates nothing on startup without an existing view, but migrates one that exists", async () => {
    const h = setup(); h.workspace.getLeavesOfType.mockReturnValue([]);
    expect(await h.activate(undefined, undefined, false)).toBeNull();
    expect(h.workspace.getLeftLeaf).not.toHaveBeenCalled();
    h.workspace.getLeavesOfType.mockReturnValue([h.source]);
    expect(await h.activate(undefined, undefined, false)).toBe(h.target.view);
  });
});
