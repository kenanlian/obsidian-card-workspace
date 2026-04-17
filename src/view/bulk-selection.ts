export interface BulkSelectionState {
  selectedPaths: ReadonlySet<string>;
  anchorPath: string | null;
}

export interface BulkSelectionResult {
  selectedPaths: Set<string>;
  anchorPath: string | null;
  changed: boolean;
}

export function toggleSelection(state: BulkSelectionState, path: string): BulkSelectionResult {
  const nextSelectedPaths = new Set(state.selectedPaths);

  if (nextSelectedPaths.has(path)) {
    nextSelectedPaths.delete(path);
  } else {
    nextSelectedPaths.add(path);
  }

  const nextAnchorPath = nextSelectedPaths.has(path)
    ? path
    : state.anchorPath === path
      ? getFirstPath(nextSelectedPaths)
      : state.anchorPath;

  return createResult(state, nextSelectedPaths, nextAnchorPath);
}

export function rangeSelect(
  state: BulkSelectionState,
  anchorPath: string | null,
  targetPath: string,
  orderedVisiblePaths: readonly string[],
): BulkSelectionResult {
  const targetIndex = orderedVisiblePaths.indexOf(targetPath);
  if (targetIndex < 0) {
    return createResult(state, new Set(state.selectedPaths), state.anchorPath);
  }

  const effectiveAnchorPath =
    anchorPath !== null && orderedVisiblePaths.includes(anchorPath) ? anchorPath : targetPath;
  const anchorIndex = orderedVisiblePaths.indexOf(effectiveAnchorPath);

  const rangeStart = Math.min(anchorIndex, targetIndex);
  const rangeEnd = Math.max(anchorIndex, targetIndex);
  const nextSelectedPaths = new Set(orderedVisiblePaths.slice(rangeStart, rangeEnd + 1));

  return createResult(state, nextSelectedPaths, effectiveAnchorPath);
}

export function selectAll(
  state: BulkSelectionState,
  orderedVisiblePaths: readonly string[],
): BulkSelectionResult {
  const nextSelectedPaths = new Set(orderedVisiblePaths);
  const nextAnchorPath =
    state.anchorPath !== null && nextSelectedPaths.has(state.anchorPath)
      ? state.anchorPath
      : getFirstPath(nextSelectedPaths);

  return createResult(state, nextSelectedPaths, nextAnchorPath);
}

export function clearSelection(state: BulkSelectionState): BulkSelectionResult {
  return createResult(state, new Set<string>(), null);
}

export function reconcileToVisiblePaths(
  state: BulkSelectionState,
  orderedVisiblePaths: readonly string[],
): BulkSelectionResult {
  const visiblePathSet = new Set(orderedVisiblePaths);
  const nextSelectedPaths = new Set<string>();

  for (const path of orderedVisiblePaths) {
    if (state.selectedPaths.has(path)) {
      nextSelectedPaths.add(path);
    }
  }

  const nextAnchorPath =
    state.anchorPath !== null && visiblePathSet.has(state.anchorPath)
      ? state.anchorPath
      : getFirstPath(nextSelectedPaths);

  return createResult(state, nextSelectedPaths, nextAnchorPath);
}

export function migrateRenamedPath(
  state: BulkSelectionState,
  oldPath: string,
  newPath: string,
): BulkSelectionResult {
  if (oldPath === newPath) {
    return createResult(state, new Set(state.selectedPaths), state.anchorPath);
  }

  const nextSelectedPaths = new Set(state.selectedPaths);
  if (nextSelectedPaths.has(oldPath)) {
    nextSelectedPaths.delete(oldPath);
    nextSelectedPaths.add(newPath);
  }

  const nextAnchorPath = state.anchorPath === oldPath ? newPath : state.anchorPath;

  return createResult(state, nextSelectedPaths, nextAnchorPath);
}

export function pruneRemovedPath(state: BulkSelectionState, path: string): BulkSelectionResult {
  const nextSelectedPaths = new Set(state.selectedPaths);
  nextSelectedPaths.delete(path);

  const nextAnchorPath =
    state.anchorPath === path ? getFirstPath(nextSelectedPaths) : state.anchorPath;

  return createResult(state, nextSelectedPaths, nextAnchorPath);
}

function createResult(
  previousState: BulkSelectionState,
  nextSelectedPaths: Set<string>,
  nextAnchorPath: string | null,
): BulkSelectionResult {
  return {
    selectedPaths: nextSelectedPaths,
    anchorPath: nextAnchorPath,
    changed:
      previousState.anchorPath !== nextAnchorPath ||
      !setsEqual(previousState.selectedPaths, nextSelectedPaths),
  };
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function getFirstPath(paths: ReadonlySet<string>): string | null {
  for (const path of paths) {
    return path;
  }

  return null;
}
