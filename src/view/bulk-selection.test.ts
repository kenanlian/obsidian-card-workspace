import { describe, expect, it } from "vitest";

import {
  clearSelection,
  migrateRenamedPath,
  pruneRemovedPath,
  rangeSelect,
  reconcileToVisiblePaths,
  selectAll,
  toggleSelection,
} from "./bulk-selection";
import type { BulkSelectionState } from "./bulk-selection";

function createState(paths: string[], anchorPath: string | null): BulkSelectionState {
  return {
    selectedPaths: new Set(paths),
    anchorPath,
  };
}

function setToArray(value: ReadonlySet<string>): string[] {
  return Array.from(value);
}

describe("bulk-selection", () => {
  it("toggles a path on and off without mutating input state", () => {
    const initialSelection = new Set(["notes/a.md"]);
    const state: BulkSelectionState = {
      selectedPaths: initialSelection,
      anchorPath: null,
    };

    const added = toggleSelection(state, "notes/b.md");
    expect(setToArray(added.selectedPaths)).toEqual(["notes/a.md", "notes/b.md"]);
    expect(added.anchorPath).toBe("notes/b.md");
    expect(added.changed).toBe(true);
    expect(setToArray(initialSelection)).toEqual(["notes/a.md"]);

    const removed = toggleSelection(added, "notes/b.md");
    expect(setToArray(removed.selectedPaths)).toEqual(["notes/a.md"]);
    expect(removed.anchorPath).toBe("notes/a.md");
    expect(removed.changed).toBe(true);
  });

  it("selects an inclusive range based on ordered visible paths", () => {
    const orderedVisiblePaths = ["notes/a.md", "notes/b.md", "notes/c.md", "notes/d.md"];
    const state = createState(["notes/a.md"], "notes/a.md");

    const result = rangeSelect(state, "notes/a.md", "notes/c.md", orderedVisiblePaths);

    expect(setToArray(result.selectedPaths)).toEqual(["notes/a.md", "notes/b.md", "notes/c.md"]);
    expect(result.anchorPath).toBe("notes/a.md");
    expect(result.changed).toBe(true);
  });

  it("falls back to target as anchor when provided anchor is not visible", () => {
    const orderedVisiblePaths = ["notes/b.md", "notes/c.md", "notes/d.md"];
    const state = createState([], null);

    const result = rangeSelect(state, "notes/a.md", "notes/c.md", orderedVisiblePaths);

    expect(setToArray(result.selectedPaths)).toEqual(["notes/c.md"]);
    expect(result.anchorPath).toBe("notes/c.md");
    expect(result.changed).toBe(true);
  });

  it("selects all visible paths and preserves an existing visible anchor", () => {
    const orderedVisiblePaths = ["notes/b.md", "notes/a.md", "notes/c.md", "notes/a.md"];
    const state = createState(["notes/x.md"], "notes/a.md");

    const result = selectAll(state, orderedVisiblePaths);

    expect(setToArray(result.selectedPaths)).toEqual(["notes/b.md", "notes/a.md", "notes/c.md"]);
    expect(result.anchorPath).toBe("notes/a.md");
    expect(result.changed).toBe(true);
  });

  it("clears selected paths and anchor", () => {
    const state = createState(["notes/a.md", "notes/b.md"], "notes/b.md");

    const result = clearSelection(state);

    expect(setToArray(result.selectedPaths)).toEqual([]);
    expect(result.anchorPath).toBeNull();
    expect(result.changed).toBe(true);
  });

  it("reconciles selected paths to visible paths in visible order", () => {
    const state = createState(["notes/c.md", "notes/a.md", "notes/z.md"], "notes/z.md");
    const orderedVisiblePaths = ["notes/b.md", "notes/c.md", "notes/a.md"];

    const result = reconcileToVisiblePaths(state, orderedVisiblePaths);

    expect(setToArray(result.selectedPaths)).toEqual(["notes/c.md", "notes/a.md"]);
    expect(result.anchorPath).toBe("notes/c.md");
    expect(result.changed).toBe(true);
  });

  it("returns unchanged state when reconciling already-visible selection", () => {
    const state = createState(["notes/a.md", "notes/b.md"], "notes/a.md");
    const orderedVisiblePaths = ["notes/a.md", "notes/b.md", "notes/c.md"];

    const result = reconcileToVisiblePaths(state, orderedVisiblePaths);

    expect(setToArray(result.selectedPaths)).toEqual(["notes/a.md", "notes/b.md"]);
    expect(result.anchorPath).toBe("notes/a.md");
    expect(result.changed).toBe(false);
  });

  it("migrates renamed path and prunes removed path", () => {
    const state = createState(["notes/old.md", "notes/keep.md"], "notes/old.md");

    const migrated = migrateRenamedPath(state, "notes/old.md", "notes/new.md");
    expect(setToArray(migrated.selectedPaths)).toEqual(["notes/keep.md", "notes/new.md"]);
    expect(migrated.anchorPath).toBe("notes/new.md");
    expect(migrated.changed).toBe(true);

    const pruned = pruneRemovedPath(migrated, "notes/new.md");
    expect(setToArray(pruned.selectedPaths)).toEqual(["notes/keep.md"]);
    expect(pruned.anchorPath).toBe("notes/keep.md");
    expect(pruned.changed).toBe(true);
  });
});
