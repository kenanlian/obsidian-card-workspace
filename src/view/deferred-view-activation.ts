import type { Workspace, WorkspaceLeaf } from "obsidian";

export async function activateDeferredView<T>(
  workspace: Workspace,
  viewType: string,
  isExpectedView: (value: unknown) => value is T,
  isCurrent: () => boolean = () => true,
  allowCreate = true,
  preferLeft = false,
  transfer?: (source: T, target: T) => Promise<boolean | void>,
): Promise<T | null> {
  const existing = workspace.getLeavesOfType(viewType);
  if (existing.length === 0 && !allowCreate) return null;
  const sideLeaf = preferLeft ? existing.find((item) => item.getRoot() === workspace.leftSplit) : existing[0];
  const source = preferLeft && !sideLeaf ? existing[0] : undefined;
  const leaf: WorkspaceLeaf | null = sideLeaf ?? workspace.getLeftLeaf(false);
  if (!leaf) return null;
  const created = !sideLeaf;
  let committed = false;
  try {
    if (created) {
      await leaf.setViewState({ type: viewType, active: true });
      if (!isCurrent()) return null;
    }
    await workspace.revealLeaf(leaf);
    if (!isCurrent()) return null;
    const load = async (item: WorkspaceLeaf): Promise<void> => {
      const deferred = item as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
      if (typeof deferred.loadIfDeferred === "function") await deferred.loadIfDeferred();
    };
    await load(leaf);
    if (!isCurrent() || !isExpectedView(leaf.view)) return null;
    if (source) {
      await load(source);
      if (!isCurrent() || !isExpectedView(source.view)) return null;
      if (await transfer?.(source.view, leaf.view) === false) return null;
      if (!isCurrent()) return null;
    }
    workspace.setActiveLeaf(leaf, { focus: false });
    committed = true;
    source?.detach();
    return leaf.view;
  } finally {
    if (created && !committed) leaf.detach();
  }
}
