import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  FuzzySuggestModal: class FuzzySuggestModal {},
  Modal: class Modal {},
  Setting: class Setting {},
  TFile: class TFile {},
  TFolder: class TFolder {},
}));

import { MergeActions } from "./merge-actions";

describe("MergeActions", () => {
  it("keeps zero-selection bulk move as a safe no-op", () => {
    const getSelectedPaths = vi.fn(() => new Set<string>());
    const actions = new MergeActions({
      context: {} as never,
      getBulkMode: () => true,
      getSelectedPaths,
    } as never);

    expect(() => actions.bulkMoveSelected()).not.toThrow();
    expect(getSelectedPaths).toHaveBeenCalledTimes(1);
  });
});
