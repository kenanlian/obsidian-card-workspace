import { describe, expect, it } from "vitest";

import type { NavigationRow } from "./navigation-model";
import {
  canAcceptFavoriteDrop,
  favoriteRowDragState,
  resolveFavoriteDropPosition,
} from "./navigation-favorite-dnd";

const favoriteRow = { kind: "favorite", id: "favorite:tag:work", favorite: { kind: "tag", ref: "work" } };
const folderFavoriteRow = { kind: "favorite", id: "favorite:folder:notes", favorite: { kind: "folder", ref: "notes" } };
const tagTreeRow = { kind: "tag", id: "tag:work" };

describe("resolveFavoriteDropPosition", () => {
  it("splits before/after at the row midpoint", () => {
    const rect = { top: 100, height: 40 };
    expect(resolveFavoriteDropPosition(100, rect)).toBe("before");
    expect(resolveFavoriteDropPosition(120, rect)).toBe("before");
    expect(resolveFavoriteDropPosition(121, rect)).toBe("after");
    expect(resolveFavoriteDropPosition(140, rect)).toBe("after");
  });
});

describe("canAcceptFavoriteDrop", () => {
  it("accepts any favorites row regardless of kind", () => {
    expect(canAcceptFavoriteDrop({ kind: "tag", ref: "home" }, { kind: "tag", ref: "work" })).toBe(true);
    expect(canAcceptFavoriteDrop({ kind: "tag", ref: "home" }, { kind: "folder", ref: "notes" })).toBe(true);
    expect(canAcceptFavoriteDrop({ kind: "box", ref: "box-1" }, { kind: "file", ref: "A.md" })).toBe(true);
  });

  it("rejects an absent source and the dragged row itself", () => {
    expect(canAcceptFavoriteDrop(null, { kind: "tag", ref: "work" })).toBe(false);
    expect(canAcceptFavoriteDrop({ kind: "tag", ref: "work" }, { kind: "tag", ref: "work" })).toBe(false);
  });
});

describe("favoriteRowDragState", () => {
  it("marks only favorite rows draggable", () => {
    expect(favoriteRowDragState(tagTreeRow as unknown as NavigationRow, { source: null, target: null })).toBeNull();
    expect(favoriteRowDragState(favoriteRow as unknown as NavigationRow, { source: null, target: null }))
      .toEqual({ draggable: true, dragging: false, dropIndicator: null });
  });

  it("highlights the dragged source and the drop target edge", () => {
    const drag = {
      source: { kind: "tag", ref: "home" } as const,
      target: { rowId: "favorite:tag:work", position: "after" as const },
    };
    expect(favoriteRowDragState(favoriteRow as unknown as NavigationRow, drag))
      .toEqual({ draggable: true, dragging: false, dropIndicator: "after" });
    expect(favoriteRowDragState(folderFavoriteRow as unknown as NavigationRow, drag))
      .toEqual({ draggable: true, dragging: false, dropIndicator: null });

    const selfDrag = { ...drag, source: { kind: "tag" as const, ref: "work" } };
    expect(favoriteRowDragState(favoriteRow as unknown as NavigationRow, selfDrag))
      .toEqual({ draggable: true, dragging: true, dropIndicator: "after" });
  });
});
