import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { FavoriteActions } from "./favorite-actions";

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
});
