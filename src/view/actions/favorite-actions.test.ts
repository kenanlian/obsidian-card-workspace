import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import type { FavoriteRowModel } from "../panel-model";
import { createFolderScope } from "../scope";
import { FavoriteActions, remapFavoriteSelection } from "./favorite-actions";

describe("FavoriteActions", () => {
  it("activates a tag by selecting root before applying the single tag filter", async () => {
    const calls: string[] = [];
    const actions = new FavoriteActions({
      context: {} as never,
      selectFolderFromNav: async (path: string) => { calls.push(`folder:${path}`); },
      applyTagFilter: async (tags: string[]) => { calls.push(`tags:${tags.join(",")}`); },
    } as never);

    await actions.activateFavoriteTag("project");

    expect(calls).toEqual(["folder:", "tags:project"]);
  });

  it("remaps only changed favorite selection flags and preserves row data identities", () => {
    const rows: FavoriteRowModel[] = [
      { kind: "folder", ref: "old", label: "Old", icon: "folder", count: 7, selected: true, missing: false },
      { kind: "folder", ref: "next", label: "Next", icon: "folder", count: 3, selected: false, missing: false },
      { kind: "tag", ref: "Project", label: "Project", icon: "tag", count: 2, selected: true, missing: false },
      { kind: "file", ref: "note.md", label: "note", icon: "file", count: 0, selected: false, missing: false },
      { kind: "box", ref: "box-1", label: "Box", icon: "box", count: 4, selected: false, missing: false },
    ];

    const next = remapFavoriteSelection(rows, createFolderScope("next", true), ["project"], "note.md");
    expect(next.map((row) => row.selected)).toEqual([false, true, true, true, false]);
    expect(next[2]).toBe(rows[2]);
    expect(next[2]).toMatchObject({ label: "Project", icon: "tag", count: 2, missing: false });
    expect(remapFavoriteSelection(next, createFolderScope("next", true), ["project"], "note.md")).toBe(next);
  });
});
