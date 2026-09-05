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

  it("persists a manual drag reorder and skips the save for no-op drops", async () => {
    const favorites = [
      { kind: "tag" as const, ref: "work" },
      { kind: "folder" as const, ref: "notes" },
      { kind: "tag" as const, ref: "home" },
    ];
    const saveSettings = vi.fn(async () => undefined);
    const actions = new FavoriteActions({
      context: {
        getSettings: () => ({ favorites }),
        saveSettings,
      },
    } as never);

    await actions.reorderFavoriteEntries({ kind: "tag", ref: "home" }, { kind: "tag", ref: "work" }, "before");
    expect(saveSettings).toHaveBeenCalledWith({
      favorites: [
        { kind: "tag", ref: "home" },
        { kind: "folder", ref: "notes" },
        { kind: "tag", ref: "work" },
      ],
    });

    saveSettings.mockClear();
    await actions.reorderFavoriteEntries({ kind: "tag", ref: "work" }, { kind: "tag", ref: "work" }, "before");
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("remaps only changed favorite selection flags and preserves row data identities", () => {
    const rows: FavoriteRowModel[] = [
      { kind: "folder", ref: "old", label: "Old", icon: "folder", count: 7, semanticState: "current-range", missing: false },
      { kind: "folder", ref: "next", label: "Next", icon: "folder", count: 3, semanticState: "none", missing: false },
      { kind: "tag", ref: "Project", label: "Project", icon: "tag", count: 2, semanticState: "checked-filter", missing: false },
      { kind: "file", ref: "note.md", label: "note", icon: "file", count: 0, semanticState: "none", missing: false },
      { kind: "box", ref: "box-1", label: "Box", icon: "box", count: 4, semanticState: "none", missing: false },
    ];

    const next = remapFavoriteSelection(rows, createFolderScope("next", true), ["project"], "note.md");
    expect(next.map((row) => row.semanticState)).toEqual(["none", "current-range", "checked-filter", "active-file", "none"]);
    expect(next[2]).toBe(rows[2]);
    expect(next[2]).toMatchObject({ label: "Project", icon: "tag", count: 2, missing: false });
    expect(remapFavoriteSelection(next, createFolderScope("next", true), ["project"], "note.md")).toBe(next);
  });

  it("treats the current Box favorite as a no-op and switches only to a different Box", () => {
    const handleBoxCommand = vi.fn();
    const actions = new FavoriteActions({
      context: {} as never,
      getActiveBoxId: () => "box-1",
      handleBoxCommand,
    } as never);

    actions.handleFavoriteActivate({ favorite: { kind: "box", ref: "box-1" } });
    expect(handleBoxCommand).not.toHaveBeenCalled();
    actions.handleFavoriteActivate({ favorite: { kind: "box", ref: "box-2" } });
    expect(handleBoxCommand).toHaveBeenCalledWith({ command: "switch", boxId: "box-2" });
  });
});
