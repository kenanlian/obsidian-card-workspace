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

    store.patchCardPreviews([{ path: target.path, patch: {
      hydrated: true,
      previewHtml: "<p>Hydrated preview</p>",
    } }]);

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

    store.patchCardPreviews([{ path: visibleTarget.path, patch: { hydrated: true } }]);

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

    store.patchCardPreviews([{ path: "notes/missing.md", patch: { hydrated: true } }]);

    expect(store.getBaseCards()).toBe(originalBase);
    expect(store.getVisibleCards()).toBe(originalVisible);
    expect(store.getBaseCards()[0]).toBe(baseCard);
    expect(store.getVisibleCards()[0]).toBe(visibleCard);
  });

  it("merges repeated preview updates in input order and ignores unknown paths", () => {
    const store = createViewStateStore({ kind: "folder", path: "", includeSubfolders: true });
    const target = createCard("target.md", "Target");
    const sibling = createCard("sibling.md", "Sibling");
    store.replaceBaseCards([target, sibling]);
    store.replaceVisibleCards([target]);

    store.patchCardPreviews([
      { path: target.path, patch: { hydrated: true, previewHtml: "first" } },
      { path: "missing.md", patch: { hydrated: true } },
      { path: target.path, patch: { previewHtml: "second", previewMode: "code" } },
    ]);

    expect(store.getBaseCard(target.path)).toBe(store.getVisibleCards()[0]);
    expect(store.getBaseCard(target.path)).toMatchObject({
      hydrated: true,
      previewHtml: "second",
      previewMode: "code",
    });
    expect(store.getBaseCards()[1]).toBe(sibling);
  });

  it("keeps path lookup maps correct across replacements and empty patch batches", () => {
    const store = createViewStateStore({ kind: "folder", path: "", includeSubfolders: true });
    const first = createCard("first.md", "First");
    const second = createCard("second.md", "Second");
    store.replaceBaseCards([first]);
    const originalBase = store.getBaseCards();

    expect(store.getBaseCard(first.path)).toBe(first);
    store.replaceBaseCards([second]);
    expect(store.getBaseCard(first.path)).toBeUndefined();
    expect(store.getBaseCard(second.path)).toBe(second);

    const replacementBase = store.getBaseCards();
    store.patchCardPreviews([]);
    expect(store.getBaseCards()).toBe(replacementBase);
    expect(store.getBaseCards()).not.toBe(originalBase);
  });

  it("advances sequence revision only when ordered visible paths change", () => {
    const store = createViewStateStore({ kind: "folder", path: "", includeSubfolders: true });
    const first = createCard("first.md", "First");
    const second = createCard("second.md", "Second");

    expect(store.getVisibleSequenceRevision()).toBe(0);
    store.replaceVisibleCards([]);
    expect(store.getVisibleSequenceRevision()).toBe(0);
    store.replaceVisibleCards([first, second]);
    expect(store.getVisibleSequenceRevision()).toBe(1);
    store.replaceVisibleCards([
      { ...first, previewHtml: "changed" },
      { ...second, hydrated: true },
    ]);
    expect(store.getVisibleSequenceRevision()).toBe(1);
    store.patchCardPreviews([{ path: first.path, patch: { hydrated: true } }]);
    expect(store.getVisibleSequenceRevision()).toBe(1);
    store.replaceVisibleCards([second, first]);
    expect(store.getVisibleSequenceRevision()).toBe(2);
  });

  it("advances hydration revision independently and monotonically", () => {
    const store = createViewStateStore({ kind: "box", boxId: "box-1" });

    expect(store.getHydrationRevision()).toBe(0);
    expect(store.advanceHydrationRevision()).toBe(1);
    store.replaceVisibleCards([createCard("first.md", "First")]);
    expect(store.getHydrationRevision()).toBe(1);
    expect(store.advanceHydrationRevision()).toBe(2);
  });
});
