import type { Workspace, WorkspaceLeaf } from "obsidian";

export async function activateDeferredView<T>(
  workspace: Workspace,
  viewType: string,
  isExpectedView: (value: unknown) => value is T,
  isCurrent: () => boolean = () => true,
): Promise<T | null> {
  const existing = workspace.getLeavesOfType(viewType);
  const leaf: WorkspaceLeaf | null = existing[0] ?? workspace.getLeftLeaf(false);
  if (!leaf) return null;
  if (existing.length === 0) {
    await leaf.setViewState({ type: viewType, active: true });
    if (!isCurrent()) return null;
  }
  await workspace.revealLeaf(leaf);
  if (!isCurrent()) return null;
  const deferredLeaf = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
  if (typeof deferredLeaf.loadIfDeferred === "function") await deferredLeaf.loadIfDeferred();
  if (!isCurrent() || !isExpectedView(leaf.view)) return null;
  workspace.setActiveLeaf(leaf, { focus: false });
  return leaf.view;
}
