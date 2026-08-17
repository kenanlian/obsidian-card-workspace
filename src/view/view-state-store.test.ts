import { describe, expect, it } from "vitest";

import { createViewStateStore } from "./view-state-store";
import type { NoteCardRecord } from "./types";

function createCard(path: string, title: string): NoteCardRecord {
  return {
    file: {} as never,
    fileKind: "markdown",
    path,
    title,
    ctime: 1,
    mtime: 2,
    excerpt: "excerpt",
    previewHtml: "<p>Preview</p>",
    previewMode: "text",
    hydrated: false,
  };
}

describe("createViewStateStore", () => {
  it("installs one shared replacement in both arrays and preserves sibling records", () => {
    const store = createViewStateStore({ kind: "folder", path: "notes", includeSubfolders: false });
    const target = createCard("notes/target.md", "Target");
    const baseSibling = createCard("notes/base-sibling.md", "Base sibling");
    const visibleSibling = createCard("notes/visible-sibling.md", "Visible sibling");
    const originalBase = [target, baseSibling];
    const originalVisible = [visibleSibling, target];
    store.replaceBaseCards(originalBase);
    store.replaceVisibleCards(originalVisible);

    store.patchCard(target.path, {
      hydrated: true,
      previewHtml: "<p>Hydrated preview</p>",
    });

    const nextBase = store.getBaseCards();
    const nextVisible = store.getVisibleCards();
    expect(nextBase).not.toBe(originalBase);
    expect(nextVisible).not.toBe(originalVisible);
    expect(nextBase[0]).not.toBe(target);
    expect(nextBase[0]).toBe(nextVisible[1]);
    expect(nextBase[0]).toMatchObject({
      path: target.path,
      title: target.title,
      hydrated: true,
      previewHtml: "<p>Hydrated preview</p>",
    });
    expect(nextBase[1]).toBe(baseSibling);
    expect(nextVisible[0]).toBe(visibleSibling);
  });

  it("replaces only the array containing the target", () => {
    const store = createViewStateStore({ kind: "folder", path: "", includeSubfolders: true });
    const baseCard = createCard("notes/base.md", "Base");
    const visibleTarget = createCard("notes/visible.md", "Visible");
    const originalBase = [baseCard];
    const originalVisible = [visibleTarget];
    store.replaceBaseCards(originalBase);
    store.replaceVisibleCards(originalVisible);

    store.patchCard(visibleTarget.path, { hydrated: true });

    expect(store.getBaseCards()).toBe(originalBase);
    expect(store.getBaseCards()[0]).toBe(baseCard);
    expect(store.getVisibleCards()).not.toBe(originalVisible);
    expect(store.getVisibleCards()[0]).not.toBe(visibleTarget);
    expect(store.getVisibleCards()[0]?.hydrated).toBe(true);
  });

  it("leaves both arrays unchanged for an unknown path", () => {
    const store = createViewStateStore({ kind: "box", boxId: "box-1" });
    const baseCard = createCard("notes/base.md", "Base");
    const visibleCard = createCard("notes/visible.md", "Visible");
    const originalBase = [baseCard];
    const originalVisible = [visibleCard];
    store.replaceBaseCards(originalBase);
    store.replaceVisibleCards(originalVisible);

    store.patchCard("notes/missing.md", { hydrated: true });

    expect(store.getBaseCards()).toBe(originalBase);
    expect(store.getVisibleCards()).toBe(originalVisible);
    expect(store.getBaseCards()[0]).toBe(baseCard);
    expect(store.getVisibleCards()[0]).toBe(visibleCard);
  });
});
